/**
 * Kolo 10 / krok 4 — e-maily na stagingu přes Resend s povinným allowlistem (STAGING_EMAIL_ALLOWLIST).
 * Resend nahrazený simulátorem (tests/helpers/fake-resend.mjs: SMTP + HTTP API, společný seznam odeslaných).
 *   - e-mail na adresu mimo allowlist se neodešle a zaloguje (maskovaně),
 *   - povolená adresa (i plus-adresa a celá doména) odejde a je v seznamu odeslaných Resend API,
 *   - totéž pro platform-notify (volá Resend HTTP API přímo),
 *   - mimo staging se nefiltruje.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const HTTP = 3986;
const SMTP = 2516;
const API = `http://localhost:${HTTP}`;
const KEY = 're_test_r10';
let sim: ChildProcess;

async function list(): Promise<Array<{ to: string[]; subject: string }>> {
  const r = await fetch(`${API}/emails`, { headers: { authorization: `Bearer ${KEY}` } });
  return ((await r.json()) as { data: Array<{ to: string[]; subject: string }> }).data;
}
const sentTo = async (addr: string) => (await list()).filter((m) => m.to.map((t) => t.toLowerCase()).includes(addr.toLowerCase()));

const ENV_KEYS = ['TIXLY_ENV', 'STAGING_EMAIL_ALLOWLIST', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE',
  'EMAIL_FROM', 'RESEND_API_KEY', 'RESEND_API_BASE_URL', 'PLATFORM_ADMIN_EMAIL'];
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  sim = spawn(process.execPath, [join(__dirname, 'helpers', 'fake-resend.mjs')], {
    env: { ...process.env, FAKE_RESEND_PORT: String(HTTP), FAKE_RESEND_SMTP_PORT: String(SMTP) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${API}/emails`, { headers: { authorization: `Bearer ${KEY}` } })).ok) break; } catch { /* startuje */ }
    await new Promise((r) => setTimeout(r, 100));
  }
}, 20_000);
afterAll(() => {
  sim?.kill();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function useStagingSmtp(allowlist: string | undefined, tixlyEnv = 'staging') {
  Object.assign(process.env, {
    SMTP_HOST: 'localhost', SMTP_PORT: String(SMTP), SMTP_USER: 'resend', SMTP_PASS: KEY, SMTP_SECURE: 'false',
    EMAIL_FROM: 'Tixly STAGING <noreply@staging.example>', TIXLY_ENV: tixlyEnv,
  });
  if (allowlist === undefined) delete process.env.STAGING_EMAIL_ALLOWLIST; else process.env.STAGING_EMAIL_ALLOWLIST = allowlist;
  const m = await import('@/lib/email/mailer');
  m.resetMailerCache();
  return m;
}

describe('allowlist — tvar a párování', () => {
  it('adresa, plus-adresa, doména; velikost písmen; tvar „Jméno <a@b>"', async () => {
    const { parseAllowlist, isAllowed, maskAddress } = await import('@/lib/email/staging-allowlist');
    const l = parseAllowlist(' Tester@Firma.example , @tixly-test.example, nesmysl ');
    expect(l.entries).toEqual(['tester@firma.example', '@tixly-test.example']);
    expect(l.invalid).toEqual(['nesmysl']);
    expect(isAllowed('tester@firma.example', l)).toBe(true);
    expect(isAllowed('TESTER+divak-1@firma.example', l)).toBe(true);
    expect(isAllowed('Divák <kdokoli@tixly-test.example>', l)).toBe(true);
    expect(isAllowed('jiny@firma.example', l)).toBe(false);
    expect(isAllowed('tester@firma.example.evil', l)).toBe(false);
    expect(isAllowed('kdokoli@sub.tixly-test.example', l)).toBe(false);
    expect(maskAddress('Jan <jan.novak@gmail.com>')).toBe('j***@gmail.com');
  });
});

describe('mailer na stagingu (SMTP → simulátor Resend)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('adresa mimo allowlist se NEODEŠLE a zaloguje; povolená odejde', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendMail } = await useStagingSmtp('tester@firma.example');
    const run = Date.now().toString(36);
    const blocked = `cizi-${run}@gmail.example`;
    const allowed = `tester+ok-${run}@firma.example`;

    const r1 = await sendMail({ to: blocked, subject: `Blok ${run}`, html: '<p>x</p>' });
    expect((r1 as { skippedByStagingAllowlist?: boolean }).skippedByStagingAllowlist).toBe(true);
    await sendMail({ to: allowed, subject: `Povoleno ${run}`, html: '<p>x</p>' });

    expect(await sentTo(blocked)).toHaveLength(0);
    const ok = await sentTo(allowed);
    expect(ok).toHaveLength(1);
    expect(ok[0].subject).toBe(`Povoleno ${run}`);
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/STAGING_EMAIL_ALLOWLIST/);
    expect(logged).toContain('c***@gmail.example');
    expect(logged).not.toContain(blocked); // celá adresa do logu nejde
  });

  it('více příjemců: zablokované se vyřadí, povolené dostanou e-mail', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendMail } = await useStagingSmtp('@tixly-test.example');
    const run = Date.now().toString(36);
    const a = `a-${run}@tixly-test.example`;
    const b = `b-${run}@seznam.example`;
    await sendMail({ to: [a, b], cc: `Jméno <c-${run}@seznam.example>`, subject: `Mix ${run}`, html: '<p>x</p>' });
    expect(await sentTo(a)).toHaveLength(1);
    expect(await sentTo(b)).toHaveLength(0);
    expect(await sentTo(`c-${run}@seznam.example`)).toHaveLength(0);
  });

  it('mimo staging se nefiltruje', async () => {
    const { sendMail } = await useStagingSmtp(undefined, '');
    const run = Date.now().toString(36);
    const anyone = `kdokoli-${run}@gmail.example`;
    await sendMail({ to: anyone, subject: `Prod ${run}`, html: '<p>x</p>' });
    expect(await sentTo(anyone)).toHaveLength(1);
  });
});

describe('platform-notify na stagingu (Resend HTTP API → simulátor)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('admin mimo allowlist: neodešle se a zaloguje; v allowlistu: odejde', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = Date.now().toString(36);
    Object.assign(process.env, { TIXLY_ENV: 'staging', STAGING_EMAIL_ALLOWLIST: 'tester@firma.example', RESEND_API_KEY: KEY, RESEND_API_BASE_URL: API });
    const { notifyPlatformAdmin } = await import('@/lib/notifications/platform-notify');

    process.env.PLATFORM_ADMIN_EMAIL = `admin-${run}@tixly.example`;
    await notifyPlatformAdmin({ kind: 'test', title: `Blok ${run}` });
    expect(await sentTo(`admin-${run}@tixly.example`)).toHaveLength(0);
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/STAGING_EMAIL_ALLOWLIST/);

    process.env.PLATFORM_ADMIN_EMAIL = `tester+admin-${run}@firma.example`;
    await notifyPlatformAdmin({ kind: 'test', title: `Povoleno ${run}` });
    expect(await sentTo(`tester+admin-${run}@firma.example`)).toHaveLength(1);
  });
});

// @vitest-environment node
/**
 * Kolo 7 / krok 5 — ARES přes simulátor (tests/helpers/fake-ares.mjs): úspěch, neexistující IČO,
 * zaniklý subjekt, výpadek (503), timeout.
 *
 * Dřív: výpadek i timeout ARES vypadaly jako neexistující IČO — registrace zapsala ares_ico_valid=false
 * a risk_score 100, KYC odmítl 422 ARES_VERIFICATION_FAILED. Adresa ARES byla natvrdo, nešlo testovat.
 *
 * Očekávané: klient rozliší verified / not_found / inactive / unavailable (ARES_BASE_URL, ARES_TIMEOUT_MS);
 * výpadek nebo timeout přepne pořadatele do ručního ověření (manual_verification_required, stav
 * ARES 'unavailable', IČO neoznačené jako neplatné), KYC se při výpadku přijme k ručnímu posouzení.
 */
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARES_SCENARIOS, startFakeAres } from './helpers/fake-ares.mjs';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest) => Promise<Response>;

let ares: { url: string; close: () => Promise<void>; calls: string[] };
const saved = { url: process.env.ARES_BASE_URL, timeout: process.env.ARES_TIMEOUT_MS };

beforeAll(async () => {
  ares = await startFakeAres();
  process.env.ARES_BASE_URL = ares.url;
  process.env.ARES_TIMEOUT_MS = '400';
});
afterAll(async () => {
  process.env.ARES_BASE_URL = saved.url;
  process.env.ARES_TIMEOUT_MS = saved.timeout;
  await ares?.close();
});

describe('Kolo 7 — klient ARES proti simulátoru', () => {
  it('úspěch / neexistující / zaniklý / výpadek / timeout se rozliší', async () => {
    const { checkAres } = await import('@/lib/compliance/ares');
    const found = await checkAres(ARES_SCENARIOS.found);
    expect(found).toMatchObject({ outcome: 'verified', valid: true, active: true, legalName: 'Divadlo Simulace s.r.o.', dic: `CZ${ARES_SCENARIOS.found}` });
    expect(await checkAres(ARES_SCENARIOS.notFound)).toMatchObject({ outcome: 'not_found', valid: false, error: 'NOT_FOUND' });
    expect(await checkAres(ARES_SCENARIOS.dissolved)).toMatchObject({ outcome: 'inactive', valid: true, active: false });
    expect(await checkAres(ARES_SCENARIOS.outage)).toMatchObject({ outcome: 'unavailable', valid: false, error: 'HTTP_503' });
    const t0 = Date.now();
    expect(await checkAres(ARES_SCENARIOS.timeout)).toMatchObject({ outcome: 'unavailable', valid: false, error: 'TIMEOUT' });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(ares.calls).toEqual(expect.arrayContaining(Object.values(ARES_SCENARIOS)));
  });

  it('verifyIco (KYC) jde přes stejného klienta; výpadek označí jako nedostupný, ne jako neplatné IČO', async () => {
    const { verifyIco } = await import('@/lib/ares/verify');
    expect(await verifyIco(ARES_SCENARIOS.found)).toMatchObject({ valid: true, companyName: 'Divadlo Simulace s.r.o.', unavailable: false });
    expect(await verifyIco(ARES_SCENARIOS.notFound)).toMatchObject({ valid: false, error: 'NOT_FOUND', unavailable: false });
    expect(await verifyIco(ARES_SCENARIOS.outage)).toMatchObject({ valid: false, unavailable: true });
    expect(await verifyIco(ARES_SCENARIOS.timeout)).toMatchObject({ valid: false, unavailable: true });
    expect(await verifyIco('12345678')).toMatchObject({ valid: false, error: 'INVALID_CHECKSUM' });
  });
});

run('Kolo 7 — registrace pořadatele a KYC s ARES simulátorem', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  let ipSeq = 10;
  const register = async (ico: string) => {
    const { POST } = await import('@/app/api/auth/register-promoter/route');
    const email = `ares-${ico}-${Date.now()}-${ipSeq}@fix.test`;
    const r = await throughMiddleware(new Request('http://localhost/api/auth/register-promoter', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-forwarded-for': `198.19.7.${ipSeq++}` },
      body: JSON.stringify({ email, password: 'Heslo-Test-2026', ico }),
    }), POST as unknown as H);
    const body = (await r.json()) as { promoterId: string; accessToken: string };
    expect(r.status, JSON.stringify(body)).toBe(200);
    const row = (await clone.pool.query(
      `SELECT ares_check_status, manual_verification_required, ares_ico_valid, ares_company_active, risk_score
         FROM platform.promoters WHERE id=$1`, [body.promoterId])).rows[0];
    return { ...body, row };
  };

  it('úspěch → verified, bez ručního ověření', async () => {
    const r = await register(ARES_SCENARIOS.found);
    expect(r.row).toMatchObject({ ares_check_status: 'verified', manual_verification_required: false, ares_ico_valid: true, ares_company_active: true });
    expect(r.row.risk_score).toBeLessThan(100);
  });

  it('neexistující IČO → not_found, vysoké riziko; zaniklý subjekt → inactive, riziko 100', async () => {
    const nf = await register(ARES_SCENARIOS.notFound);
    expect(nf.row).toMatchObject({ ares_check_status: 'not_found', manual_verification_required: false, ares_ico_valid: false, risk_score: 100 });
    const d = await register(ARES_SCENARIOS.dissolved);
    expect(d.row).toMatchObject({ ares_check_status: 'inactive', ares_ico_valid: true, ares_company_active: false, risk_score: 100 });
  });

  it('výpadek i timeout ARES → ruční ověření, IČO není označené jako neplatné ani rizikové', async () => {
    for (const ico of [ARES_SCENARIOS.outage, ARES_SCENARIOS.timeout]) {
      const r = await register(ico);
      expect(r.row, ico).toMatchObject({ ares_check_status: 'unavailable', manual_verification_required: true, ares_ico_valid: null, ares_company_active: null });
      expect(r.row.risk_score, ico).toBeLessThan(100);
    }
  });

  it('KYC: při výpadku ARES se údaje přijmou k ručnímu ověření (dřív 422); neexistující IČO dál 422', async () => {
    const { POST } = await import('@/app/api/admin/kyc/route');
    const kyc = async (tok: string, ico: string) => {
      const r = await throughMiddleware(new Request('http://localhost/api/admin/kyc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${tok}` },
        body: JSON.stringify({ ico, dic: `CZ${ico}`, companyName: 'Moje Divadlo s.r.o.', companyAddress: 'Celetná 17, 110 00 Praha 1', bankAccount: '123456789/0800', vatPayer: true }),
      }), POST as unknown as H);
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    };
    const reg = await register(ARES_SCENARIOS.outage);
    const out = await kyc(reg.accessToken, ARES_SCENARIOS.outage);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body).toMatchObject({ status: 'submitted', manualVerification: true });
    const row = (await clone.pool.query(
      `SELECT kyc_status, manual_verification_required, ares_check_status, ares_verified_at, name FROM platform.promoters WHERE id=$1`, [reg.promoterId])).rows[0];
    expect(row).toMatchObject({ kyc_status: 'submitted', manual_verification_required: true, ares_check_status: 'unavailable', ares_verified_at: null, name: 'Moje Divadlo s.r.o.' });

    const reg2 = await register(ARES_SCENARIOS.found);
    const nf = await kyc(reg2.accessToken, ARES_SCENARIOS.notFound);
    expect(nf.status).toBe(422);
    expect(nf.body.error).toBe('ARES_VERIFICATION_FAILED');
    const ok = await kyc(reg2.accessToken, ARES_SCENARIOS.found);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ manualVerification: false });
    const row2 = (await clone.pool.query(`SELECT manual_verification_required, ares_check_status, name FROM platform.promoters WHERE id=$1`, [reg2.promoterId])).rows[0];
    expect(row2).toEqual({ manual_verification_required: false, ares_check_status: 'verified', name: 'Divadlo Simulace s.r.o.' });
  });
});

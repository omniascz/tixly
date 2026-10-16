/**
 * Centralizovaný email mailer pro Tixly.
 *
 * Provider-agnostic přes SMTP. Funguje s libovolnou SMTP službou:
 *   - Resend:    smtp.resend.com:587, user=resend, pass=re_xxx
 *   - Postmark:  smtp.postmarkapp.com:587, user=<server-token>, pass=<server-token>
 *   - SendGrid:  smtp.sendgrid.net:587, user=apikey, pass=<api-key>
 *   - AWS SES:   email-smtp.<region>.amazonaws.com:587, user=<smtp-user>, pass=<smtp-pass>
 *   - MailHog (dev): localhost:1025 (bez auth, default)
 *
 * Env vars:
 *   SMTP_HOST       (default: 'localhost')
 *   SMTP_PORT       (default: 1025)
 *   SMTP_USER       (volitelné — pro auth)
 *   SMTP_PASS       (volitelné — pro auth)
 *   SMTP_SECURE     ('true' pro implicit TLS na 465, jinak STARTTLS)
 *   EMAIL_FROM      (default: 'vstupenky@tixly.local')
 *
 * Použití:
 *   import { sendMail } from '@/lib/email/mailer';
 *   await sendMail({ to, subject, html });
 *
 * Helper vrací stejný typ jako nodemailer.sendMail (SentMessageInfo) — drop-in replacement.
 */

import type { Transporter, SendMailOptions, SentMessageInfo } from 'nodemailer';
import { filterRecipients, maskAddress, parseAllowlist, stagingEmailFilterActive } from '@/lib/email/staging-allowlist';

let cachedTransporter: Transporter | null = null;
let cachedProviderLabel: string | null = null;

interface MailerConfig {
  host: string;
  port: number;
  secure: boolean;
  authed: boolean;
  user?: string;
  pass?: string;
  from: string;
  providerLabel: string;
}

function readConfig(): MailerConfig {
  const host = process.env.SMTP_HOST?.trim() || 'localhost';
  const port = Number(process.env.SMTP_PORT ?? (host === 'localhost' ? '1025' : '587'));
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const authed = Boolean(user && pass);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const from = process.env.EMAIL_FROM?.trim() || 'vstupenky@tixly.local';

  const providerLabel = (() => {
    if (host === 'localhost' || host === '127.0.0.1') return 'mailhog-dev';
    if (host.includes('resend.com')) return 'resend';
    if (host.includes('postmarkapp.com')) return 'postmark';
    if (host.includes('sendgrid.net')) return 'sendgrid';
    if (host.includes('amazonaws.com')) return 'aws-ses';
    return host;
  })();

  return { host, port, secure, authed, user, pass, from, providerLabel };
}

async function getTransporter(): Promise<{ transporter: Transporter; from: string; label: string }> {
  if (cachedTransporter && cachedProviderLabel) {
    const cfg = readConfig();
    return { transporter: cachedTransporter, from: cfg.from, label: cachedProviderLabel };
  }
  const cfg = readConfig();
  const nodemailer = (await import('nodemailer')).default;
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    tls: { rejectUnauthorized: cfg.providerLabel !== 'mailhog-dev' },
    auth: cfg.authed ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  cachedProviderLabel = cfg.providerLabel;
  if (process.env.NODE_ENV !== 'test') {
    console.log(
      `[mailer] provider=${cfg.providerLabel} host=${cfg.host}:${cfg.port} authed=${cfg.authed}`,
    );
  }
  return { transporter: cachedTransporter, from: cfg.from, label: cfg.providerLabel };
}

/**
 * Pošle email přes nakonfigurovaný SMTP provider.
 *
 * Pokud `from` chybí v opts, použije se `EMAIL_FROM` env (default 'vstupenky@tixly.local').
 *
 * Failure mode: vyhazuje výjimku jako nodemailer.sendMail. Volající má fire-and-forget
 * pattern (void async + try/catch) ve většině call sitů.
 */
export async function sendMail(opts: SendMailOptions): Promise<SentMessageInfo> {
  // Kolo 10 / krok 4: staging posílá přes Resend skutečným lidem → jen adresy ze STAGING_EMAIL_ALLOWLIST.
  if (stagingEmailFilterActive()) {
    const list = parseAllowlist(process.env.STAGING_EMAIL_ALLOWLIST);
    const f = filterRecipients({ to: opts.to, cc: opts.cc, bcc: opts.bcc }, list);
    if (f.blocked.length) {
      console.warn(
        `[mailer] staging: příjemci mimo STAGING_EMAIL_ALLOWLIST — e-mail jim NEODEŠEL: ${f.blocked.map(maskAddress).join(', ')}`
        + ` (předmět: ${String(opts.subject ?? '').slice(0, 80)})`,
      );
    }
    if (f.allowedCount === 0) {
      const skipped = { messageId: '', accepted: [] as string[], rejected: f.blocked, pending: [] as string[], response: 'skipped: staging allowlist', envelope: { from: false as const, to: [] as string[] }, skippedByStagingAllowlist: true };
      return skipped;
    }
    opts = { ...opts, to: f.to, cc: f.cc, bcc: f.bcc };
  }
  const { transporter, from } = await getTransporter();
  return transporter.sendMail({ from: opts.from ?? from, ...opts });
}

/** Pro testy / hot-reload — vyresetuje cached transporter (např. po změně env). */
export function resetMailerCache(): void {
  cachedTransporter = null;
  cachedProviderLabel = null;
}

/** Vrátí jméno aktuálního provider pro telemetry / health checks. */
export function getMailerProvider(): string {
  return cachedProviderLabel ?? readConfig().providerLabel;
}

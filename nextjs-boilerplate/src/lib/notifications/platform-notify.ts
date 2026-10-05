/**
 * Platform admin notifications — urgent internal alerts.
 * Sent via email to PLATFORM_ADMIN_EMAIL (env var).
 * Used for DSA high-severity reports, AML matches, etc.
 *
 * Kolo 10 / krok 4: na stagingu (TIXLY_ENV=staging) jen na adresu ze STAGING_EMAIL_ALLOWLIST; jinak se neodešle
 * a zaloguje. RESEND_API_BASE_URL (výchozí https://api.resend.com) — v testech simulátor.
 */

import { isAllowed, maskAddress, parseAllowlist, stagingEmailFilterActive } from '@/lib/email/staging-allowlist';

export interface PlatformNotifyInput {
  kind: string;
  title: string;
  body?: string;
  link?: string;
}

export async function notifyPlatformAdmin(input: PlatformNotifyInput): Promise<void> {
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;

  if (!adminEmail || !resendKey) {
    console.warn('[platform-notify] PLATFORM_ADMIN_EMAIL or RESEND_API_KEY not set — skipping:', input.kind);
    return;
  }

  if (stagingEmailFilterActive() && !isAllowed(adminEmail, parseAllowlist(process.env.STAGING_EMAIL_ALLOWLIST))) {
    console.warn(`[platform-notify] staging: ${maskAddress(adminEmail)} není v STAGING_EMAIL_ALLOWLIST — upozornění NEODESLÁNO: ${input.kind}`);
    return;
  }

  const linkLine = input.link ? `\n\nLink: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}${input.link}` : '';

  const base = (process.env.RESEND_API_BASE_URL ?? 'https://api.resend.com').replace(/\/+$/, '');
  await fetch(`${base}/emails`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Tixly Platform <noreply@tixly.cz>',
      to: [adminEmail],
      subject: `[Tixly Admin] ${input.title}`,
      text: `${input.title}\n\n${input.body ?? ''}${linkLine}`,
    }),
  });
}

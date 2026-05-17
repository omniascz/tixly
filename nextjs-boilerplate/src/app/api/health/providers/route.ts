/**
 * GET /api/health/providers
 *
 * Vrátí stav (isConfigured) všech klíčových 3rd party providerů.
 * Pro post-deploy verifikaci že env vars byly správně nastaveny.
 *
 * Nepotvrzuje, že jsou klíče VÁLIDNÍ (to vyžaduje aktivní volání), jen
 * že existují a mají správný shape.
 *
 * Veřejné — ne sensitive, ale pro vlastní info.
 */

import { NextResponse } from 'next/server';
import { getGopayConfig } from '@/lib/payment/gopay-real';
import { getComGateConfig } from '@/lib/payment/comgate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ProviderHealth {
  name: string;
  category: 'payment' | 'email' | 'sms' | 'captcha' | 'push' | 'ai' | 'monitoring' | 'bank';
  configured: boolean;
  notes?: string;
}

function checkSmtp(): boolean {
  return !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
}

function checkBulkgate(): boolean {
  return !!process.env.BULKGATE_APPLICATION_ID && !!process.env.BULKGATE_APPLICATION_TOKEN;
}

function checkHcaptcha(): boolean {
  return !!process.env.HCAPTCHA_SECRET && !!process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
}

function checkVapid(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

function checkAnthropic(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function checkSentry(): boolean {
  return !!process.env.SENTRY_DSN;
}

function checkFio(): boolean {
  return !!process.env.FIO_API_TOKEN;
}

function checkPsd2(): boolean {
  return !!process.env.PSD2_CLIENT_ID && !!process.env.PSD2_CLIENT_SECRET;
}

export async function GET(): Promise<Response> {
  const gopay = getGopayConfig();
  const comgate = getComGateConfig();

  const providers: ProviderHealth[] = [
    {
      name: 'GoPay',
      category: 'payment',
      configured: gopay.isConfigured,
      notes: gopay.isConfigured
        ? gopay.apiBaseUrl.includes('sandbox')
          ? 'sandbox mode'
          : 'production'
        : 'Missing GOPAY_GOID / CLIENT_ID / CLIENT_SECRET',
    },
    {
      name: 'ComGate',
      category: 'payment',
      configured: comgate.isConfigured,
      notes: comgate.isConfigured
        ? comgate.test
          ? 'test mode'
          : 'production'
        : 'Missing COMGATE_MERCHANT / SECRET',
    },
    {
      name: 'Stripe (parked)',
      category: 'payment',
      configured: !!process.env.STRIPE_SECRET_KEY,
      notes: 'Optional — pro mezinárodní expanzi',
    },
    {
      name: 'SMTP (Resend/Postmark/SES)',
      category: 'email',
      configured: checkSmtp(),
      notes: checkSmtp()
        ? `${process.env.SMTP_HOST}`
        : 'Missing SMTP_HOST / SMTP_USER / SMTP_PASS',
    },
    {
      name: 'BulkGate SMS',
      category: 'sms',
      configured: checkBulkgate(),
      notes: checkBulkgate() ? 'production' : 'Missing BULKGATE_APPLICATION_ID / TOKEN',
    },
    {
      name: 'hCaptcha',
      category: 'captcha',
      configured: checkHcaptcha(),
      notes: checkHcaptcha() ? 'production' : 'Missing HCAPTCHA_SECRET',
    },
    {
      name: 'Web Push (VAPID)',
      category: 'push',
      configured: checkVapid(),
      notes: checkVapid() ? 'production' : 'Run: npx web-push generate-vapid-keys',
    },
    {
      name: 'Anthropic Claude',
      category: 'ai',
      configured: checkAnthropic(),
      notes: checkAnthropic() ? 'production' : 'Optional — AI popisy + cover image',
    },
    {
      name: 'Sentry',
      category: 'monitoring',
      configured: checkSentry(),
      notes: checkSentry() ? 'enabled' : 'Optional — error tracking',
    },
    {
      name: 'Fio Open API',
      category: 'bank',
      configured: checkFio(),
      notes: checkFio() ? 'CZ bank auto-pull' : 'Missing FIO_API_TOKEN',
    },
    {
      name: 'PSD2 OAuth (KB/ČS/ČSOB)',
      category: 'bank',
      configured: checkPsd2(),
      notes: checkPsd2() ? 'enterprise CZ bank integration' : 'Missing PSD2_CLIENT_ID',
    },
  ];

  // Aggregate by category
  const summary = providers.reduce<Record<string, { configured: number; total: number }>>(
    (acc, p) => {
      acc[p.category] = acc[p.category] ?? { configured: 0, total: 0 };
      acc[p.category]!.total += 1;
      if (p.configured) acc[p.category]!.configured += 1;
      return acc;
    },
    {},
  );

  // Payment je launch-ready pokud aspoň jeden non-Stripe payment provider funguje
  const hasPaymentProvider = providers
    .filter((p) => p.category === 'payment' && p.name !== 'Stripe (parked)')
    .some((p) => p.configured);

  const launchReady = hasPaymentProvider && checkSmtp() && checkHcaptcha();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    launchReady,
    summary,
    providers,
    launchBlockers: launchReady ? [] : ['payment (GoPay/ComGate), SMTP, hCaptcha required'],
  });
}

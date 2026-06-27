'use client';

/**
 * /admin/anti-scalping — Přehled všech anti-scalping & abuse prevention vrstev
 *
 * Konsolidovaná stránka ukazující:
 * - Fraud metriky (blocked, review, avg score)
 * - Top fraud signály z posledních 30 dní
 * - Stav ochrany per-event (queue / verified fan / OTP / phone verif)
 * - Poslední fraud alerty
 * - Popis všech vrstev ochrany
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, ShieldAlert, ShieldX, Zap, Phone, Users, Clock } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface FraudStats {
  total: number;
  blocked: number;
  review: number;
  allowed: number;
  blockRate: number;
  avgScore: number | null;
}

interface Signal {
  signal: string;
  count: number;
}

interface ProtectedEvent {
  id: string;
  title: string;
  date_start: string;
  queue_enabled: boolean;
  verified_fan_enabled: boolean;
  requires_otp_validation: boolean;
  require_phone_verified: boolean;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  message: string;
  created_at: string;
  event_title: string | null;
}

interface Overview {
  period: { days: number };
  fraud: FraudStats;
  topSignals: Signal[];
  protectedEvents: ProtectedEvent[];
  recentAlerts: Alert[];
}

const SIGNAL_LABELS: Record<string, string> = {
  disposableEmail: '📧 Disposable e-mail',
  emailVelocity: '⚡ Email velocity',
  ipVelocity: '🌐 IP velocity',
  highValue: '💰 High value',
  newUserHighValue: '🆕 New user + high value',
  botHistory: '🤖 Bot history',
  geoMismatch: '🗺 Geo mismatch',
  fastFormFill: '⏱ Fast form fill',
  emailNamePatternMismatch: '📛 Email/name mismatch',
};

const ALERT_ICONS: Record<string, string> = {
  fraud_cluster: '🚨',
  traffic_spike: '🚀',
  queue_overflow: '📊',
  bot_detected: '🤖',
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'border-blue-300 bg-blue-50/50 text-blue-900',
  warning: 'border-amber-300 bg-amber-50/50 text-amber-900',
  critical: 'border-rose-300 bg-rose-50/50 text-rose-900',
};

const LAYERS = [
  {
    icon: <Clock className="h-5 w-5 text-violet-600" />,
    title: 'Smart Queue',
    desc: 'Virtuální čekárna při high-demand onsale. Kupci se řadí do fronty místo opakovaných requestů. Eliminuje botové nápory na checkout.',
    href: (eventId: string) => `/admin/events/${eventId}/queue`,
    badge: (e: ProtectedEvent) => e.queue_enabled,
  },
  {
    icon: <ShieldCheck className="h-5 w-5 text-emerald-600" />,
    title: 'SafeTix™ rotující kód',
    desc: 'TOTP kód v QR se mění každých 30 s. Screenshoty ani statické kopie vstupenek nefungují. Enforced při každém scanu.',
    href: null,
    badge: null,
  },
  {
    icon: <Users className="h-5 w-5 text-blue-600" />,
    title: 'Verified Fan presale',
    desc: 'Fanoušci musí požádat o přístup k presale. Promotér schválí/zamítne per-request. Jednorázový presale kód brání sdílení.',
    href: (eventId: string) => `/admin/events/${eventId}/verified-fan`,
    badge: (e: ProtectedEvent) => e.verified_fan_enabled,
  },
  {
    icon: <Phone className="h-5 w-5 text-amber-600" />,
    title: 'Phone Verification gate',
    desc: 'Checkout vyžaduje ověřené tel. číslo (SMS kód). Boti a bulk-buyers typicky neprochází SMS verifikací. Zapíná se per-event.',
    href: (eventId: string) => `/admin/events/${eventId}/settings`,
    badge: (e: ProtectedEvent) => e.require_phone_verified,
  },
  {
    icon: <Zap className="h-5 w-5 text-orange-600" />,
    title: 'OTP SMS validace',
    desc: 'Event-specifický SMS kód zaslaný kupci před checkoutem. Brání automatickým nákupům bez přístupu k telefonu.',
    href: (eventId: string) => `/admin/events/${eventId}/settings`,
    badge: (e: ProtectedEvent) => e.requires_otp_validation,
  },
  {
    icon: <ShieldAlert className="h-5 w-5 text-rose-600" />,
    title: 'Fraud ML scoring',
    desc: '9 signálů skóruje každou objednávku v reálném čase (email velocity, IP velocity, bot history, geo mismatch…). Automatický block/review/allow.',
    href: '/admin/fraud-queue',
    badge: null,
  },
  {
    icon: <ShieldX className="h-5 w-5 text-slate-600" />,
    title: 'Identity Verification',
    desc: 'Ověření dokladu totožnosti pro prémiové presale (eKYC integrace). Eliminuje fake accounts u nejvíce žádaných událostí.',
    href: null,
    badge: null,
    comingSoon: true,
  },
];

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

export default function AntiScalpingPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void authFetch('/api/admin/anti-scalping/overview')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData((await r.json()) as Overview);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anti-Scalping & Ochrana"
        description="Všechny vrstvy ochrany na jednom místě. Smart Queue, SafeTix™, Fraud ML, Phone Gate, Verified Fan."
        actions={
          <Link href="/admin/fraud-queue" className="text-sm text-primary hover:underline">
            Fraud Queue →
          </Link>
        }
      />

      {/* Fraud metriky */}
      {data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold">{data.fraud.total.toLocaleString('cs-CZ')}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Objednávky (30d)</div>
            </CardContent>
          </Card>
          <Card className="border-rose-200">
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-rose-700">
                {data.fraud.blocked.toLocaleString('cs-CZ')}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Blokováno ({data.fraud.blockRate}%)
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-200">
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-amber-700">
                {data.fraud.review.toLocaleString('cs-CZ')}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">Ve frontě review</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold">
                {data.fraud.avgScore !== null ? data.fraud.avgScore.toFixed(1) : '—'}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">Průměrné fraud skóre</div>
            </CardContent>
          </Card>
        </div>
      ) : error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Vrstvy ochrany */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Vrstvy ochrany</CardTitle>
            <CardDescription className="text-xs">
              7 nezávislých vrstev ochrany. Každá zastavuje jiný útočný vektor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {LAYERS.map((layer) => (
              <div key={layer.title} className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">{layer.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {layer.title}
                    {layer.comingSoon && (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {layer.desc}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Top signály */}
          {data && data.topSignals.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Top fraud signály (30d)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.topSignals.map((s) => {
                  const maxCount = Math.max(1, ...data.topSignals.map((x) => x.count));
                  const pct = Math.round((s.count / maxCount) * 100);
                  return (
                    <div key={s.signal} className="flex items-center gap-3">
                      <div className="w-40 flex-shrink-0 truncate text-xs">
                        {SIGNAL_LABELS[s.signal] ?? s.signal}
                      </div>
                      <div className="flex-1 rounded-full bg-muted h-4 overflow-hidden">
                        <div
                          className="h-full bg-rose-400 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                        {s.count}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Ochrana per event */}
          {data && data.protectedEvents.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Aktivní ochrana na akcích</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.protectedEvents.map((ev) => {
                  const layers = [
                    ev.queue_enabled && 'Queue',
                    ev.verified_fan_enabled && 'Verified Fan',
                    ev.requires_otp_validation && 'OTP',
                    ev.require_phone_verified && 'Phone',
                  ].filter(Boolean);
                  return (
                    <div key={ev.id} className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/admin/events/${ev.id}/queue`}
                          className="text-sm font-medium hover:text-primary truncate block"
                        >
                          {ev.title}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {layers.length === 0 ? (
                            <span className="text-xs text-muted-foreground">Žádná ochrana</span>
                          ) : (
                            layers.map((l) => (
                              <Badge key={l as string} variant="secondary" className="text-xs py-0">
                                {l}
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Alerty */}
          {data && data.recentAlerts.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Poslední fraud alerty</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.recentAlerts.map((a) => (
                  <div
                    key={a.id}
                    className={`rounded-md border p-2 text-xs ${SEVERITY_COLORS[a.severity] ?? ''}`}
                  >
                    <span className="mr-1">{ALERT_ICONS[a.alert_type] ?? '⚠️'}</span>
                    {a.event_title && <strong>{a.event_title}: </strong>}
                    {a.message}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '🔍 Fraud Queue', href: '/admin/fraud-queue' },
          { label: '🔔 Alerty', href: '/admin/alerts' },
          { label: '📊 Reports', href: '/admin/reports' },
          { label: '⚙️ KYC nastavení', href: '/admin/settings/kyc' },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg border p-3 text-center text-sm font-medium hover:bg-muted transition"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

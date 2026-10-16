'use client';

/**
 * TwoFactorSettings — TOTP 2FA enrollment + management.
 *
 * Flow:
 *   1. Stav: GET /api/admin/2fa/setup → { enabled, enrolledAt }
 *   2. Pokud disabled: tlačítko „Zapnout 2FA" → POST setup → vrátí otpauth URL + base32
 *   3. UI ukáže QR (otpauth URL vygenerovaný lokálně v prohlížeči knihovnou qrcode, nikam se neposílá)
 *      nebo manual code + input pro 6 cifer
 *   4. POST /api/admin/2fa/verify { code } → response s 10× backup codes (zobrazí 1×)
 *   5. Pokud enabled: ukázat „2FA aktivní od X" + button „Vypnout 2FA"
 */

import { FormEvent, useEffect, useState } from 'react';
import { Shield, ShieldCheck, ShieldOff, Copy, Check, AlertTriangle } from 'lucide-react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Status {
  enabled: boolean;
  enrolledAt: string | null;
}

interface SetupResponse {
  otpauth: string;
  secretBase32: string;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export function TwoFactorSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setupData, setSetupData] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/admin/2fa/setup');
    if (res.ok) {
      const data = (await res.json()) as Status;
      setStatus(data);
    }
  }

  async function startSetup() {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/2fa/setup', { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.message ?? `HTTP ${res.status}`);
        return;
      }
      setSetupData((await res.json()) as SetupResponse);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as { backupCodes?: string[]; error?: string; message?: string };
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Kód není platný');
        return;
      }
      if (data.backupCodes) setBackupCodes(data.backupCodes);
      setSetupData(null);
      setCode('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disable2FA() {
    if (!confirm('Opravdu vypnout 2FA? Účet bude méně chráněný.')) return;
    setBusy(true);
    try {
      const res = await authFetch('/api/admin/2fa/disable', { method: 'POST' });
      if (res.ok) {
        await load();
        setBackupCodes(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyBackupCodes() {
    if (!backupCodes) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  // QR z otpauth URL (obsahuje TOTP secret) generujeme lokálně v prohlížeči — nikdy ne přes externí službu.
  // Když generování selže, QR se nezobrazí a zůstane ruční kód.
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!setupData) return;
    let cancelled = false;
    QRCode.toDataURL(setupData.otpauth, { width: 180, margin: 4 })
      .then((url) => {
        if (!cancelled) setQrSrc(url);
      })
      .catch(() => {
        if (!cancelled) setQrSrc(null);
      });
    return () => {
      cancelled = true;
      setQrSrc(null);
    };
  }, [setupData]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status?.enabled ? (
            <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />
          ) : (
            <Shield className="h-5 w-5" aria-hidden />
          )}
          Dvoufaktorová autentizace (2FA)
        </CardTitle>
        <CardDescription>
          Po zadání hesla budeš ještě požádán/a o 6místný kód z aplikace
          (Google Authenticator, 1Password, Authy…).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
            <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden />
            {error}
          </div>
        ) : null}

        {backupCodes ? (
          <div className="space-y-3 rounded-md border border-emerald-400 bg-emerald-50 p-3">
            <p className="text-sm font-medium text-emerald-900">
              ✓ 2FA aktivováno. Ulož si těchto 10 záložních kódů.
            </p>
            <p className="text-xs text-emerald-800">
              Každý kód lze použít jednorázově místo TOTP — když ztratíš telefon. Po
              zavření této stránky je už neuvidíš.
            </p>
            <pre className="rounded-md bg-emerald-100 p-2 font-mono text-sm text-emerald-900">
              {backupCodes.join('\n')}
            </pre>
            <Button size="sm" variant="outline" onClick={copyBackupCodes}>
              {copied ? (
                <>
                  <Check className="mr-1 h-4 w-4" aria-hidden /> Zkopírováno
                </>
              ) : (
                <>
                  <Copy className="mr-1 h-4 w-4" aria-hidden /> Zkopírovat
                </>
              )}
            </Button>
          </div>
        ) : null}

        {status?.enabled && !setupData ? (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              ✓ 2FA aktivní od{' '}
              {status.enrolledAt
                ? new Date(status.enrolledAt).toLocaleDateString('cs-CZ')
                : '—'}
              .
            </div>
            <Button
              variant="outline"
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
              onClick={disable2FA}
              disabled={busy}
            >
              <ShieldOff className="mr-2 h-4 w-4" aria-hidden />
              Vypnout 2FA
            </Button>
          </div>
        ) : null}

        {!status?.enabled && !setupData ? (
          <Button onClick={startSetup} disabled={busy}>
            {busy ? 'Připravuji…' : 'Zapnout 2FA'}
          </Button>
        ) : null}

        {setupData ? (
          <form onSubmit={verifyCode} className="space-y-3">
            <p className="text-sm">
              <strong>Krok 1:</strong> Naskenuj QR kód aplikací (Google Authenticator,
              1Password, Authy…). Nebo zadej kód ručně:{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {setupData.secretBase32}
              </code>
            </p>
            {qrSrc ? (
              <div className="flex justify-center rounded-md border bg-white p-3">
                <img src={qrSrc} alt="QR kód 2FA" className="h-44 w-44" />
              </div>
            ) : null}
            <div>
              <label htmlFor="totp-code" className="mb-1 block text-xs font-medium">
                <strong>Krok 2:</strong> Zadej 6místný kód z aplikace
              </label>
              <Input
                id="totp-code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123 456"
                required
              />
            </div>
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Ověřuji…' : 'Ověřit a aktivovat'}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

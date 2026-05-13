'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Download, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Profile {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  createdAt: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  preferences: {
    emailEnabled: boolean;
    smsEnabled: boolean;
    pushEnabled: boolean;
    orderConfirmations: boolean;
    preEventReminders: boolean;
    marketing: boolean;
    promoterNews: boolean;
    abandonedCart: boolean;
  };
  pendingDeletion: {
    id: string;
    status: string;
    scheduledAt: string | null;
  } | null;
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

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [prefs, setPrefs] = useState<Profile['preferences'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await authFetch('/api/buyer/me');
      if (!res.ok) {
        if (res.status === 401) {
          setError('Pro zobrazení profilu se musíš přihlásit.');
        } else {
          setError(`HTTP ${res.status}`);
        }
        return;
      }
      const data = (await res.json()) as Profile;
      setProfile(data);
      setName(data.name ?? '');
      setPhone(data.phone ?? '');
      setPrefs(data.preferences);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch('/api/buyer/me', {
        method: 'PATCH',
        body: JSON.stringify({ name, phone: phone || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess('Uloženo.');
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    if (!prefs) return;
    setBusy(true);
    setSuccess(null);
    try {
      const res = await authFetch('/api/buyer/notification-preferences', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      });
      if (res.ok) setSuccess('Notifikace uloženy.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadData() {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/buyer/gdpr/export', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setError(`Export selhal: HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tixly-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('Stažení započato.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  async function requestDeletion() {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/buyer/gdpr/delete', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? `HTTP ${res.status}`);
        return;
      }
      setShowDeleteConfirm(false);
      await load();
      setSuccess('Žádost přijata. Účet bude anonymizován za 30 dní. Do té doby můžeš požádat o zrušení.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    try {
      const res = await authFetch('/api/buyer/gdpr/delete', { method: 'DELETE' });
      if (res.ok) {
        await load();
        setSuccess('Žádost o smazání zrušena.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl">
        {error ? (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
            {error}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Můj profil</h1>

      {success ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden /> {success}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden /> {error}
        </div>
      ) : null}

      {profile.pendingDeletion ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">⏳ Žádost o smazání běží</CardTitle>
            <CardDescription className="text-amber-900">
              Tvůj účet bude anonymizován{' '}
              {profile.pendingDeletion.scheduledAt
                ? new Date(profile.pendingDeletion.scheduledAt).toLocaleDateString('cs-CZ')
                : 'po uplynutí 30denní lhůty'}
              . Můžeš to zrušit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={cancelDeletion} disabled={busy}>
              Zrušit žádost o smazání
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Kontakt</CardTitle>
          <CardDescription>Email změníš kontaktováním podpory.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label htmlFor="p-email" className="mb-1 block text-xs font-medium">
                Email
              </label>
              <Input id="p-email" value={profile.email} readOnly className="bg-muted" />
              {profile.emailVerified ? (
                <p className="mt-1 text-xs text-emerald-700">✓ Ověřeno</p>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-xs text-amber-700">⚠ Neověřeno</p>
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await authFetch('/api/auth/send-verification-email', {
                        method: 'POST',
                      });
                      const d = await r.json().catch(() => ({}));
                      if (r.ok) {
                        setSuccess(
                          d.alreadyVerified
                            ? 'Email už je ověřený.'
                            : 'Ověřovací e-mail odeslán. Zkontroluj poštu (i spam).',
                        );
                      } else {
                        setError(d.message ?? 'Nepodařilo se odeslat.');
                      }
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    Poslat ověřovací e-mail
                  </button>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="p-name" className="mb-1 block text-xs font-medium">
                Jméno a příjmení
              </label>
              <Input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div>
              <label htmlFor="p-phone" className="mb-1 block text-xs font-medium">
                Telefon <span className="text-muted-foreground">(volitelné, pro SMS notif)</span>
              </label>
              <Input
                id="p-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+420 …"
                maxLength={30}
              />
              <PhoneVerify
                phone={phone}
                verified={profile.phoneVerified}
                onVerified={() => {
                  setSuccess('Telefon ověřen.');
                  void load();
                }}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Ukládám…' : 'Uložit kontakt'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {prefs ? (
        <Card>
          <CardHeader>
            <CardTitle>Notifikace</CardTitle>
            <CardDescription>Co chceš dostávat na email / SMS.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { key: 'orderConfirmations' as const, label: 'Potvrzení objednávek', alwaysOn: true },
              { key: 'preEventReminders' as const, label: 'Připomínka 24 h před akcí' },
              { key: 'abandonedCart' as const, label: 'Připomínka opuštěného košíku' },
              { key: 'promoterNews' as const, label: 'Novinky promotérů, které sleduji' },
              { key: 'marketing' as const, label: 'Marketing Tixly (jiné akce)' },
            ].map((row) => (
              <label
                key={row.key}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={prefs[row.key]}
                  onChange={(e) =>
                    setPrefs((p) => (p ? { ...p, [row.key]: e.target.checked } : p))
                  }
                  disabled={row.alwaysOn}
                />
                <span>{row.label}</span>
                {row.alwaysOn ? (
                  <span className="text-xs text-muted-foreground">(vždy zapnuté)</span>
                ) : null}
              </label>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.emailEnabled}
                  onChange={(e) =>
                    setPrefs((p) => (p ? { ...p, emailEnabled: e.target.checked } : p))
                  }
                />
                Email
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.smsEnabled}
                  onChange={(e) =>
                    setPrefs((p) => (p ? { ...p, smsEnabled: e.target.checked } : p))
                  }
                />
                SMS
              </label>
            </div>
            <Button onClick={savePrefs} disabled={busy} className="mt-3">
              {busy ? 'Ukládám…' : 'Uložit notifikace'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Soukromí (GDPR)</CardTitle>
          <CardDescription>
            Máš právo na stažení všech svých dat a smazání účtu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={downloadData} disabled={busy}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Stáhnout všechna moje data (JSON)
          </Button>
          {!profile.pendingDeletion ? (
            <>
              {!showDeleteConfirm ? (
                <Button
                  variant="outline"
                  className="border-rose-300 text-rose-700 hover:bg-rose-50"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                  Smazat můj účet
                </Button>
              ) : (
                <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                  <p className="mb-2 font-medium">Opravdu smazat účet?</p>
                  <p className="mb-3 text-xs">
                    Po 30 dnech budou tvá data anonymizována (jméno, email, telefon). Lístky
                    na již uskutečněné akce zůstávají v evidenci po dobu zákonné lhůty
                    (DPH záznamy). Než lhůta uplyne, můžeš žádost zrušit.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      Zrušit
                    </Button>
                    <Button
                      size="sm"
                      onClick={requestDeletion}
                      disabled={busy}
                      className="bg-rose-700 hover:bg-rose-800"
                    >
                      {busy ? 'Posílám…' : 'Ano, smazat'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sledování</CardTitle>
          <CardDescription>Pořadatelé, jejichž novinky chceš dostávat na e-mail.</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="follows" className="text-sm text-primary hover:underline">
            Sledovaní pořadatelé →
          </a>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Účet vytvořen {new Date(profile.createdAt).toLocaleDateString('cs-CZ')}.
      </p>
    </div>
  );
}

function PhoneVerify({
  phone,
  verified,
  onVerified,
}: {
  phone: string;
  verified: boolean;
  onVerified: () => void;
}) {
  const [step, setStep] = useState<'idle' | 'sent' | 'verified'>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (verified) {
    return <p className="mt-1 text-xs text-emerald-700">✓ Telefon ověřen</p>;
  }

  if (!phone) return null;

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const r = await authFetch('/api/buyer/phone-verification', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.message ?? d.error ?? 'Selhalo');
        return;
      }
      setStep('sent');
      if (d.note) setNote(d.note);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      const r = await authFetch('/api/buyer/phone-verification', {
        method: 'POST',
        body: JSON.stringify({ phone, code }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.message ?? d.error ?? 'Kód neplatný');
        return;
      }
      setStep('verified');
      onVerified();
    } finally {
      setBusy(false);
    }
  }

  if (step === 'idle') {
    return (
      <button
        type="button"
        onClick={() => void send()}
        disabled={busy}
        className="mt-1 text-xs text-primary hover:underline"
      >
        Ověřit telefon SMS kódem
      </button>
    );
  }

  if (step === 'sent') {
    return (
      <div className="mt-2 space-y-1 rounded-md border bg-muted/30 p-2">
        <label className="block text-xs font-medium">SMS kód</label>
        <div className="flex gap-2">
          <Input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123 456"
            className="max-w-[120px]"
          />
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || code.length !== 6}
            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            Ověřit
          </button>
        </div>
        {note ? <p className="text-[10px] text-muted-foreground">{note}</p> : null}
        {err ? <p className="text-xs text-rose-700">{err}</p> : null}
      </div>
    );
  }

  return null;
}

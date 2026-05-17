'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const STRINGS = {
  cs: {
    title: 'Nastav nové heslo',
    description: 'Vyplň nové heslo. Po uložení tě přihlásíme znovu na všech zařízeních.',
    newPassword: 'Nové heslo',
    confirm: 'Heslo (znovu)',
    submit: 'Uložit a přihlásit',
    saving: 'Ukládám…',
    ok: 'Heslo bylo změněno. Přesměrovávám na přihlášení…',
    mismatch: 'Hesla se neshodují.',
    weak: 'Heslo musí mít min. 8 znaků a obsahovat malé i velké písmeno nebo číslici.',
    invalidToken: 'Odkaz je neplatný nebo vypršel. Požádej o nový.',
    backToForgot: 'Požádat o nový odkaz',
    missingToken: 'Chybí token v URL. Zkontroluj, že jsi přišel přes odkaz z emailu.',
  },
  sk: {
    title: 'Nastav nové heslo',
    description: 'Vyplň nové heslo. Po uložení ťa odhlásime zo všetkých zariadení.',
    newPassword: 'Nové heslo',
    confirm: 'Heslo (znovu)',
    submit: 'Uložiť a prihlásiť',
    saving: 'Ukladám…',
    ok: 'Heslo bolo zmenené. Presmerovávam na prihlásenie…',
    mismatch: 'Heslá sa nezhodujú.',
    weak: 'Heslo musí mať min. 8 znakov a obsahovať malé i veľké písmeno alebo číslicu.',
    invalidToken: 'Odkaz je neplatný alebo vypršal. Požiadaj o nový.',
    backToForgot: 'Požiadať o nový odkaz',
    missingToken: 'Chýba token v URL.',
  },
  en: {
    title: 'Set new password',
    description: 'Enter a new password. We will log you out everywhere after saving.',
    newPassword: 'New password',
    confirm: 'Password (repeat)',
    submit: 'Save and login',
    saving: 'Saving…',
    ok: 'Password changed. Redirecting to login…',
    mismatch: 'Passwords do not match.',
    weak: 'Password must be 8+ chars with lower + upper letter or digit.',
    invalidToken: 'Link is invalid or expired. Request a new one.',
    backToForgot: 'Request new link',
    missingToken: 'Missing token in URL.',
  },
};

function Content() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const locale = (Array.isArray(params.locale) ? params.locale[0] : params.locale) ?? 'cs';
  const s = STRINGS[locale as keyof typeof STRINGS] ?? STRINGS.cs;
  const token = searchParams.get('token') ?? '';

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== pw2) {
      setError(s.mismatch);
      return;
    }
    if (pw.length < 8 || !/[a-z]/.test(pw) || !/[A-Z0-9]/.test(pw)) {
      setError(s.weak);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setError(s.invalidToken);
        } else {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          setError(j.message ?? `HTTP ${res.status}`);
        }
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push(`/${locale}/login?password_reset=ok`), 1500);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{s.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-rose-700">{s.missingToken}</p>
          <Link
            href={`/${locale}/forgot-password`}
            className="mt-3 inline-block text-sm text-primary hover:underline"
          >
            {s.backToForgot}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{s.title}</CardTitle>
        <CardDescription>{s.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
            {s.ok}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="rp-pw" className="mb-1 block text-xs font-medium">
                {s.newPassword}
              </label>
              <Input
                id="rp-pw"
                type="password"
                required
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            <div>
              <label htmlFor="rp-pw2" className="mb-1 block text-xs font-medium">
                {s.confirm}
              </label>
              <Input
                id="rp-pw2"
                type="password"
                required
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </div>

            {error ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">
                {error}
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? s.saving : s.submit}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto max-w-md py-10">
      <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
        <Content />
      </Suspense>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const STRINGS = {
  cs: {
    title: 'Zapomenuté heslo',
    description: 'Zadej email a my ti pošleme odkaz pro nastavení nového hesla.',
    email: 'E-mail',
    submit: 'Poslat odkaz',
    sending: 'Posílám…',
    ok: 'Pokud email v naší databázi existuje, poslali jsme na něj odkaz. Zkontroluj schránku (i spam).',
    backToLogin: '← Zpět na přihlášení',
  },
  sk: {
    title: 'Zabudnuté heslo',
    description: 'Zadaj email a my ti pošleme odkaz na nastavenie nového hesla.',
    email: 'E-mail',
    submit: 'Poslať odkaz',
    sending: 'Posielam…',
    ok: 'Ak email v našej databáze existuje, poslali sme naň odkaz. Skontroluj schránku (aj spam).',
    backToLogin: '← Späť na prihlásenie',
  },
  en: {
    title: 'Forgot password',
    description: 'Enter your email and we will send you a link to set a new password.',
    email: 'Email',
    submit: 'Send link',
    sending: 'Sending…',
    ok: 'If your email exists in our database, we sent you a link. Check your inbox (and spam).',
    backToLogin: '← Back to login',
  },
};

export default function ForgotPasswordPage() {
  const params = useParams();
  const locale = (Array.isArray(params.locale) ? params.locale[0] : params.locale) ?? 'cs';
  const s = STRINGS[locale as keyof typeof STRINGS] ?? STRINGS.cs;

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Vždy ok response — bez ohledu na to zda email existoval
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle>{s.title}</CardTitle>
          <CardDescription>{s.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
              {s.ok}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label htmlFor="fp-email" className="mb-1 block text-xs font-medium">
                  {s.email}
                </label>
                <Input
                  id="fp-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
                {busy ? s.sending : s.submit}
              </Button>
            </form>
          )}

          <div className="mt-6 text-center text-xs">
            <Link href={`/${locale}/login`} className="text-primary hover:underline">
              {s.backToLogin}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

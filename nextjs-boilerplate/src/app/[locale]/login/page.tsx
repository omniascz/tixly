'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PasskeyButton } from '@/components/passkey-button';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function LoginPage({ params }: { params: { locale: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get('from');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [requires2fa, setRequires2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Už přihlášený? Nezůstávej na login stránce — přesměruj na správný dashboard.
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data: { user?: unknown; roles?: { isPlatformAdmin?: boolean; promoterMemberships?: unknown[] } }) => {
        if (!data?.user) return;
        let target = `/${params.locale}/events`;
        if (data.roles?.isPlatformAdmin) target = '/platform';
        else if ((data.roles?.promoterMemberships?.length ?? 0) > 0) target = '/admin';
        if (fromParam && (fromParam.startsWith('/admin') || fromParam.startsWith('/platform'))) {
          target = fromParam;
        }
        router.replace(target);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, string> = { email, password };
      if (requires2fa) {
        if (useBackup) body.backupCode = backupCode.trim();
        else body.totpCode = totpCode.trim();
      }
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Server signalizuje, že má 2FA — přepneme do druhého kroku
        if (data.requires2fa) {
          setRequires2fa(true);
          setError(null);
          return;
        }
        setError(data.error ?? 'Přihlášení selhalo');
        return;
      }
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('roles', JSON.stringify(data.roles));

      let target = fromParam;
      if (!target) {
        if (data.roles?.isPlatformAdmin) target = '/platform';
        else if (data.roles?.promoterMemberships?.length > 0) target = '/admin';
        else target = `/${params.locale}/events`;
      }
      router.push(target);
      router.refresh();
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Přihlášení</CardTitle>
          <CardDescription>
            Vstup pro kupce, promotéry i master adminy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="login-email" className="mb-1 block text-xs font-medium">
                E-mail
              </label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                readOnly={requires2fa}
                className={requires2fa ? 'bg-muted' : ''}
              />
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1 block text-xs font-medium">
                Heslo
              </label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                readOnly={requires2fa}
                className={requires2fa ? 'bg-muted' : ''}
              />
            </div>
            {requires2fa ? (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium">
                  Tento účet má aktivní 2FA. Zadej kód z aplikace.
                </p>
                {!useBackup ? (
                  <div>
                    <label htmlFor="login-totp" className="mb-1 block text-xs font-medium">
                      6místný kód
                    </label>
                    <Input
                      id="login-totp"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="123 456"
                      required
                      autoFocus
                    />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="login-backup" className="mb-1 block text-xs font-medium">
                      Záložní kód (např. ABCD-1234)
                    </label>
                    <Input
                      id="login-backup"
                      value={backupCode}
                      onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                      placeholder="ABCD-1234"
                      required
                      autoFocus
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setUseBackup(!useBackup);
                    setTotpCode('');
                    setBackupCode('');
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  {useBackup ? 'Použít aplikační kód' : 'Ztratil/a jsem telefon — použít záložní kód'}
                </button>
              </div>
            ) : null}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading
                ? '...'
                : requires2fa
                  ? 'Ověřit a přihlásit'
                  : 'Přihlásit'}
            </Button>
          </form>

          {/* Social login */}
          <div className="relative my-4 flex items-center">
            <div className="flex-1 border-t border-border" />
            <span className="mx-3 text-xs text-muted-foreground">nebo</span>
            <div className="flex-1 border-t border-border" />
          </div>
          <div className="flex flex-col gap-2">
            <a
              href={`/api/auth/oauth/google?next=${encodeURIComponent(params.locale === 'cs' ? '/cs/moje-vstupenky' : '/en/my-tickets')}`}
              className="flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Pokračovat přes Google
            </a>
            <a
              href={`/api/auth/oauth/apple?next=${encodeURIComponent(params.locale === 'cs' ? '/cs/moje-vstupenky' : '/en/my-tickets')}`}
              className="flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.42c1.38.07 2.33.74 3.14.8 1.19-.24 2.33-.93 3.6-.84 1.53.12 2.68.72 3.44 1.84-3.13 1.87-2.39 5.98.48 7.13-.57 1.56-1.32 3.1-2.66 3.93zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              Pokračovat přes Apple
            </a>
            <a
              href={`/api/auth/oauth/facebook?next=${encodeURIComponent(params.locale === 'cs' ? '/cs/moje-vstupenky' : '/en/my-tickets')}`}
              className="flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
              </svg>
              Pokračovat přes Facebook
            </a>
            <PasskeyButton
              email={email || undefined}
              locale={params.locale}
              next={fromParam ?? undefined}
            />
          </div>

          <div className="mt-4 space-y-1 text-xs text-muted-foreground">
            <p>
              <Link
                href={`/${params.locale}/forgot-password`}
                className="text-primary hover:underline"
              >
                Zapomenuté heslo?
              </Link>
            </p>
            <p>
              Nemáš účet?{' '}
              <Link
                href={`/${params.locale}/register`}
                className="text-primary hover:underline"
              >
                Registrace kupujícího
              </Link>
            </p>
            <p>
              Jsi pořadatel?{' '}
              <Link
                href={`/${params.locale}/register-promoter`}
                className="text-primary hover:underline"
              >
                Registrace promotéra
              </Link>
            </p>
          </div>
          <div className="mt-4 rounded-md border bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
            <strong>Demo účty (heslo: Demo2026!):</strong>
            <br />
            superadmin@tixly.cz · admin@tixly.cz · pending@example.cz
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

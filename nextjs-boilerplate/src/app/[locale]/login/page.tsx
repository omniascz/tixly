'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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

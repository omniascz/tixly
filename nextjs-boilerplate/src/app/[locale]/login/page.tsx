'use client';
import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function LoginPage({ params }: { params: { locale: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get('from');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
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
              <label className="mb-1 block text-xs font-medium">E-mail</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Heslo</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '...' : 'Přihlásit'}
            </Button>
          </form>
          <div className="mt-4 space-y-1 text-xs text-muted-foreground">
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

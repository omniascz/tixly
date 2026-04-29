'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
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

export default function RegisterPage({ params }: { params: { locale: string } }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Registrace selhala');
        return;
      }
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      router.push(`/${params.locale}/events`);
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
          <CardTitle>Registrace kupujícího</CardTitle>
          <CardDescription>Pro nákup vstupenek.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Jméno</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
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
              <label className="mb-1 block text-xs font-medium">
                Heslo (min. 8 znaků)
              </label>
              <Input
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '...' : 'Registrovat'}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Máš účet?{' '}
            <Link
              href={`/${params.locale}/login`}
              className="text-primary hover:underline"
            >
              Přihlásit
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

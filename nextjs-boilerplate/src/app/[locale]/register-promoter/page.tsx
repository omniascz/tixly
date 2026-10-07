'use client';
import { FormEvent, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function RegisterPromoterPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = use(props.params);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError('Hesla se neshodují');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register-promoter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Registrace selhala');
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { accessToken?: string; redirectTo?: string };
      if (json.accessToken) {
        localStorage.setItem('accessToken', json.accessToken);
      }
      router.push(json.redirectTo ?? '/admin/onboarding');
      router.refresh();
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Registrace promotéra</CardTitle>
          <CardDescription>
            Stačí e-mail a heslo — údaje o organizaci doplníš později
            v administraci.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label
                htmlFor="promoter-email"
                className="mb-1 block text-xs font-medium"
              >
                E-mail
              </label>
              <Input
                id="promoter-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="promoter-password"
                className="mb-1 block text-xs font-medium"
              >
                Heslo (min. 8 znaků)
              </label>
              <Input
                id="promoter-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="promoter-password-confirm"
                className="mb-1 block text-xs font-medium"
              >
                Heslo znovu
              </label>
              <Input
                id="promoter-password-confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '...' : 'Registrovat se jako promotér'}
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

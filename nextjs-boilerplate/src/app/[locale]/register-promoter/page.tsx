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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function RegisterPromoterPage({
  params,
}: {
  params: { locale: string };
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register-promoter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password, companyName, slug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Registrace selhala');
        return;
      }
      // Nový promotér → onboarding wizard, ne přímo dashboard
      router.push('/admin/onboarding');
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
            Po registraci čeká účet na schválení master adminem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label
                htmlFor="promoter-name"
                className="mb-1 block text-xs font-medium"
              >
                Tvoje jméno
              </label>
              <Input
                id="promoter-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
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
                htmlFor="promoter-company"
                className="mb-1 block text-xs font-medium"
              >
                Název organizace
              </label>
              <Input
                id="promoter-company"
                autoComplete="organization"
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                required
              />
            </div>
            <div>
              <label
                htmlFor="promoter-slug"
                className="mb-1 block text-xs font-medium"
              >
                URL slug (a-z, 0-9, pomlčky)
              </label>
              <Input
                id="promoter-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                pattern="[a-z0-9-]+"
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

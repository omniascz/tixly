'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function B2BLoginPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/b2b/account/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteToken: token.trim() }),
      });
      const data = (await res.json()) as { token?: string; companyName?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error === 'INVITE_TOKEN_INVALID' ? 'Neplatný nebo již použitý kód pozvánky.' : 'Přihlášení se nezdařilo.');
        return;
      }
      localStorage.setItem('b2bToken', data.token);
      router.push('/b2b/dashboard');
    } catch {
      setError('Síťová chyba.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Firemní portál Tixly</CardTitle>
          <CardDescription>Zadejte kód pozvánky, který jste obdrželi od správce účtu.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="b2b-invite-token" className="mb-1 block text-xs font-medium">
                Kód pozvánky
              </label>
              <Input
                id="b2b-invite-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Vložte kód pozvánky"
                required
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={loading || !token.trim()} className="w-full">
              {loading ? '...' : 'Přihlásit se'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

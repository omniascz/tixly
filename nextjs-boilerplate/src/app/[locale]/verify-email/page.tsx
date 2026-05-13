'use client';

/**
 * /cs/verify-email?token=X
 *
 * Klientská stránka, která hned po načtení zavolá `/api/auth/verify-email`
 * a podle response zobrazí success / expired / invalid hlášku.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type Status = 'loading' | 'verified' | 'invalid_or_expired' | 'invalid' | 'user_not_found' | 'network_error';

export default function VerifyEmailPage({ params }: { params: { locale: string } }) {
  const sp = useSearchParams();
  const token = sp.get('token');
  const [status, setStatus] = useState<Status>('loading');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
        const data = (await res.json()) as { status: Status; email?: string };
        setStatus(data.status);
        if (data.email) setEmail(data.email);
      } catch {
        setStatus('network_error');
      }
    })();
  }, [token]);

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle>Ověření e-mailu</CardTitle>
        </CardHeader>
        <CardContent>
          {status === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Ověřuji…
            </div>
          ) : null}

          {status === 'verified' ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-emerald-900">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" aria-hidden />
                <div>
                  <p className="font-medium">E-mail je ověřený</p>
                  {email ? <p className="text-xs text-muted-foreground">{email}</p> : null}
                </div>
              </div>
              <div className="flex gap-2">
                <Link href={`/${params.locale}/events`}>
                  <Button variant="outline" size="sm">
                    Procházet akce
                  </Button>
                </Link>
                <Link href={`/${params.locale}/profile`}>
                  <Button size="sm">Můj profil</Button>
                </Link>
              </div>
            </div>
          ) : null}

          {status === 'invalid_or_expired' ? (
            <div className="flex items-start gap-2 text-amber-900">
              <XCircle className="mt-0.5 h-5 w-5 text-amber-600" aria-hidden />
              <div>
                <p className="font-medium">Odkaz vypršel nebo je neplatný</p>
                <p className="text-xs">
                  Vyžádej si nový ověřovací e-mail v{' '}
                  <Link
                    href={`/${params.locale}/profile`}
                    className="text-primary hover:underline"
                  >
                    profilu
                  </Link>
                  .
                </p>
              </div>
            </div>
          ) : null}

          {(status === 'invalid' || status === 'user_not_found') ? (
            <div className="flex items-start gap-2 text-rose-900">
              <XCircle className="mt-0.5 h-5 w-5 text-rose-600" aria-hidden />
              <p className="font-medium">Neplatný odkaz</p>
            </div>
          ) : null}

          {status === 'network_error' ? (
            <div className="flex items-start gap-2 text-rose-900">
              <XCircle className="mt-0.5 h-5 w-5 text-rose-600" aria-hidden />
              <p className="font-medium">Síťová chyba — zkus to znovu.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

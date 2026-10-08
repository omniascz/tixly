'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams, useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const SCOPE_LABELS: Record<string, string> = {
  marketing: 'marketingové zprávy Tixly',
  promoter_news: 'novinky promotérů',
  all: 'všechny propagační e-maily',
};

export default function UnsubscribePage(_props: { params: Promise<{ locale: string }> }) {
  const params = useParams<{ locale: string }>();
  const sp = useSearchParams();
  const token = sp.get('token');
  const [status, setStatus] = useState<'loading' | 'unsubscribed' | 'invalid' | 'network_error'>(
    'loading',
  );
  const [scope, setScope] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/auth/unsubscribe?token=${encodeURIComponent(token)}`);
        const data = (await res.json()) as { status: string; scope?: string };
        if (data.status === 'unsubscribed') {
          setStatus('unsubscribed');
          setScope(data.scope ?? null);
        } else {
          setStatus('invalid');
        }
      } catch {
        setStatus('network_error');
      }
    })();
  }, [token]);

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle>Odhlášení z e-mailů</CardTitle>
        </CardHeader>
        <CardContent>
          {status === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Zpracovávám…
            </div>
          ) : null}

          {status === 'unsubscribed' ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2 text-emerald-900">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" aria-hidden />
                <p>
                  Odhlášeno z: <strong>{SCOPE_LABELS[scope ?? ''] ?? 'všech kategorií'}</strong>.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Transakční e-maily (potvrzení objednávky, ověření e-mailu) ti budeme posílat dál —
                ty nelze odhlásit, protože jsou nezbytné pro správu účtu. Můžeš si jemné nastavení
                upravit v profilu.
              </p>
              <Link
                href={`/${params.locale}/profile`}
                className="inline-block text-sm text-primary hover:underline"
              >
                Upravit notifikace v profilu
              </Link>
            </div>
          ) : null}

          {status === 'invalid' ? (
            <div className="flex items-start gap-2 text-rose-900">
              <XCircle className="mt-0.5 h-5 w-5 text-rose-600" aria-hidden />
              <p className="text-sm">Neplatný nebo prošlý odhlašovací odkaz.</p>
            </div>
          ) : null}

          {status === 'network_error' ? (
            <p className="text-sm text-rose-700">Síťová chyba — zkus to znovu.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

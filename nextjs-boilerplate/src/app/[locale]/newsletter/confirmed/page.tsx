import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

export default async function NewsletterConfirmedPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ status?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const isOk = searchParams.status === 'ok';
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <Card>
        <CardContent className="space-y-3 py-8">
          {isOk ? (
            <>
              <div className="text-4xl" aria-hidden>✅</div>
              <h1 className="text-2xl font-bold">Potvrzeno!</h1>
              <p className="text-sm text-muted-foreground">
                Tvůj e-mail je úspěšně přihlášený k odběru. Děkujeme!
              </p>
              <p className="text-xs text-muted-foreground">
                Nastavení můžeš kdykoliv upravit v{' '}
                <Link
                  href={`/${params.locale}/profile`}
                  className="text-primary hover:underline"
                >
                  profilu
                </Link>{' '}
                nebo přes odkaz „Odhlásit" v každém e-mailu.
              </p>
              <div className="pt-3">
                <Link
                  href={`/${params.locale}/events`}
                  className="text-sm text-primary hover:underline"
                >
                  Procházet akce →
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="text-4xl" aria-hidden>⚠️</div>
              <h1 className="text-2xl font-bold">Něco se nezdařilo</h1>
              <p className="text-sm text-muted-foreground">
                {searchParams.error === 'invalid-token'
                  ? 'Odkaz je neplatný nebo už byl použit.'
                  : 'Zkus si vyžádat nový potvrzovací e-mail.'}
              </p>
              <Link
                href={`/${params.locale}/profile`}
                className="inline-block pt-3 text-sm text-primary hover:underline"
              >
                Spravovat notifikace
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

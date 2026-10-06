import { Pool } from 'pg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { formatMoney } from '@/lib/format';
import { TixlyPlusSubscribe } from './TixlyPlusSubscribe';

export const dynamic = 'force-dynamic';

interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  price_halire: number;
  billing_cycle: string;
  allowance_per_period: number;
  promoter_name: string | null;
}

async function fetchPlans(): Promise<PlanRow[]> {
  const db = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  try {
    const r = await db.query<PlanRow>(
      `SELECT p.id, p.name, p.description, p.price_halire, p.billing_cycle,
              p.allowance_per_period, pr.name AS promoter_name
       FROM subscriptions.plans p
       LEFT JOIN platform.promoters pr ON pr.id = p.promoter_id
       WHERE p.active = true
       ORDER BY p.price_halire ASC
       LIMIT 50`,
    );
    return r.rows;
  } finally {
    await db.end();
  }
}

export default async function TixlyPlusPage({
  params,
}: {
  params: { locale: string };
}) {
  const plans = await fetchPlans();

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Tixly+</h1>
        <p className="mt-2 text-muted-foreground">
          Předplatné, které ti otevírá dveře. Slevy, přednostní prodej, exkluzivní akce.
        </p>
        <p className="mt-3 text-sm">
          <a
            href={`/${params.locale}/subscriptions`}
            className="text-primary hover:underline"
          >
            Už předplatné mám — spravovat moje
          </a>
        </p>
      </div>

      {plans.length === 0 ? (
        <p className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Zatím žádný plán v prodeji. Mrkni později.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {plans.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                {p.promoter_name ? (
                  <p className="text-xs text-muted-foreground">{p.promoter_name}</p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {p.description ? (
                  <p className="text-sm leading-relaxed whitespace-pre-line">
                    {p.description}
                  </p>
                ) : null}
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">
                    {formatMoney(p.price_halire, 'CZK')}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    / {p.billing_cycle === 'monthly' ? 'měsíc' : 'rok'}
                  </span>
                </div>
                <div className="rounded-md bg-muted/40 p-2 text-xs">
                  Zahrnuje: <strong>{p.allowance_per_period}</strong>{' '}
                  {p.billing_cycle === 'monthly'
                    ? 'jednotek měsíčně'
                    : 'jednotek ročně'}
                </div>
                <TixlyPlusSubscribe planId={p.id} locale={params.locale} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

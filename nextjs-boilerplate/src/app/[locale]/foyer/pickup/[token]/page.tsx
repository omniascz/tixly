import { notFound } from 'next/navigation';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusButton } from './StatusButton';

interface FoyerOrderRow {
  id: string;
  event_id: string;
  pickup_qr_token: string;
  total_halire: number;
  status: string;
  buyer_email: string | null;
  created_at: string;
  event_title: string | null;
}

interface FoyerOrderItemRow {
  item_name: string;
  quantity: number;
  unit_halire: number;
}

async function fetchFoyerOrder(token: string) {
  return runWithServiceContext(async () => {
    const orderRes = await db().query<FoyerOrderRow>(
      `SELECT fo.id, fo.event_id, fo.pickup_qr_token, fo.total_halire,
              fo.status, fo.buyer_email, fo.created_at,
              e.title AS event_title
       FROM orders.foyer_orders fo
       LEFT JOIN catalog.events e ON e.id = fo.event_id
       WHERE fo.pickup_qr_token = $1`,
      [token],
    );
    if (orderRes.rows.length === 0) return null;
    const order = orderRes.rows[0];

    const itemsRes = await db().query<FoyerOrderItemRow>(
      `SELECT item_name, quantity, unit_halire
       FROM orders.foyer_order_items
       WHERE foyer_order_id = $1
       ORDER BY item_name`,
      [order.id],
    );

    return { order, items: itemsRes.rows };
  });
}

export default async function FoyerPickupPage(
  props: {
    params: Promise<{ token: string; locale: string }>;
  }
) {
  const params = await props.params;
  const data = await fetchFoyerOrder(params.token);
  if (!data) notFound();

  const { order, items } = data;

  const isReady = order.status === 'ready';
  const isCollected = order.status === 'collected';

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">
            {isCollected
              ? 'Objednávka vyzvednutá'
              : isReady
              ? 'Objednávka je připravena'
              : 'Vaše předobjednávka'}
          </CardTitle>
          {order.event_title ? (
            <p className="text-sm text-muted-foreground">{order.event_title}</p>
          ) : null}
          <p className="text-xs text-muted-foreground font-mono">
            #{order.pickup_qr_token.slice(0, 8).toUpperCase()}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y rounded-md border">
            {items.map((item, idx) => (
              <li key={idx} className="flex justify-between px-3 py-2 text-sm">
                <span>
                  {item.quantity}× {item.item_name}
                </span>
                <span className="text-muted-foreground">
                  {((item.unit_halire * item.quantity) / 100).toLocaleString('cs-CZ')} Kč
                </span>
              </li>
            ))}
          </ul>

          <div className="flex justify-between border-t pt-3 text-sm font-semibold">
            <span>Celkem</span>
            <span>{(order.total_halire / 100).toLocaleString('cs-CZ')} Kč</span>
          </div>

          {isCollected ? (
            <div className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600 text-center">
              Tato objednávka byla vydána. Dobrou chuť!
            </div>
          ) : isReady ? (
            <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-4 text-center">
              <p className="text-2xl font-bold text-emerald-700">PŘIPRAVENO</p>
              <p className="mt-1 text-sm text-emerald-600">
                Ukažte tuto obrazovku nebo QR kód u baru.
              </p>
              <StatusButton orderId={order.id} currentStatus="ready" />
            </div>
          ) : (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-sm font-medium text-amber-800">Čeká na přípravu</p>
              <p className="mt-1 text-xs text-amber-700">
                Bar obdrží vaši objednávku. Ukažte QR kód při vyzvednutí.
              </p>
              <StatusButton orderId={order.id} currentStatus="pending" />
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

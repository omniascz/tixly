import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Pool } from 'pg';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { formatDate, formatMoney, isCurrency } from '@/lib/format';
import { getDict } from '@/lib/i18n-dictionaries';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';
import { ResaleButton } from './ResaleButton';
import { SelfRefundButton } from './SelfRefundButton';

interface OrderRow {
  id: string;
  status: string;
  total_amount: number;
  currency: string;
  paid_at: string | null;
  buyer_email: string;
  event_title: string | null;
  event_date_start: string | null;
  venue_name: string | null;
}

interface ItemRow {
  ticket_type_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

async function fetchOrder(orderId: string) {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const orderRes = await db.query<OrderRow>(
      `SELECT
         o.id, o.status, o.total_amount, o.currency, o.paid_at,
         u.email AS buyer_email,
         e.title AS event_title, e.date_start AS event_date_start,
         v.name AS venue_name
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       LEFT JOIN catalog.events e ON e.id = o.event_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE o.id = $1`,
      [orderId],
    );
    if (orderRes.rows.length === 0) return null;

    const itemsRes = await db.query<ItemRow>(
      `SELECT tt.name AS ticket_type_name,
              oi.quantity, oi.unit_price, oi.total_price
       FROM orders.order_items oi
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at`,
      [orderId],
    );

    const ticketsRes = await db.query<{
      id: string;
      original_price: number;
      ticket_type_id: string;
      ticket_type_name: string;
      pass_kind: string | null;
      picks_required: number | null;
      redemption_count: number;
    }>(
      `SELECT t.id, t.original_price, t.ticket_type_id,
              tt.name AS ticket_type_name,
              f.pass_kind, f.picks_required,
              (SELECT COUNT(*)::int FROM tickets.ticket_redemptions r WHERE r.ticket_id = t.id) AS redemption_count
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       LEFT JOIN catalog.flex_pass_settings f ON f.ticket_type_id = tt.id
       WHERE t.order_id = $1 AND t.status = 'valid'
       ORDER BY t.created_at`,
      [orderId],
    );

    const addonsRes = await db.query<{
      addon_name: string;
      category: string;
      quantity: number;
      subtotal_halire: number;
    }>(
      `SELECT addon_name, category, quantity, subtotal_halire
       FROM public.order_addons
       WHERE order_id = $1
       ORDER BY created_at`,
      [orderId],
    );

    return {
      order: orderRes.rows[0]!,
      items: itemsRes.rows,
      tickets: ticketsRes.rows,
      addons: addonsRes.rows,
    };
  } finally {
    await db.end();
  }
}

export const dynamic = 'force-dynamic';

export default async function OrderConfirmationPage({
  params,
}: {
  params: { locale: string; orderId: string };
}) {
  const data = await fetchOrder(params.orderId);
  if (!data) notFound();
  const { order, items, tickets, addons } = data;
  const isPaid = order.status === 'paid';
  const ccy = isCurrency(order.currency) ? order.currency : 'CZK';
  const locale = isValidLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = getDict(locale).orderConfirmation;

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {isPaid ? t.paid : `${t.status}: ${order.status}`}
          </CardTitle>
          <CardDescription>
            {isPaid ? t.paidDescription : t.unpaidDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {order.event_title && (
            <div>
              <h2 className="text-lg font-semibold">{order.event_title}</h2>
              {order.event_date_start && (
                <p className="text-xs text-muted-foreground">
                  {formatDate(order.event_date_start, locale)}
                </p>
              )}
              {order.venue_name && (
                <p className="text-xs text-muted-foreground">{order.venue_name}</p>
              )}
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">{t.type}</th>
                <th className="text-center">{t.qty}</th>
                <th className="text-right">{t.pricePerUnit}</th>
                <th className="text-right">{t.total}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2">{it.ticket_type_name}</td>
                  <td className="text-center">{it.quantity}×</td>
                  <td className="text-right">{formatMoney(it.unit_price, ccy)}</td>
                  <td className="text-right">{formatMoney(it.total_price, ccy)}</td>
                </tr>
              ))}
              {addons.map((a, i) => (
                <tr key={`addon-${i}`} className="border-b text-muted-foreground">
                  <td className="py-2 italic">+ {a.addon_name}</td>
                  <td className="text-center">{a.quantity}×</td>
                  <td className="text-right">
                    {formatMoney(a.subtotal_halire / a.quantity, ccy)}
                  </td>
                  <td className="text-right">{formatMoney(a.subtotal_halire, ccy)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="py-3 text-right font-medium">
                  {t.total}:
                </td>
                <td className="py-3 text-right text-lg font-bold">
                  {formatMoney(order.total_amount, ccy)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div className="text-xs text-muted-foreground">
            <div>
              {t.orderNumber}: <code>{order.id}</code>
            </div>
            <div>{t.email}: {order.buyer_email}</div>
          </div>

          {isPaid &&
            tickets.some((t) => t.pass_kind === 'flex' || t.pass_kind === 'season') ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <h3 className="text-sm font-semibold">Permanentka — využití termínů</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {tickets
                  .filter((t) => t.pass_kind)
                  .map((t) => {
                    const used = t.redemption_count;
                    const total =
                      t.pass_kind === 'season'
                        ? null
                        : t.picks_required ?? 0;
                    const label =
                      t.pass_kind === 'season'
                        ? `Sezóna · ${used} návštěv`
                        : `Vybráno ${used}/${total} termínů`;
                    return (
                      <li
                        key={t.id}
                        className="flex items-center justify-between"
                      >
                        <span>{t.ticket_type_name}</span>
                        <span className="text-xs">
                          {label}
                          {total !== null && used >= total ? (
                            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                              vyčerpáno
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Termíny se konzumují automaticky při check-inu na bráně.
              </p>
            </div>
          ) : null}

          {isPaid && tickets.length > 0 ? (
            <div className="space-y-2">
              <ResaleButton
                buyerEmail={order.buyer_email}
                ticketIds={tickets.map((t) => t.id)}
                originalPriceHalire={tickets[0]!.original_price}
              />
              <SelfRefundButton orderId={order.id} />
            </div>
          ) : null}

          <Link
            href={`/${params.locale}/events`}
            className="inline-block text-sm text-primary hover:underline"
          >
            {t.backToEvents}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

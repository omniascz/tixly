import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCzechDate, formatMoney, isCurrency } from '@/lib/format';
import type { OrderStatus } from '@/types/admin';
import { SupportActions } from './SupportActions';

export const dynamic = 'force-dynamic';

interface OrderDetail {
  id: string;
  status: string;
  paymentProvider: string | null;
  gopayPaymentId: string | null;
  totalAmount: number;
  currency: string;
  discountAmount: number;
  promoCodeId: string | null;
  requiresAgeVerification: boolean;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  buyer: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
  };
  event: {
    id: string;
    title: string;
    dateStart: string;
    venueName: string | null;
    promoterId: string;
  };
  items: Array<{
    ticketTypeName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  tickets: Array<{
    id: string;
    status: string;
    transferCount: number;
    usedAt: string | null;
    revokedAt: string | null;
    ticketTypeName: string;
  }>;
  auditEntries: Array<{
    id: string;
    createdAt: string;
    action: string;
    actorEmail: string | null;
    oldValues: unknown;
    newValues: unknown;
  }>;
}

async function fetchOrder(orderId: string): Promise<OrderDetail | null> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const orderRes = await db.query(
      `SELECT
         o.id, o.status, o.payment_provider, o.gopay_payment_id,
         o.total_amount, o.currency, o.discount_halire, o.promo_code_id,
         o.requires_age_verification, o.paid_at, o.created_at, o.updated_at,
         u.id AS buyer_id, u.name AS buyer_name, u.email AS buyer_email, u.phone AS buyer_phone,
         e.id AS event_id, e.title AS event_title, e.date_start AS event_date_start,
         e.promoter_id AS event_promoter_id,
         v.name AS venue_name
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       LEFT JOIN catalog.events e ON e.id = o.event_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE o.id = $1`,
      [orderId],
    );
    if (orderRes.rows.length === 0) return null;
    const o = orderRes.rows[0];

    const itemsRes = await db.query(
      `SELECT tt.name AS ticket_type_name, oi.quantity, oi.unit_price, oi.total_price
       FROM orders.order_items oi
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at`,
      [orderId],
    );

    const ticketsRes = await db.query(
      `SELECT t.id, t.status, t.transfer_count, t.used_at, t.revoked_at,
              tt.name AS ticket_type_name
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       WHERE t.order_id = $1
       ORDER BY t.created_at`,
      [orderId],
    );

    const auditRes = await db.query(
      `SELECT al.id, al.created_at, al.action,
              al.old_values, al.new_values,
              u.email AS actor_email
       FROM audit.audit_log al
       LEFT JOIN identity.users u ON u.id = al.actor_id
       WHERE al.schema_name = 'orders' AND al.table_name = 'orders' AND al.record_id = $1
       ORDER BY al.created_at DESC`,
      [orderId],
    );

    return {
      id: o.id,
      status: o.status,
      paymentProvider: o.payment_provider,
      gopayPaymentId: o.gopay_payment_id,
      totalAmount: o.total_amount,
      currency: o.currency ?? 'CZK',
      discountAmount: o.discount_halire,
      promoCodeId: o.promo_code_id,
      requiresAgeVerification: o.requires_age_verification,
      paidAt: o.paid_at,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
      buyer: {
        id: o.buyer_id,
        name: o.buyer_name,
        email: o.buyer_email,
        phone: o.buyer_phone,
      },
      event: {
        id: o.event_id,
        title: o.event_title,
        dateStart: o.event_date_start,
        venueName: o.venue_name,
        promoterId: o.event_promoter_id,
      },
      items: itemsRes.rows.map((i) => ({
        ticketTypeName: i.ticket_type_name,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        totalPrice: i.total_price,
      })),
      tickets: ticketsRes.rows.map((t) => ({
        id: t.id,
        status: t.status,
        transferCount: t.transfer_count,
        usedAt: t.used_at,
        revokedAt: t.revoked_at,
        ticketTypeName: t.ticket_type_name,
      })),
      auditEntries: auditRes.rows.map((a) => ({
        id: a.id,
        createdAt: a.created_at,
        action: a.action,
        actorEmail: a.actor_email,
        oldValues: a.old_values,
        newValues: a.new_values,
      })),
    };
  } finally {
    await db.end();
  }
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: { orderId: string };
}) {
  const data = await fetchOrder(params.orderId);
  if (!data) notFound();

  const ccy = isCurrency(data.currency) ? data.currency : 'CZK';

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Objednávka {data.id.slice(0, 8)}</h1>
          <p className="text-sm text-muted-foreground">
            Vytvořeno {formatCzechDate(data.createdAt)}
          </p>
        </div>
        <Link
          href="/admin/orders"
          className="text-sm text-primary hover:underline"
        >
          ← Zpět na seznam
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={data.status as OrderStatus} />
            {data.paidAt ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Zaplaceno {formatCzechDate(data.paidAt)}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Celkem</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoney(data.totalAmount, ccy)}</div>
            {data.discountAmount > 0 ? (
              <p className="mt-1 text-xs text-emerald-700">
                Sleva: −{formatMoney(data.discountAmount, ccy)}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Platba</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{data.paymentProvider ?? '—'}</p>
            {data.gopayPaymentId ? (
              <p className="text-xs font-mono text-muted-foreground">
                {data.gopayPaymentId}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Akce a kupec</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Akce</p>
            <p className="font-medium">{data.event.title}</p>
            <p className="text-xs text-muted-foreground">
              {data.event.dateStart
                ? formatCzechDate(data.event.dateStart)
                : '—'}
              {data.event.venueName ? ` · ${data.event.venueName}` : ''}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Kupující</p>
            <p className="font-medium">{data.buyer.name ?? data.buyer.email}</p>
            <p className="text-xs text-muted-foreground">
              <a href={`mailto:${data.buyer.email}`} className="hover:underline">
                {data.buyer.email}
              </a>
              {data.buyer.phone ? ` · ${data.buyer.phone}` : ''}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Položky</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Typ</th>
                <th className="text-center">Počet</th>
                <th className="text-right">Cena/ks</th>
                <th className="text-right">Celkem</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2">{it.ticketTypeName}</td>
                  <td className="text-center">{it.quantity}×</td>
                  <td className="text-right">{formatMoney(it.unitPrice, ccy)}</td>
                  <td className="text-right">{formatMoney(it.totalPrice, ccy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vstupenky ({data.tickets.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Pro tuto objednávku zatím žádné vstupenky (vydávají se po platbě).
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">ID</th>
                  <th>Typ</th>
                  <th>Stav</th>
                  <th>Použito / zrušeno</th>
                  <th>Transfery</th>
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      <Link
                        href={`/admin/scanner?ticketId=${t.id}`}
                        className="hover:underline"
                      >
                        {t.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{t.ticketTypeName}</td>
                    <td>
                      <StatusBadge status={t.status as OrderStatus} />
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {t.usedAt
                        ? `Použito ${new Date(t.usedAt).toLocaleString('cs-CZ')}`
                        : t.revokedAt
                          ? `Zrušeno ${new Date(t.revokedAt).toLocaleString('cs-CZ')}`
                          : '—'}
                    </td>
                    <td>{t.transferCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <SupportActions
        orderId={data.id}
        buyerEmail={data.buyer.email}
        orderStatus={data.status}
        totalAmount={data.totalAmount}
        currency={ccy}
        tickets={data.tickets.map((t) => ({
          id: t.id,
          status: t.status,
          ticketTypeName: t.ticketTypeName,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Historie změn (audit log)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.auditEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Žádné změny zaznamenané v audit logu.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.auditEntries.map((a) => (
                <li key={a.id} className="rounded-md border bg-muted/30 p-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{a.action}</span>
                    <span>{new Date(a.createdAt).toLocaleString('cs-CZ')}</span>
                  </div>
                  {a.actorEmail ? (
                    <div className="text-xs">{a.actorEmail}</div>
                  ) : null}
                  {a.newValues ? (
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(a.newValues, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

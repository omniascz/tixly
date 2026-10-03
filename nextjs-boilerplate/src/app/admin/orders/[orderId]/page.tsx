import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge, TicketStatusBadge } from '@/components/admin/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db/rls-pool';
import { formatCzechDate, formatMoney, formatOrderNumber, isCurrency, type Currency } from '@/lib/format';
import { runAsServerPromoter } from '@/lib/server-session';
import type { OrderStatus } from '@/types/admin';
import { SupportActions } from './SupportActions';

export const dynamic = 'force-dynamic';

interface OrderDetail {
  id: string;
  /** Číslo, které vidí kupující i seznam objednávek. */
  orderNumber: string | null;
  status: string;
  paymentProvider: string | null;
  gopayPaymentId: string | null;
  totalAmount: number;
  currency: string;
  discountAmount: number;
  /** Servisní poplatek platformy, který zaplatil kupující navíc k ceně vstupenek. */
  serviceFeeMinor: number;
  /** Provize partnera, pokud objednávka přišla přes affiliate odkaz. */
  affiliateCommissionMinor: number;
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
  /**
   * Historie objednávky ze dvou zdrojů: audit.audit_log (refundace) a
   * audit.support_actions (odeslané e-maily, převody, změny jména, storna
   * jednotlivých vstupenek). Druhý zdroj detail dosud vůbec nečetl, takže
   * všechno kromě refundací bylo v historii neviditelné.
   */
  history: Array<{
    id: string;
    createdAt: string;
    kind: string;
    actorEmail: string | null;
    reason: string | null;
    amountHalire: number | null;
    raw: unknown;
  }>;
}

async function fetchOrder(orderId: string): Promise<OrderDetail | null> {
  // Server-component fetch pod ENFORCED RLS: promoter kontext z accessToken cookie.
  // RLS policy na orders sama omezí na objednávky AKCÍ TOHOTO promotéra → cizí orderId
  // vrátí 0 řádků = notFound (opravuje dřívější IDOR: query nemá promoter filtr).
  // runAs* vrátí null i když uživatel není přihlášený/nemá promotéra.
  return runAsServerPromoter(async () => {
    const orderRes = await db().query(
      `SELECT
         o.id, o.status, o.payment_provider, o.gopay_payment_id,
         o.total_amount, o.currency, o.discount_halire, o.promo_code_id,
         o.service_fee_minor, o.affiliate_commission_minor,
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

    const itemsRes = await db().query(
      `SELECT tt.name AS ticket_type_name, oi.quantity, oi.unit_price, oi.total_price
       FROM orders.order_items oi
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at`,
      [orderId],
    );

    const ticketsRes = await db().query(
      `SELECT t.id, t.status, t.transfer_count, t.used_at, t.revoked_at,
              tt.name AS ticket_type_name
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       WHERE t.order_id = $1
       ORDER BY t.created_at`,
      [orderId],
    );

    // Dva zdroje historie sloučené do jedné časové osy.
    //
    // Pozor na dvě věci, které tenhle UNION nesnese bez přetypování:
    //   1) audit_log.id je bigint, support_actions.id je uuid → obojí na text
    //      s prefixem, aby zůstaly klíče unikátní napříč zdroji,
    //   2) audit_log.record_id je text, support_actions.target_order_id je uuid
    //      → jeden parametr $1 nemůže být obojí, proto ::text.
    const historyRes = await db().query(
      `SELECT 'log-' || al.id::text AS id, al.created_at,
              COALESCE(al.new_values->>'kind', LOWER(al.action)) AS kind,
              al.new_values->>'reason' AS reason,
              (al.new_values->>'amount_halire')::int AS amount_halire,
              al.new_values AS raw,
              u.email AS actor_email
         FROM audit.audit_log al
         LEFT JOIN identity.users u ON u.id = al.actor_id
        WHERE al.schema_name = 'orders' AND al.table_name = 'orders' AND al.record_id = $1
        UNION ALL
       SELECT 'sa-' || sa.id::text AS id, sa.created_at,
              sa.action AS kind,
              sa.reason,
              sa.amount_halire,
              sa.metadata AS raw,
              su.email AS actor_email
         FROM audit.support_actions sa
         LEFT JOIN identity.users su ON su.id = sa.actor_user_id
        WHERE sa.target_order_id::text = $1
        ORDER BY created_at DESC`,
      [orderId],
    );

    return {
      id: o.id,
      // Stejný kód, jaký ukazuje seznam objednávek — dřív tu byl jiný řetězec
      // než ten, podle kterého uživatel objednávku hledal.
      orderNumber: formatOrderNumber(o.id),
      status: o.status,
      paymentProvider: o.payment_provider,
      gopayPaymentId: o.gopay_payment_id,
      totalAmount: o.total_amount,
      currency: o.currency ?? 'CZK',
      discountAmount: o.discount_halire,
      serviceFeeMinor: o.service_fee_minor ?? 0,
      affiliateCommissionMinor: o.affiliate_commission_minor ?? 0,
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
      history: historyRes.rows.map((a) => ({
        id: a.id,
        createdAt: a.created_at,
        kind: a.kind ?? 'unknown',
        actorEmail: a.actor_email,
        reason: a.reason,
        amountHalire: a.amount_halire,
        raw: a.raw,
      })),
    };
  });
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: { orderId: string };
}) {
  const data = await fetchOrder(params.orderId);
  if (!data) notFound();

  const ccy = isCurrency(data.currency) ? data.currency : 'CZK';
  const itemsSum = data.items.reduce((sum, it) => sum + it.totalPrice, 0);
  // Shodné s modulem Výplaty: promotérovi náleží zaplacená částka bez
  // servisního poplatku platformy.
  const promoterGross = data.totalAmount - data.serviceFeeMinor;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Objednávka {data.orderNumber}</h1>
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
                  <td className="text-center tabular-nums">{it.quantity}×</td>
                  <td className="text-right tabular-nums">{formatMoney(it.unitPrice, ccy)}</td>
                  <td className="text-right tabular-nums">{formatMoney(it.totalPrice, ccy)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/*
            Rozpad peněz. Dřív tu bylo jen „Celkem" a případná sleva, takže
            nebylo poznat, kolik z částky je servisní poplatek platformy
            a co reálně zůstane pořadateli.

            Pozn.: DPH se tu neukazuje záměrně — sazba ani základ nejsou
            v databázi na objednávce ani na položkách uložené, takže by šlo
            o dopočet, ne o fakt.
          */}
          <div className="mt-5 border-t pt-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rozpad
            </h3>
            <dl className="space-y-1.5 text-sm">
              <MoneyRow label="Vstupenky" value={formatMoney(itemsSum, ccy)} />
              {data.discountAmount > 0 ? (
                <MoneyRow label="Sleva" value={`− ${formatMoney(data.discountAmount, ccy)}`} />
              ) : null}
              {data.serviceFeeMinor > 0 ? (
                <MoneyRow
                  label="Servisní poplatek"
                  hint="platí kupující navíc, náleží platformě"
                  value={formatMoney(data.serviceFeeMinor, ccy)}
                />
              ) : null}
              <MoneyRow label="Zaplaceno celkem" value={formatMoney(data.totalAmount, ccy)} strong />
              {data.affiliateCommissionMinor > 0 ? (
                <MoneyRow
                  label="Provize partnera"
                  hint="objednávka přišla přes partnerský odkaz"
                  value={`− ${formatMoney(data.affiliateCommissionMinor, ccy)}`}
                />
              ) : null}
              <MoneyRow
                label="Hrubý výnos pořadatele"
                hint="před provizí platformy, která se odečítá až při výplatě"
                value={formatMoney(promoterGross, ccy)}
                strong
              />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Kolik z toho skutečně přijde na účet a kdy, ukazují{' '}
              <Link href="/admin/payouts" className="text-primary underline">
                Výplaty
              </Link>
              .
            </p>
          </div>
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
                      <TicketStatusBadge status={t.status} />
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
          <CardTitle>Historie objednávky</CardTitle>
        </CardHeader>
        <CardContent>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              S objednávkou se od vytvoření nic nedělo.
            </p>
          ) : (
            <ol className="space-y-3">
              {data.history.map((entry) => (
                <li key={entry.id} className="flex gap-3 text-sm">
                  <div
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {describeHistory(entry.kind, entry.amountHalire, ccy)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString('cs-CZ')}
                      {entry.actorEmail ? ` · ${entry.actorEmail}` : ''}
                      {entry.reason ? ` · ${translateReason(entry.reason)}` : ''}
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Technický detail
                      </summary>
                      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                        {JSON.stringify(entry.raw, null, 2)}
                      </pre>
                    </details>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Jeden řádek rozpadu peněz. */
function MoneyRow({
  label,
  value,
  hint,
  strong = false,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? 'border-t pt-1.5' : ''}`}>
      <dt className={strong ? 'font-medium' : 'text-muted-foreground'}>
        {label}
        {hint ? <span className="ml-1 text-xs text-muted-foreground">({hint})</span> : null}
      </dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}

/**
 * Věta místo syrového JSONu.
 *
 * Refundace se do audit.audit_log zapisují jako action='UPDATE' (constraint
 * povoluje jen INSERT/UPDATE/DELETE) a skutečný význam je až v new_values.kind.
 * Support akce mají vlastní tabulku audit.support_actions s čitelnou hodnotou
 * ve sloupci action.
 */
function describeHistory(kind: string, amountHalire: number | null, currency: Currency): string {
  const amount = amountHalire ? ` ${formatMoney(amountHalire, currency)}` : '';
  switch (kind) {
    case 'refund':
      return `Vráceny peníze${amount}`;
    case 'bulk_refund':
      return `Vráceny peníze${amount} v rámci hromadné refundace`;
    case 'resend_email':
      return 'Znovu odesláno potvrzení objednávky';
    case 'send_message':
      return 'Odeslána individuální zpráva kupujícímu';
    case 'transfer':
      return 'Vstupenka převedena na jiný e-mail';
    case 'name_change':
      return 'Změněno jméno držitele vstupenky';
    case 'cancel_ticket':
      return 'Zneplatněna vstupenka bez vrácení peněz';
    case 'insert':
      return 'Objednávka vytvořena';
    case 'update':
      return 'Objednávka upravena';
    case 'delete':
      return 'Objednávka smazána';
    default:
      return kind;
  }
}

/** Důvody refundace přicházejí z API jako klíče. */
function translateReason(reason: string): string {
  const map: Record<string, string> = {
    event_cancelled: 'akce byla zrušena',
    customer_request: 'žádost zákazníka',
    duplicate_order: 'duplicitní objednávka',
    fraud: 'podezření z podvodu',
    chargeback: 'chargeback',
  };
  return map[reason] ?? reason;
}

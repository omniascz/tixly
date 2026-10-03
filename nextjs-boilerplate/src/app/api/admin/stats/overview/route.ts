/**
 * GET /api/admin/stats/overview
 *
 * Agregáty pro domovskou obrazovku promotéra.
 *
 * Vzniklo proto, že přehled si dosud tahal 100 posledních objednávek a
 * v prohlížeči z nich počítal dnešní tržbu, týdenní trend, čtrnáctidenní graf,
 * průměrnou objednávku, počet zákazníků i refund rate. Při vyšším objemu
 * objednávek byla všechna tahle čísla nepravdivá — vzorek nikdy nepokryl
 * celé období.
 *
 * Peněžní model odpovídá modulu Výplaty (app/api/admin/payouts/route.ts):
 *   promotérův gross = o.total_amount − o.service_fee_minor
 *   provize          = gross × fee_bps / 10000  (fee_schedules, fallback 5 %)
 *   čistá tržba      = gross − refundace − provize
 * Holdback se tu záměrně neodečítá — je to dočasné zadržení kvůli
 * chargebackům, ne snížení tržby. Přesnou výplatu ukazuje modul Výplaty.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsPromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

/** Fallback provize, když promotér nemá vlastní fee_schedule. Shodné s payouts. */
const PLATFORM_FEE_BPS = 500; // 5,00 %

const DAILY_DAYS = 14;

interface TotalsRow {
  orders_count: string;
  gross: string;
  refunds: string;
  customers: string;
}

interface TodayRow {
  gross: string;
  orders_count: string;
  tickets: string;
}

interface WeekRow {
  current_gross: string;
  previous_gross: string;
}

interface DailyRow {
  day: string;
  gross: string;
  orders_count: string;
}

interface RefundRateRow {
  paid_count: string;
  refunded_count: string;
}

interface NextEventRow {
  id: string;
  title: string;
  date_start: string;
  total_qty: string | null;
  remaining_qty: string | null;
}

interface AttentionRow {
  refund_requests: string;
  chargebacks: string;
}

interface CurrencyRow {
  currency: string;
  orders_count: string;
}

const num = (value: string | null | undefined): number => Number(value ?? 0);

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    const promoterId = promoter.promoterId;

    // Měna: dashboard nesmí sčítat CZK a EUR do jednoho čísla. Bereme tu,
    // ve které má promotér nejvíc objednávek, a hlásíme, jestli jsou i další.
    const currencies = await db().query<CurrencyRow>(
      `SELECT COALESCE(o.currency, 'CZK') AS currency, COUNT(*)::text AS orders_count
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
        WHERE e.promoter_id = $1
        GROUP BY 1
        ORDER BY COUNT(*) DESC`,
      [promoterId],
    );
    const currency = currencies.rows[0]?.currency ?? 'CZK';
    const hasOtherCurrencies = currencies.rows.length > 1;

    // Provize podle aktivního fee_schedule pro tuhle měnu.
    const feeRow = await db().query<{ percentage_fee: number }>(
      `SELECT percentage_fee
         FROM platform.fee_schedules
        WHERE promoter_id = $1 AND currency = $2 AND is_active = true
          AND (valid_until IS NULL OR valid_until > NOW())
          AND (valid_from IS NULL OR valid_from <= NOW())
        ORDER BY created_at DESC
        LIMIT 1`,
      [promoterId, currency],
    );
    const feeBps = feeRow.rows[0]?.percentage_fee ?? PLATFORM_FEE_BPS;

    const scope = `e.promoter_id = $1 AND COALESCE(o.currency, 'CZK') = $2`;
    const args = [promoterId, currency];

    const [totals, today, week, daily, refundRate, nextEvent, attention] = await Promise.all([
      db().query<TotalsRow>(
        `SELECT
           COUNT(*)::text AS orders_count,
           COALESCE(SUM(o.total_amount - COALESCE(o.service_fee_minor, 0))
             FILTER (WHERE o.status = 'paid'), 0)::text AS gross,
           COALESCE(SUM(o.total_amount - COALESCE(o.service_fee_minor, 0))
             FILTER (WHERE o.status = 'refunded'), 0)::text AS refunds,
           COUNT(DISTINCT o.user_id) FILTER (WHERE o.status = 'paid')::text AS customers
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
        WHERE ${scope}`,
        args,
      ),

      db().query<TodayRow>(
        `SELECT
           COALESCE(SUM(o.total_amount - COALESCE(o.service_fee_minor, 0)), 0)::text AS gross,
           COUNT(*)::text AS orders_count,
           COALESCE(SUM((SELECT SUM(oi.quantity) FROM orders.order_items oi
                          WHERE oi.order_id = o.id)), 0)::text AS tickets
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
        WHERE ${scope}
          AND o.status = 'paid'
          AND o.created_at >= DATE_TRUNC('day', NOW())`,
        args,
      ),

      db().query<WeekRow>(
        `SELECT
           COALESCE(SUM(o.total_amount - COALESCE(o.service_fee_minor, 0))
             FILTER (WHERE o.created_at >= NOW() - INTERVAL '7 days'), 0)::text AS current_gross,
           COALESCE(SUM(o.total_amount - COALESCE(o.service_fee_minor, 0))
             FILTER (WHERE o.created_at >= NOW() - INTERVAL '14 days'
                       AND o.created_at <  NOW() - INTERVAL '7 days'), 0)::text AS previous_gross
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
        WHERE ${scope} AND o.status = 'paid'`,
        args,
      ),

      // Celá řada dnů i tam, kde se nic neprodalo — jinak by graf lhal tvarem.
      db().query<DailyRow>(
        `WITH days AS (
           SELECT generate_series(
             DATE_TRUNC('day', NOW()) - INTERVAL '${DAILY_DAYS - 1} days',
             DATE_TRUNC('day', NOW()),
             '1 day'
           ) AS day
         )
         SELECT
           TO_CHAR(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(SUM(o.total_amount - COALESCE(o.service_fee_minor, 0)), 0)::text AS gross,
           COUNT(o.id)::text AS orders_count
         FROM days d
         LEFT JOIN orders.orders o
           ON o.created_at >= d.day
          AND o.created_at <  d.day + INTERVAL '1 day'
          AND o.status = 'paid'
          AND COALESCE(o.currency, 'CZK') = $2
          AND o.event_id IN (SELECT id FROM catalog.events WHERE promoter_id = $1)
         GROUP BY d.day
         ORDER BY d.day`,
        args,
      ),

      db().query<RefundRateRow>(
        `SELECT
           COUNT(*) FILTER (WHERE o.status = 'paid')::text AS paid_count,
           COUNT(*) FILTER (WHERE o.status = 'refunded')::text AS refunded_count
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
        WHERE ${scope} AND o.created_at >= NOW() - INTERVAL '30 days'`,
        args,
      ),

      db().query<NextEventRow>(
        `SELECT e.id, e.title, e.date_start,
                (SELECT SUM(tt.total_qty)::text FROM catalog.ticket_types tt
                  WHERE tt.event_id = e.id) AS total_qty,
                (SELECT SUM(tt.remaining_qty)::text FROM catalog.ticket_types tt
                  WHERE tt.event_id = e.id) AS remaining_qty
           FROM catalog.events e
          WHERE e.promoter_id = $1 AND e.date_start >= NOW()
          ORDER BY e.date_start ASC
          LIMIT 1`,
        [promoterId],
      ),

      db().query<AttentionRow>(
        `SELECT
           (SELECT COUNT(*) FROM orders.refund_requests rr
             JOIN orders.orders ro ON ro.id = rr.order_id
             JOIN catalog.events re ON re.id = ro.event_id
            WHERE re.promoter_id = $1 AND rr.status = 'pending')::text AS refund_requests,
           (SELECT COUNT(*) FROM orders.chargebacks cb
            WHERE cb.promoter_id = $1
              AND cb.status IN ('needs_response', 'under_review'))::text AS chargebacks`,
        [promoterId],
      ),
    ]);

    // Role 'staff' (produkce, pokladna, dveře) nemá vidět tržby ani provize —
    // levé menu jí finanční sekce skrývá, přehled by je jinak vyzradil.
    const showsMoney = promoter.role !== 'staff';

    const grossHalire = num(totals.rows[0]?.gross);
    const refundsHalire = num(totals.rows[0]?.refunds);
    const ordersCount = num(totals.rows[0]?.orders_count);
    const feeHalire = Math.floor((grossHalire * feeBps) / 10000);
    const netHalire = Math.max(0, grossHalire - refundsHalire - feeHalire);

    const currentWeek = num(week.rows[0]?.current_gross);
    const previousWeek = num(week.rows[0]?.previous_gross);
    const weekChangePercent =
      previousWeek > 0 ? Math.round(((currentWeek - previousWeek) / previousWeek) * 100) : null;

    const paid30 = num(refundRate.rows[0]?.paid_count);
    const refunded30 = num(refundRate.rows[0]?.refunded_count);
    const refundRate30d =
      paid30 + refunded30 > 0 ? Math.round((refunded30 * 100) / (paid30 + refunded30)) : 0;

    const ev = nextEvent.rows[0];
    const evTotal = ev?.total_qty !== null && ev?.total_qty !== undefined ? num(ev.total_qty) : null;
    const evRemaining =
      ev?.remaining_qty !== null && ev?.remaining_qty !== undefined ? num(ev.remaining_qty) : null;
    const evSold = evTotal !== null && evRemaining !== null ? evTotal - evRemaining : null;

    return NextResponse.json({
      currency,
      hasOtherCurrencies,
      feePercent: feeBps / 100,
      showsMoney,

      today: {
        grossHalire: showsMoney ? num(today.rows[0]?.gross) : null,
        ordersCount: num(today.rows[0]?.orders_count),
        tickets: num(today.rows[0]?.tickets),
      },

      week: showsMoney
        ? {
            currentGrossHalire: currentWeek,
            previousGrossHalire: previousWeek,
            changePercent: weekChangePercent,
          }
        : null,

      totals: {
        ordersCount,
        customersCount: showsMoney ? num(totals.rows[0]?.customers) : null,
        grossHalire: showsMoney ? grossHalire : null,
        refundsHalire: showsMoney ? refundsHalire : null,
        feeHalire: showsMoney ? feeHalire : null,
        netHalire: showsMoney ? netHalire : null,
        avgOrderHalire: showsMoney && ordersCount > 0 ? Math.round(grossHalire / ordersCount) : null,
      },

      daily: showsMoney
        ? daily.rows.map((r) => ({
            date: r.day,
            grossHalire: num(r.gross),
            ordersCount: num(r.orders_count),
          }))
        : [],

      refundRate30d,

      nextEvent: ev
        ? {
            id: ev.id,
            title: ev.title,
            dateStart: ev.date_start,
            capacity: evTotal,
            sold: evSold,
            sellThroughPercent:
              evTotal && evTotal > 0 && evSold !== null
                ? Math.round((evSold / evTotal) * 100)
                : null,
          }
        : null,

      attention: {
        refundRequests: num(attention.rows[0]?.refund_requests),
        chargebacks: num(attention.rows[0]?.chargebacks),
      },
    });
  });
}

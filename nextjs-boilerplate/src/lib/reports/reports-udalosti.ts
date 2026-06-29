import type { ReportDef } from './types';
import { DATE_PARAMS, from, to } from './helpers';

export const REPORTS_UDALOSTI: ReportDef[] = [
  {
    id: 'akce_prehled', title: 'Přehled akcí s KPI', category: 'udalosti',
    description: 'Všechny akce s tržbami, fill rate a počtem zákazníků.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'datum', label: 'Datum', type: 'date' },
      { key: 'status', label: 'Stav', type: 'badge' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'prodano', label: 'Prodáno', type: 'number' },
      { key: 'kapacita', label: 'Kapacita', type: 'number' },
      { key: 'fill_rate', label: 'Fill %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, e.date_start::date::text AS datum,
                   e.status,
                   ROUND(COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='paid'),0)/100.0,2)::numeric AS trzby_czk,
                   COALESCE(SUM(tt.total_qty - tt.remaining_qty),0)::int AS prodano,
                   COALESCE(SUM(tt.total_qty),0)::int AS kapacita,
                   ROUND(100.0*COALESCE(SUM(tt.total_qty-tt.remaining_qty),0)
                     /NULLIF(COALESCE(SUM(tt.total_qty),0),0),1)::numeric AS fill_rate
            FROM catalog.events e
            LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
            LEFT JOIN orders.orders o ON o.event_id = e.id
            WHERE e.promoter_id = $1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title, e.date_start, e.status
            ORDER BY e.date_start DESC LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_dle_statusu', title: 'Akce dle stavu', category: 'udalosti',
    description: 'Počet akcí v každém stavu (draft, published, cancelled, archived).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'status', label: 'Stav', type: 'badge' },
      { key: 'pocet', label: 'Počet akcí', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.status,
                   COUNT(DISTINCT e.id)::int AS pocet,
                   ROUND(COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='paid'),0)/100.0,2)::numeric AS trzby_czk
            FROM catalog.events e
            LEFT JOIN orders.orders o ON o.event_id = e.id
            WHERE e.promoter_id = $1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.status ORDER BY pocet DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_fill_rate', title: 'Fill rate dle akce (detail)', category: 'udalosti',
    description: 'Obsazenost po typech vstupenek pro každou akci.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'typ_vstupenky', label: 'Typ vstupenky', type: 'text' },
      { key: 'celkem', label: 'Celkem', type: 'number' },
      { key: 'prodano', label: 'Prodáno', type: 'number' },
      { key: 'zbyvaji', label: 'Zbývají', type: 'number' },
      { key: 'fill_rate', label: 'Fill %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, tt.name AS typ_vstupenky,
                   tt.total_qty::int AS celkem,
                   (tt.total_qty - tt.remaining_qty)::int AS prodano,
                   tt.remaining_qty::int AS zbyvaji,
                   ROUND(100.0*(tt.total_qty-tt.remaining_qty)/NULLIF(tt.total_qty,0),1)::numeric AS fill_rate
            FROM catalog.ticket_types tt
            JOIN catalog.events e ON e.id = tt.event_id
            WHERE e.promoter_id = $1
              AND e.date_start::date BETWEEN $2 AND $3
            ORDER BY fill_rate DESC, e.title LIMIT 500`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_top_revenue', title: 'Top 20 akcí dle tržeb', category: 'udalosti',
    description: 'Nejvýdělečnější akce za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'datum', label: 'Datum', type: 'date' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'fill_rate', label: 'Fill %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, e.date_start::date::text AS datum,
                   ROUND(COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='paid'),0)/100.0,2)::numeric AS trzby_czk,
                   COUNT(DISTINCT o.id) FILTER (WHERE o.status='paid')::int AS objednavky,
                   ROUND(100.0*COALESCE(SUM(tt.total_qty-tt.remaining_qty),0)
                     /NULLIF(COALESCE(SUM(tt.total_qty),0),0),1)::numeric AS fill_rate
            FROM catalog.events e
            LEFT JOIN orders.orders o ON o.event_id = e.id
            LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
            WHERE e.promoter_id = $1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title, e.date_start ORDER BY trzby_czk DESC LIMIT 20`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_dle_kategorie', title: 'Akce dle kategorie', category: 'udalosti',
    description: 'Tržby a počty akcí dle kategorie (hudba, divadlo, sport…).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kategorie', label: 'Kategorie', type: 'badge' },
      { key: 'akci', label: 'Akcí', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(e.category,'other') AS kategorie,
                   COUNT(DISTINCT e.id)::int AS akci,
                   ROUND(COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='paid'),0)/100.0,2)::numeric AS trzby_czk,
                   COUNT(DISTINCT o.id) FILTER (WHERE o.status='paid')::int AS objednavky
            FROM catalog.events e
            LEFT JOIN orders.orders o ON o.event_id = e.id
            WHERE e.promoter_id = $1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY trzby_czk DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_bez_prodeje', title: 'Akce bez prodeje', category: 'udalosti',
    description: 'Publikované akce, na které nebyla prodána žádná vstupenka.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'datum', label: 'Datum', type: 'date' },
      { key: 'kapacita', label: 'Kapacita', type: 'number' },
      { key: 'status', label: 'Stav', type: 'badge' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, e.date_start::date::text AS datum,
                   COALESCE(SUM(tt.total_qty),0)::int AS kapacita, e.status
            FROM catalog.events e
            LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
            WHERE e.promoter_id = $1
              AND e.status = 'published'
              AND e.date_start::date BETWEEN $2 AND $3
              AND NOT EXISTS (
                SELECT 1 FROM orders.orders o
                WHERE o.event_id = e.id AND o.status = 'paid'
              )
            GROUP BY e.id, e.title, e.date_start, e.status
            ORDER BY e.date_start LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_refund_rate', title: 'Refund rate dle akce', category: 'udalosti',
    description: 'Akce s nejvyšším podílem refundovaných objednávek.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'zaplacene', label: 'Zaplacené', type: 'number' },
      { key: 'refundovane', label: 'Refundované', type: 'number' },
      { key: 'refund_rate', label: 'Refund %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(*) FILTER (WHERE o.status='paid')::int AS zaplacene,
                   COUNT(*) FILTER (WHERE o.status='refunded')::int AS refundovane,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.status='refunded')
                     /NULLIF(COUNT(*) FILTER (WHERE o.status IN ('paid','refunded')),0),1)::numeric AS refund_rate
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id = $1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title
            HAVING COUNT(*) FILTER (WHERE o.status IN ('paid','refunded')) > 0
            ORDER BY refund_rate DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_prodejni_krivka', title: 'Prodejní křivka akce', category: 'udalosti',
    description: 'Denní prodeje pro konkrétní akci — jak rychle se prodávala.',
    scope: 'promoter',
    params: [
      ...DATE_PARAMS,
      { key: 'event_id', label: 'ID akce (UUID)', type: 'uuid', required: true },
    ],
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'kumulativ_czk', label: 'Kumulativ (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH daily AS (
              SELECT o.paid_at::date AS den,
                COUNT(*)::int AS objednavky,
                ROUND(SUM(o.total_amount)/100.0,2) AS trzby
              FROM orders.orders o
              JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.event_id=$4 AND o.status='paid'
                AND o.paid_at::date BETWEEN $2 AND $3
              GROUP BY 1
            )
            SELECT den::text AS den, objednavky,
                   trzby AS trzby_czk,
                   ROUND(SUM(trzby) OVER (ORDER BY den),2)::numeric AS kumulativ_czk
            FROM daily ORDER BY den`,
      values: [pid, from(p), to(p), p.event_id ?? ''],
    }),
  },
  {
    id: 'akce_rsvp_konverze', title: 'RSVP → nákup konverze', category: 'udalosti',
    description: 'Kolik zákazníků z RSVP listiny nakonec koupilo vstupenku.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'rsvp', label: 'RSVP', type: 'number' },
      { key: 'nakoupili', label: 'Nakoupili', type: 'number' },
      { key: 'konverze', label: 'Konverze %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT r.user_id)::int AS rsvp,
                   COUNT(DISTINCT o.user_id) FILTER (WHERE o.status='paid')::int AS nakoupili,
                   ROUND(100.0*COUNT(DISTINCT o.user_id) FILTER (WHERE o.status='paid')
                     /NULLIF(COUNT(DISTINCT r.user_id),0),1)::numeric AS konverze
            FROM catalog.events e
            LEFT JOIN marketing.event_rsvps r ON r.event_id = e.id
            LEFT JOIN orders.orders o ON o.event_id = e.id AND o.user_id = r.user_id
            WHERE e.promoter_id = $1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title
            HAVING COUNT(DISTINCT r.user_id) > 0
            ORDER BY rsvp DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_timed_entry', title: 'Akce s timed entry', category: 'udalosti',
    description: 'Přehled akcí s časovými sloty (muzea, výstavy).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'datum', label: 'Datum', type: 'date' },
      { key: 'slotu', label: 'Slotů', type: 'number' },
      { key: 'prodano', label: 'Prodáno', type: 'number' },
      { key: 'kapacita', label: 'Kapacita', type: 'number' },
      { key: 'fill_rate', label: 'Fill %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, e.date_start::date::text AS datum,
                   COUNT(DISTINCT es.id)::int AS slotu,
                   COALESCE(SUM(es.capacity - es.remaining),0)::int AS prodano,
                   COALESCE(SUM(es.capacity),0)::int AS kapacita,
                   ROUND(100.0*COALESCE(SUM(es.capacity-es.remaining),0)
                     /NULLIF(COALESCE(SUM(es.capacity),0),0),1)::numeric AS fill_rate
            FROM catalog.events e
            LEFT JOIN catalog.entry_slots es ON es.event_id = e.id
            WHERE e.promoter_id = $1
              AND e.timed_entry_enabled = true
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title, e.date_start ORDER BY e.date_start DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_addony_attach', title: 'Add-on attach rate dle akce', category: 'udalosti',
    description: 'Jak dobře se k akci prodávají add-ony.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'objednavky_celkem', label: 'Obj. celkem', type: 'number' },
      { key: 's_addonem', label: 'S add-onem', type: 'number' },
      { key: 'attach_pct', label: 'Attach %', type: 'pct' },
      { key: 'addony_czk', label: 'Add-on tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT o.id)::int AS objednavky_celkem,
                   COUNT(DISTINCT oa.order_id)::int AS s_addonem,
                   ROUND(100.0*COUNT(DISTINCT oa.order_id)/NULLIF(COUNT(DISTINCT o.id),0),1)::numeric AS attach_pct,
                   ROUND(COALESCE(SUM(oa.subtotal_halire),0)/100.0,2)::numeric AS addony_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id = o.event_id
            LEFT JOIN public.order_addons oa ON oa.order_id = o.id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY attach_pct DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_promo_pouziti', title: 'Promo kódy dle akce', category: 'udalosti',
    description: 'Kolik promo kódů bylo použito na každou akci.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'pouziti', label: 'Použití promo', type: 'number' },
      { key: 'slevy_czk', label: 'Slevy (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT o.id) FILTER (WHERE o.promo_code_id IS NOT NULL)::int AS pouziti,
                   ROUND(SUM(o.discount_halire) FILTER (WHERE o.promo_code_id IS NOT NULL)/100.0,2)::numeric AS slevy_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY pouziti DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'akce_kapacita_vs_prodano', title: 'Kapacita vs. prodáno (timeline)', category: 'udalosti',
    description: 'Stav prodeje kapacity pro nadcházející akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'datum', label: 'Datum', type: 'date' },
      { key: 'kapacita', label: 'Kapacita', type: 'number' },
      { key: 'prodano', label: 'Prodáno', type: 'number' },
      { key: 'volno', label: 'Volno', type: 'number' },
      { key: 'fill_rate', label: 'Fill %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, e.date_start::date::text AS datum,
                   COALESCE(SUM(tt.total_qty),0)::int AS kapacita,
                   COALESCE(SUM(tt.total_qty - tt.remaining_qty),0)::int AS prodano,
                   COALESCE(SUM(tt.remaining_qty),0)::int AS volno,
                   ROUND(100.0*COALESCE(SUM(tt.total_qty-tt.remaining_qty),0)
                     /NULLIF(COALESCE(SUM(tt.total_qty),0),0),1)::numeric AS fill_rate
            FROM catalog.events e
            LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
            WHERE e.promoter_id = $1 AND e.status = 'published'
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title, e.date_start ORDER BY e.date_start LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
];

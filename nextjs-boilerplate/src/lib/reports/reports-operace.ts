import type { ReportDef } from './types';
import { DATE_PARAMS, from, to } from './helpers';

export const REPORTS_OPERACE: ReportDef[] = [
  {
    id: 'ops_scan_prehled', title: 'Skeny vstupenek — přehled', category: 'operace',
    description: 'Celkový počet skenů na akcích za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'datum', label: 'Datum akce', type: 'date' },
      { key: 'vstupenky', label: 'Vstupenek', type: 'number' },
      { key: 'skenovano', label: 'Skenováno', type: 'number' },
      { key: 'vstup_pct', label: 'Vstup %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, e.date_start::date::text AS datum,
                   COUNT(t.id)::int AS vstupenky,
                   COUNT(t.id) FILTER (WHERE t.used_at IS NOT NULL)::int AS skenovano,
                   ROUND(100.0*COUNT(t.id) FILTER (WHERE t.used_at IS NOT NULL)
                     /NULLIF(COUNT(t.id),0),1)::numeric AS vstup_pct
            FROM catalog.events e
            JOIN orders.orders o ON o.event_id = e.id AND o.status = 'paid'
            JOIN tickets.tickets t ON t.order_id = o.id
            WHERE e.promoter_id=$1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title, e.date_start ORDER BY e.date_start DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_scan_dle_hodiny', title: 'Vstup dle hodiny', category: 'operace',
    description: 'V kolik hodin přicházeli návštěvníci na akci.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'hodina', label: 'Hodina', type: 'text' },
      { key: 'vstupy', label: 'Vstupy', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT EXTRACT(HOUR FROM t.used_at AT TIME ZONE 'Europe/Prague')::int::text AS hodina,
                   COUNT(*)::int AS vstupy
            FROM tickets.tickets t
            JOIN orders.orders o ON o.id = t.order_id
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id=$1 AND t.used_at IS NOT NULL
              AND t.used_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1`,
      values: [pid, from(p), to(p)],
    }),
  },
  // VYRAZENO (R-35): chybi tabulka tickets.ticket_scans. Definice zustava — SQL bude platit,
  // az tabulka vznikne. Viz DISABLED_REPORTS v registry.ts.
  {
    id: 'ops_scan_duplicit', title: 'Duplicitní skenování', category: 'operace',
    description: 'Vstupenky skenované vícekrát — možný podvod.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'ticket_id', label: 'Vstupenka', type: 'text' },
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'email', label: 'Zákazník', type: 'text' },
      { key: 'pocet_skenu', label: 'Počet skenů', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT t.id::text AS ticket_id, e.title AS akce, u.email,
                   COUNT(ts.id)::int AS pocet_skenu
            FROM tickets.ticket_scans ts
            JOIN tickets.tickets t ON t.id = ts.ticket_id
            JOIN orders.orders o ON o.id = t.order_id
            JOIN catalog.events e ON e.id = o.event_id
            JOIN identity.users u ON u.id = o.user_id
            WHERE e.promoter_id=$1
              AND ts.scanned_at::date BETWEEN $2 AND $3
            GROUP BY t.id, e.title, u.email HAVING COUNT(ts.id) > 1
            ORDER BY pocet_skenu DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_timed_entry_sloty', title: 'Timed Entry — sloty dle dne', category: 'operace',
    description: 'Obsazenost časových slotů per den pro akce s timed entry.',
    scope: 'promoter', params: [
      ...DATE_PARAMS,
      { key: 'event_id', label: 'ID akce (UUID)', type: 'uuid', required: true },
    ],
    columns: [
      { key: 'datum', label: 'Datum', type: 'date' },
      { key: 'slotu', label: 'Slotů', type: 'number' },
      { key: 'kapacita', label: 'Kapacita', type: 'number' },
      { key: 'prodano', label: 'Prodáno', type: 'number' },
      { key: 'fill_rate', label: 'Fill %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT es.slot_start::date::text AS datum,
                   COUNT(es.id)::int AS slotu,
                   SUM(es.capacity)::int AS kapacita,
                   SUM(es.capacity - es.remaining)::int AS prodano,
                   ROUND(100.0*SUM(es.capacity-es.remaining)/NULLIF(SUM(es.capacity),0),1)::numeric AS fill_rate
            FROM catalog.entry_slots es
            JOIN catalog.events e ON e.id = es.event_id
            WHERE e.promoter_id=$1 AND es.event_id=$4
              AND es.slot_start::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 365`,
      values: [pid, from(p), to(p), p.event_id ?? ''],
    }),
  },
  {
    id: 'ops_guestlist_prehled', title: 'Guestlist přehled', category: 'operace',
    description: 'Hostující hosté (guestlist) na akcích.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'jmeno', label: 'Jméno', type: 'text' },
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'vstupenky', label: 'Vstupenek', type: 'number' },
      { key: 'stav', label: 'Stav', type: 'badge' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, gl.name AS jmeno, gl.email,
                   gl.ticket_count::int AS vstupenky, gl.status AS stav
            FROM operations.guestlists gl
            JOIN catalog.events e ON e.id = gl.event_id
            WHERE e.promoter_id=$1
              AND e.date_start::date BETWEEN $2 AND $3
            ORDER BY e.date_start, gl.name LIMIT 500`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_order_status_prehled', title: 'Objednávky dle stavu (operativní)', category: 'operace',
    description: 'Přehled objednávek ve všech stavech za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'stav', label: 'Stav', type: 'badge' },
      { key: 'pocet', label: 'Počet', type: 'number' },
      { key: 'castka_czk', label: 'Částka (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.status AS stav,
                   COUNT(*)::int AS pocet,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS castka_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1
              AND o.created_at::date BETWEEN $2 AND $3
            GROUP BY o.status ORDER BY pocet DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_velke_objednavky', title: 'Velké objednávky (skupiny)', category: 'operace',
    description: 'Objednávky s více než 4 vstupenkami — skupinové nákupy.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'order_id', label: 'Objednávka', type: 'text' },
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'email', label: 'Zákazník', type: 'text' },
      { key: 'vstupenky', label: 'Vstupenek', type: 'number' },
      { key: 'castka_czk', label: 'Částka (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.variable_symbol AS order_id, e.title AS akce, u.email,
                   SUM(oi.quantity)::int AS vstupenky,
                   ROUND(o.total_amount/100.0,2)::numeric AS castka_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN identity.users u ON u.id=o.user_id
            JOIN orders.order_items oi ON oi.order_id=o.id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY o.id, o.variable_symbol, e.title, u.email, o.total_amount
            HAVING SUM(oi.quantity) > 4
            ORDER BY vstupenky DESC LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_expiry_dle_dne', title: 'Expirované objednávky dle dne', category: 'operace',
    description: 'Objednávky, které zákazníci nedokončili a expiroval jim čas na platbu.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'expirovano', label: 'Expirováno', type: 'number' },
      { key: 'ztraceno_czk', label: 'Ztraceno (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.created_at::date::text AS den,
                   COUNT(*)::int AS expirovano,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS ztraceno_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='cancelled'
              AND o.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_pojistka_claims', title: 'Uplatněné pojistky', category: 'operace',
    description: 'Zákazníci, kteří uplatnili pojistku (claim).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'email', label: 'Zákazník', type: 'text' },
      { key: 'premie_czk', label: 'Prémie (Kč)', type: 'currency_czk' },
      { key: 'stav', label: 'Stav', type: 'badge' },
      { key: 'datum', label: 'Datum', type: 'date' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, u.email,
                   ROUND(ins.premium_amount/100.0,2)::numeric AS premie_czk,
                   ins.status AS stav,
                   ins.created_at::date::text AS datum
            FROM orders.order_insurance ins
            JOIN orders.orders o ON o.id = ins.order_id
            JOIN catalog.events e ON e.id = o.event_id
            JOIN identity.users u ON u.id = o.user_id
            WHERE e.promoter_id=$1 AND ins.status='claimed'
              AND ins.created_at::date BETWEEN $2 AND $3
            ORDER BY ins.created_at DESC LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_entry_slots_obsazenost', title: 'Entry slots — celková obsazenost', category: 'operace',
    description: 'Souhrn obsazenosti časových slotů přes všechny akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'slotu', label: 'Slotů', type: 'number' },
      { key: 'kapacita', label: 'Kapacita', type: 'number' },
      { key: 'prodano', label: 'Prodáno', type: 'number' },
      { key: 'fill_rate', label: 'Fill %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(es.id)::int AS slotu,
                   SUM(es.capacity)::int AS kapacita,
                   SUM(es.capacity - es.remaining)::int AS prodano,
                   ROUND(100.0*SUM(es.capacity-es.remaining)/NULLIF(SUM(es.capacity),0),1)::numeric AS fill_rate
            FROM catalog.entry_slots es
            JOIN catalog.events e ON e.id = es.event_id
            WHERE e.promoter_id=$1
              AND es.slot_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY fill_rate DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
];

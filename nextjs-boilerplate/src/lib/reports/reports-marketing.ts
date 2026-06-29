import type { ReportDef } from './types';
import { DATE_PARAMS, from, to } from './helpers';

export const REPORTS_MARKETING: ReportDef[] = [
  {
    id: 'marketing_promo_prehled', title: 'Promo kódy — přehled', category: 'marketing',
    description: 'Všechny promo kódy s počtem použití, slevou a revenue impactem.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kod', label: 'Kód', type: 'text' },
      { key: 'typ', label: 'Typ', type: 'badge' },
      { key: 'pouziti', label: 'Použití', type: 'number' },
      { key: 'sleva_czk', label: 'Sleva (Kč)', type: 'currency_czk' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT pc.code AS kod, pc.type AS typ,
                   COUNT(DISTINCT o.id)::int AS pouziti,
                   ROUND(SUM(o.discount_halire)/100.0,2)::numeric AS sleva_czk,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM marketing.promo_codes pc
            JOIN orders.orders o ON o.promo_code_id = pc.id
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY pc.id, pc.code, pc.type ORDER BY pouziti DESC LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_promo_top', title: 'Top 20 promo kódů', category: 'marketing',
    description: 'Promo kódy s nejvyšší konverzí za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kod', label: 'Kód', type: 'text' },
      { key: 'pouziti', label: 'Použití', type: 'number' },
      { key: 'sleva_czk', label: 'Celková sleva (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT pc.code AS kod,
                   COUNT(DISTINCT o.id)::int AS pouziti,
                   ROUND(SUM(o.discount_halire)/100.0,2)::numeric AS sleva_czk
            FROM marketing.promo_codes pc
            JOIN orders.orders o ON o.promo_code_id = pc.id
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY pc.id, pc.code ORDER BY pouziti DESC LIMIT 20`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_promo_dle_dne', title: 'Denní využití promo kódů', category: 'marketing',
    description: 'Kolik promo kódů bylo použito každý den.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'pouziti', label: 'Použití', type: 'number' },
      { key: 'sleva_czk', label: 'Sleva (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(DISTINCT o.id)::int AS pouziti,
                   ROUND(SUM(o.discount_halire)/100.0,2)::numeric AS sleva_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.promo_code_id IS NOT NULL
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_promo_dle_typu', title: 'Promo kódy dle typu', category: 'marketing',
    description: 'Rozdělení promo kódů dle typu (percent, fixed, free).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'typ', label: 'Typ', type: 'badge' },
      { key: 'kodu', label: 'Kódů', type: 'number' },
      { key: 'pouziti', label: 'Použití', type: 'number' },
      { key: 'sleva_czk', label: 'Sleva (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT pc.type AS typ,
                   COUNT(DISTINCT pc.id)::int AS kodu,
                   COUNT(DISTINCT o.id)::int AS pouziti,
                   ROUND(SUM(o.discount_halire)/100.0,2)::numeric AS sleva_czk
            FROM marketing.promo_codes pc
            JOIN orders.orders o ON o.promo_code_id = pc.id
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY pc.type ORDER BY pouziti DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_affiliate_prehled', title: 'Affiliate — přehled', category: 'marketing',
    description: 'Výkonnost affiliate partnerů za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kod', label: 'Kód', type: 'text' },
      { key: 'konverze', label: 'Konverze', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'provize_czk', label: 'Provize (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT af.code AS kod,
                   COUNT(DISTINCT o.id)::int AS konverze,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   ROUND(SUM(o.total_amount)*af.commission_pct/100.0/100.0,2)::numeric AS provize_czk
            FROM marketing.affiliates af
            JOIN orders.orders o ON o.affiliate_id = af.id
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY af.id, af.code ORDER BY konverze DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_affiliate_dle_dne', title: 'Affiliate konverze dle dne', category: 'marketing',
    description: 'Denní affiliate konverze a tržby.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'konverze', label: 'Konverze', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(DISTINCT o.id)::int AS konverze,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.affiliate_id IS NOT NULL
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_rsvp_prehled', title: 'RSVP přehled', category: 'marketing',
    description: 'Celkový počet RSVP per akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'rsvp', label: 'RSVP', type: 'number' },
      { key: 'nakoupili', label: 'Nakoupili', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT r.user_id)::int AS rsvp,
                   COUNT(DISTINCT o.user_id) FILTER (WHERE o.status='paid')::int AS nakoupili
            FROM marketing.event_rsvps r
            JOIN catalog.events e ON e.id = r.event_id
            LEFT JOIN orders.orders o ON o.event_id = e.id AND o.user_id = r.user_id
            WHERE e.promoter_id=$1
              AND r.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY rsvp DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_waitlist_prehled', title: 'Čekací listina — přehled', category: 'marketing',
    description: 'Zákazníci zapsaní na čekacích listinách akcí.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'cekajicich', label: 'Čekajících', type: 'number' },
      { key: 'notifikovano', label: 'Notifikováno', type: 'number' },
      { key: 'nakoupilo', label: 'Nakoupilo', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT wl.user_id)::int AS cekajicich,
                   COUNT(DISTINCT wl.user_id) FILTER (WHERE wl.status='notified')::int AS notifikovano,
                   COUNT(DISTINCT o.user_id)::int AS nakoupilo
            FROM marketing.waiting_list wl
            JOIN catalog.events e ON e.id = wl.event_id
            LEFT JOIN orders.orders o ON o.event_id=e.id AND o.user_id=wl.user_id AND o.status='paid'
            WHERE e.promoter_id=$1
              AND wl.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY cekajicich DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_loyalty_vydano', title: 'Loyalty body — vydané', category: 'marketing',
    description: 'Kolik loyalty bodů bylo vydáno zákazníkům za nákupy.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'body', label: 'Body vydané', type: 'number' },
      { key: 'zakaznici', label: 'Zákazníků', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT lt.created_at::date::text AS den,
                   SUM(lt.points)::int AS body,
                   COUNT(DISTINCT lt.user_id)::int AS zakaznici
            FROM marketing.loyalty_transactions lt
            JOIN orders.orders o ON o.id = lt.order_id
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id=$1 AND lt.type='earn'
              AND lt.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_voucher_prodeje', title: 'Gift vouchery — prodeje', category: 'marketing',
    description: 'Prodeje dárkových poukazů za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'prodano', label: 'Prodáno', type: 'number' },
      { key: 'hodnota_czk', label: 'Hodnota (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(DISTINCT o.id)::int AS prodano,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS hodnota_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.is_gift=true
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_bundle_prodeje', title: 'Bundle prodeje', category: 'marketing',
    description: 'Objednávky zakoupené jako bundle (více vstupenek najednou).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'bundles', label: 'Bundly', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(DISTINCT o.id)::int AS bundles,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN orders.order_items oi ON oi.order_id=o.id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1
            HAVING SUM(oi.quantity) > 2
            ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_access_codes', title: 'Přístupové kódy — využití', category: 'marketing',
    description: 'Jak zákazníci využívají přístupové kódy.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kod', label: 'Kód', type: 'text' },
      { key: 'pouzito', label: 'Použito', type: 'number' },
      { key: 'nakoupeno', label: 'Nakoupeno', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT ac.code AS kod,
                   COUNT(DISTINCT acu.id)::int AS pouzito,
                   COUNT(DISTINCT o.id) FILTER (WHERE o.status='paid')::int AS nakoupeno
            FROM marketing.access_codes ac
            LEFT JOIN marketing.access_code_usages acu ON acu.code_id = ac.id
            LEFT JOIN orders.orders o ON o.id = acu.order_id
            JOIN catalog.events e ON e.id = ac.event_id
            WHERE e.promoter_id=$1
              AND (acu.created_at::date BETWEEN $2 AND $3 OR acu.id IS NULL)
            GROUP BY ac.id, ac.code ORDER BY pouzito DESC LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_party_splits', title: 'Party Pay — přehled', category: 'marketing',
    description: 'Skupinové platby (Party Pay sessions) a jejich stav.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'sessions', label: 'Sessions', type: 'number' },
      { key: 'dokoncene', label: 'Dokončené', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT pss.id)::int AS sessions,
                   COUNT(DISTINCT pss.id) FILTER (WHERE pss.status='complete')::int AS dokoncene,
                   ROUND(SUM(pss.per_slot_amount*pss.total_slots) FILTER (WHERE pss.status='complete')/100.0,2)::numeric AS trzby_czk
            FROM orders.party_split_sessions pss
            JOIN catalog.events e ON e.id = pss.event_id
            WHERE e.promoter_id=$1
              AND pss.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY sessions DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_broadcast_prehled', title: 'Broadcasty', category: 'marketing',
    description: 'E-mail/SMS broadcasty poslané zákazníkům.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'nazev', label: 'Název', type: 'text' },
      { key: 'kanal', label: 'Kanál', type: 'badge' },
      { key: 'adresatu', label: 'Adresátů', type: 'number' },
      { key: 'odeslano', label: 'Odesláno', type: 'date' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT b.name AS nazev, b.channel AS kanal,
                   b.recipient_count AS adresatu,
                   b.sent_at::date::text AS odeslano
            FROM marketing.broadcasts b
            WHERE b.promoter_id=$1
              AND b.sent_at::date BETWEEN $2 AND $3
            ORDER BY b.sent_at DESC LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_promo_expiry', title: 'Expirující promo kódy', category: 'marketing',
    description: 'Promo kódy s blížícím se datem platnosti.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kod', label: 'Kód', type: 'text' },
      { key: 'typ', label: 'Typ', type: 'badge' },
      { key: 'platnost_do', label: 'Platný do', type: 'date' },
      { key: 'pouziti', label: 'Použito', type: 'number' },
      { key: 'max_pouziti', label: 'Max použití', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT pc.code AS kod, pc.type AS typ,
                   pc.valid_until::date::text AS platnost_do,
                   pc.uses_count::int AS pouziti,
                   pc.max_uses::int AS max_pouziti
            FROM marketing.promo_codes pc
            JOIN catalog.events e ON e.id = pc.event_id
            WHERE e.promoter_id=$1
              AND pc.valid_until::date BETWEEN $2 AND $3
            ORDER BY pc.valid_until LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
];

import type { ReportDef } from './types';
import { DATE_PARAMS, from, to } from './helpers';

const BUYER_JOIN = `FROM orders.orders o
  JOIN catalog.events e ON e.id = o.event_id
  JOIN identity.users u ON u.id = o.user_id`;

export const REPORTS_ZAKAZNICI: ReportDef[] = [
  {
    id: 'zakaznici_prehled', title: 'Přehled zákazníků', category: 'zakaznici',
    description: 'Zákazníci seřazení dle celkové útrat — lifetime value.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'jmeno', label: 'Jméno', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'utrata_czk', label: 'Útrata (Kč)', type: 'currency_czk' },
      { key: 'prvni_nakup', label: 'První nákup', type: 'date' },
      { key: 'posledni_nakup', label: 'Poslední nákup', type: 'date' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT u.email, u.name AS jmeno,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS utrata_czk,
                   MIN(o.paid_at)::date::text AS prvni_nakup,
                   MAX(o.paid_at)::date::text AS posledni_nakup
            ${BUYER_JOIN}
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY u.id, u.email, u.name ORDER BY utrata_czk DESC LIMIT 500`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_novi_dle_dne', title: 'Noví zákazníci dle dne', category: 'zakaznici',
    description: 'Kolik nových (dosud nenakupujících) zákazníků přišlo každý den.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'novi', label: 'Noví zákazníci', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH first_buy AS (
              SELECT o.user_id, MIN(o.paid_at)::date AS prvni_den
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid'
              GROUP BY o.user_id
            )
            SELECT prvni_den::text AS den, COUNT(*)::int AS novi
            FROM first_buy
            WHERE prvni_den BETWEEN $2 AND $3
            GROUP BY prvni_den ORDER BY prvni_den LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_opakujici', title: 'Vracející se zákazníci', category: 'zakaznici',
    description: 'Zákazníci s více než jednou objednávkou.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'utrata_czk', label: 'Útrata (Kč)', type: 'currency_czk' },
      { key: 'posledni_nakup', label: 'Poslední nákup', type: 'date' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT u.email,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS utrata_czk,
                   MAX(o.paid_at)::date::text AS posledni_nakup
            ${BUYER_JOIN}
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY u.id, u.email HAVING COUNT(DISTINCT o.id) > 1
            ORDER BY objednavky DESC LIMIT 300`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_top_utrata', title: 'Top zákazníci dle útrat', category: 'zakaznici',
    description: 'Top 100 zákazníků seřazených dle celkové útrat za dané období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'utrata_czk', label: 'Útrata (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT u.email,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS utrata_czk
            ${BUYER_JOIN}
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY u.id, u.email ORDER BY utrata_czk DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_dle_zeme', title: 'Zákazníci dle země', category: 'zakaznici',
    description: 'Distribuce zákazníků a tržeb dle fakturační země.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'zeme', label: 'Země (ISO)', type: 'badge' },
      { key: 'zakaznici', label: 'Zákazníci', type: 'number' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(o.billing_country_code, u.country_code, 'neznámo') AS zeme,
                   COUNT(DISTINCT u.id)::int AS zakaznici,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            ${BUYER_JOIN}
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY trzby_czk DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_dle_domeny', title: 'Zákazníci dle emailové domény', category: 'zakaznici',
    description: 'Top emailové domény zákazníků.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'domena', label: 'Doména', type: 'text' },
      { key: 'zakaznici', label: 'Zákazníci', type: 'number' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT SPLIT_PART(u.email,'@',2) AS domena,
                   COUNT(DISTINCT u.id)::int AS zakaznici,
                   COUNT(DISTINCT o.id)::int AS objednavky
            ${BUYER_JOIN}
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY zakaznici DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_ltv', title: 'Customer Lifetime Value', category: 'zakaznici',
    description: 'LTV zákazníků — celková útrata za celou historii (bez datového omezení).',
    scope: 'promoter', params: [],
    columns: [
      { key: 'segment', label: 'LTV segment', type: 'badge' },
      { key: 'zakaznici', label: 'Zákazníci', type: 'number' },
      { key: 'avg_ltv_czk', label: 'Průměrný LTV (Kč)', type: 'currency_czk' },
      { key: 'celkem_czk', label: 'Celkem (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid) => ({
      sql: `WITH ltv AS (
              SELECT u.id, ROUND(SUM(o.total_amount)/100.0,2) AS ltv_czk
              FROM orders.orders o
              JOIN catalog.events e ON e.id=o.event_id
              JOIN identity.users u ON u.id=o.user_id
              WHERE e.promoter_id=$1 AND o.status='paid'
              GROUP BY u.id
            )
            SELECT CASE
              WHEN ltv_czk >= 10000 THEN 'VIP (10k+)'
              WHEN ltv_czk >= 3000 THEN 'Vysoká (3k–10k)'
              WHEN ltv_czk >= 500 THEN 'Střední (500–3k)'
              ELSE 'Nízká (<500)'
            END AS segment,
            COUNT(*)::int AS zakaznici,
            ROUND(AVG(ltv_czk),2)::numeric AS avg_ltv_czk,
            ROUND(SUM(ltv_czk),2)::numeric AS celkem_czk
            FROM ltv
            GROUP BY 1 ORDER BY avg_ltv_czk DESC`,
      values: [pid],
    }),
  },
  {
    id: 'zakaznici_churn_risk', title: 'Churn risk (bez nákupu 90+ dní)', category: 'zakaznici',
    description: 'Loajální zákazníci, kteří nekoupili vstupenku déle než 90 dní.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'posledni_nakup', label: 'Poslední nákup', type: 'date' },
      { key: 'dni_bez_nakupu', label: 'Dní bez nákupu', type: 'number' },
      { key: 'celkem_utrata_czk', label: 'Celková útrata (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid) => ({
      sql: `SELECT u.email,
                   MAX(o.paid_at)::date::text AS posledni_nakup,
                   (CURRENT_DATE - MAX(o.paid_at)::date)::int AS dni_bez_nakupu,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS celkem_utrata_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN identity.users u ON u.id=o.user_id
            WHERE e.promoter_id=$1 AND o.status='paid'
            GROUP BY u.id, u.email
            HAVING COUNT(DISTINCT o.id) >= 2
              AND MAX(o.paid_at) < CURRENT_DATE - INTERVAL '90 days'
            ORDER BY dni_bez_nakupu DESC LIMIT 300`,
      values: [pid],
    }),
  },
  {
    id: 'zakaznici_promo', title: 'Zákazníci s promo kódem', category: 'zakaznici',
    description: 'Zákazníci, kteří nakoupili s promo kódem.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'kod', label: 'Promo kód', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'utrata_czk', label: 'Útrata (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT u.email, pc.code AS kod,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS utrata_czk
            ${BUYER_JOIN}
            JOIN marketing.promo_codes pc ON pc.id = o.promo_code_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY u.id, u.email, pc.code ORDER BY utrata_czk DESC LIMIT 300`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_dle_pohlavi', title: 'Zákazníci dle pohlaví', category: 'zakaznici',
    description: 'Demografická distribuce zákazníků dle pohlaví.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'pohlavi', label: 'Pohlaví', type: 'badge' },
      { key: 'zakaznici', label: 'Zákazníci', type: 'number' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'utrata_czk', label: 'Útrata (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(u.gender,'neznámo') AS pohlavi,
                   COUNT(DISTINCT u.id)::int AS zakaznici,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS utrata_czk
            ${BUYER_JOIN}
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY utrata_czk DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_dle_veku', title: 'Zákazníci dle věku', category: 'zakaznici',
    description: 'Věkové skupiny zákazníků (z roku narození v profilu).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'vek_skupina', label: 'Věková skupina', type: 'badge' },
      { key: 'zakaznici', label: 'Zákazníci', type: 'number' },
      { key: 'utrata_czk', label: 'Útrata (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT CASE
                WHEN u.birth_year IS NULL THEN 'Neznámo'
                WHEN EXTRACT(YEAR FROM NOW()) - u.birth_year < 18 THEN '<18'
                WHEN EXTRACT(YEAR FROM NOW()) - u.birth_year < 25 THEN '18–24'
                WHEN EXTRACT(YEAR FROM NOW()) - u.birth_year < 35 THEN '25–34'
                WHEN EXTRACT(YEAR FROM NOW()) - u.birth_year < 45 THEN '35–44'
                WHEN EXTRACT(YEAR FROM NOW()) - u.birth_year < 55 THEN '45–54'
                ELSE '55+' END AS vek_skupina,
              COUNT(DISTINCT u.id)::int AS zakaznici,
              ROUND(SUM(o.total_amount)/100.0,2)::numeric AS utrata_czk
            ${BUYER_JOIN}
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_multi_akce', title: 'Zákazníci na více akcích', category: 'zakaznici',
    description: 'Zákazníci, kteří nakoupili vstupenky na 2+ různé akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'akci', label: 'Počet akcí', type: 'number' },
      { key: 'utrata_czk', label: 'Útrata (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT u.email,
                   COUNT(DISTINCT o.event_id)::int AS akci,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS utrata_czk
            ${BUYER_JOIN}
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY u.id, u.email HAVING COUNT(DISTINCT o.event_id) >= 2
            ORDER BY akci DESC LIMIT 300`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_retence_30d', title: 'Retence 30-denní', category: 'zakaznici',
    description: 'Kolik % zákazníků nakoupilo znovu do 30 dní od první koupě.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Kohorta (měsíc 1. nákupu)', type: 'date' },
      { key: 'novi', label: 'Noví zákazníci', type: 'number' },
      { key: 'retence', label: 'Vrátili se do 30d', type: 'number' },
      { key: 'retence_pct', label: 'Retence %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH cohort AS (
              SELECT u.id, DATE_TRUNC('month', MIN(o.paid_at))::date AS mesic_prvni
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              JOIN identity.users u ON u.id=o.user_id
              WHERE e.promoter_id=$1 AND o.status='paid'
              GROUP BY u.id
            ),
            returns AS (
              SELECT c.mesic_prvni, o.user_id
              FROM orders.orders o
              JOIN catalog.events e ON e.id=o.event_id
              JOIN cohort c ON c.id=o.user_id
              WHERE e.promoter_id=$1 AND o.status='paid'
                AND o.paid_at > (SELECT MIN(o2.paid_at) FROM orders.orders o2 WHERE o2.user_id=c.id AND o2.status='paid')
                AND o.paid_at <= (SELECT MIN(o2.paid_at) FROM orders.orders o2 WHERE o2.user_id=c.id AND o2.status='paid') + INTERVAL '30 days'
              GROUP BY c.mesic_prvni, o.user_id
            )
            SELECT c.mesic_prvni::text AS mesic,
                   COUNT(DISTINCT c.id)::int AS novi,
                   COUNT(DISTINCT r.user_id)::int AS retence,
                   ROUND(100.0*COUNT(DISTINCT r.user_id)/NULLIF(COUNT(DISTINCT c.id),0),1)::numeric AS retence_pct
            FROM cohort c
            LEFT JOIN returns r ON r.mesic_prvni = c.mesic_prvni
            WHERE c.mesic_prvni BETWEEN $2::date AND $3::date
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_prumerna_utrata', title: 'Průměrná útrata na zákazníka', category: 'zakaznici',
    description: 'Průměrná útrata (AOV × počet nákupů) za zákazníka dle měsíce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'zakaznici', label: 'Unikátních zákazníků', type: 'number' },
      { key: 'avg_utrata_czk', label: 'Průměr/zákazník (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   COUNT(DISTINCT o.user_id)::int AS zakaznici,
                   ROUND(SUM(o.total_amount)/100.0/NULLIF(COUNT(DISTINCT o.user_id),0),2)::numeric AS avg_utrata_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_waitlist', title: 'Zákazníci na čekací listině', category: 'zakaznici',
    description: 'Zákazníci zapsaní na waitlistu akcí.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'stav', label: 'Stav', type: 'badge' },
      { key: 'prihlaseni', label: 'Přihlášen', type: 'date' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, u.email,
                   wl.status AS stav, wl.created_at::date::text AS prihlaseni
            FROM marketing.waiting_list wl
            JOIN catalog.events e ON e.id = wl.event_id
            JOIN identity.users u ON u.id = wl.user_id
            WHERE e.promoter_id = $1
              AND wl.created_at::date BETWEEN $2 AND $3
            ORDER BY wl.created_at DESC LIMIT 500`,
      values: [pid, from(p), to(p)],
    }),
  },
];

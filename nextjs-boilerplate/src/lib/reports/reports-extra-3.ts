/**
 * Třetí sada reportů — různé kategorie, celkem 201+
 */
import type { ReportDef } from './types';
import { DATE_PARAMS, from, to, BASE_SALES_SQL } from './helpers';

export const REPORTS_EXTRA_3: ReportDef[] = [
  // ── PRODEJE ─────────────────────────────────────────────────────────────────
  {
    id: 'prodeje_dle_jazyka', title: 'Prodeje dle jazyka UI', category: 'prodeje',
    description: 'Tržby dle jazykové verze pokladny (CS/SK/EN).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'jazyk', label: 'Jazyk', type: 'badge' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(o.locale,'cs') AS jazyk,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY trzby_czk DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_mobile_vs_desktop', title: 'Mobile vs. Desktop prodeje', category: 'prodeje',
    description: 'Podíl objednávek z mobilních a desktopových zařízení.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'zarizeni', label: 'Zařízení', type: 'badge' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'pct', label: 'Podíl %', type: 'pct' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(o.device_type,'unknown') AS zarizeni,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(100.0*COUNT(DISTINCT o.id)/NULLIF(SUM(COUNT(DISTINCT o.id)) OVER(),0),1)::numeric AS pct,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY trzby_czk DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_abandoned_checkout', title: 'Opuštěné nákupní košíky', category: 'prodeje',
    description: 'Zahájené pokladny, které nebyly dokončeny (cancelled + expired).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'zacate', label: 'Zahájených', type: 'number' },
      { key: 'opustene', label: 'Opuštěných', type: 'number' },
      { key: 'cart_abandon_rate', label: 'Abandon rate %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.created_at::date::text AS den,
                   COUNT(DISTINCT o.id)::int AS zacate,
                   COUNT(DISTINCT o.id) FILTER (WHERE o.status IN ('cancelled','expired'))::int AS opustene,
                   ROUND(100.0*COUNT(DISTINCT o.id) FILTER (WHERE o.status IN ('cancelled','expired'))
                     /NULLIF(COUNT(DISTINCT o.id),0),1)::numeric AS cart_abandon_rate
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1
              AND o.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── FINANCE ─────────────────────────────────────────────────────────────────
  {
    id: 'finance_settlement_gap', title: 'Settlement gap (výplata vs. realizace)', category: 'finance',
    description: 'Průměrný počet dní mezi zaplacením objednávky a výplatou promotérovi.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'vyplat', label: 'Výplat', type: 'number' },
      { key: 'avg_gap_dni', label: 'Průměr. prodleva (dní)', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', py.created_at)::date::text AS mesic,
                   COUNT(py.id)::int AS vyplat,
                   ROUND(AVG(py.created_at::date - MIN(o.paid_at::date)))::int AS avg_gap_dni
            FROM finance.payouts py
            JOIN finance.payout_orders po ON po.payout_id=py.id
            JOIN orders.orders o ON o.id=po.order_id
            WHERE py.promoter_id=$1 AND py.status='paid'
              AND py.created_at::date BETWEEN $2 AND $3
            GROUP BY py.id, 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_fee_breakdown', title: 'Rozpad poplatků', category: 'finance',
    description: 'Přehled zaplatěných poplatků (servisní, platební, pojistka).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'servisni_czk', label: 'Servisní (Kč)', type: 'currency_czk' },
      { key: 'platebni_czk', label: 'Platební (Kč)', type: 'currency_czk' },
      { key: 'celkem_czk', label: 'Celkem (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   ROUND(SUM(o.platform_fee_halire)/100.0,2)::numeric AS servisni_czk,
                   ROUND(SUM(o.payment_fee_halire)/100.0,2)::numeric AS platebni_czk,
                   ROUND(SUM(o.platform_fee_halire+o.payment_fee_halire)/100.0,2)::numeric AS celkem_czk
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_revenue_per_event_type', title: 'Výnosy dle typu akce', category: 'finance',
    description: 'Tržby rozdělené dle kategorie akce (Hudba, Divadlo, Sport…).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kategorie', label: 'Kategorie', type: 'badge' },
      { key: 'akci', label: 'Akcí', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'pct', label: 'Podíl %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(e.category,'Jiné') AS kategorie,
                   COUNT(DISTINCT e.id)::int AS akci,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   ROUND(100.0*SUM(o.total_amount)/NULLIF(SUM(SUM(o.total_amount)) OVER(),0),1)::numeric AS pct
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY trzby_czk DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── ZÁKAZNÍCI ────────────────────────────────────────────────────────────────
  {
    id: 'zakaznici_avg_tickets_per_order', title: 'Průměrný počet vstupenek / objednávka', category: 'zakaznici',
    description: 'Trend průměrného počtu vstupenek v objednávce (skupinový nákup).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'avg_vstupenek', label: 'Průměr vstupenek', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   ROUND(AVG(oi_cnt.qty),1)::numeric AS avg_vstupenek
            FROM orders.orders o
            JOIN (SELECT order_id, SUM(quantity) AS qty FROM orders.order_items GROUP BY order_id) oi_cnt
              ON oi_cnt.order_id=o.id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_foreign', title: 'Zákazníci ze zahraničí', category: 'zakaznici',
    description: 'Zákazníci s billing adresou mimo ČR.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'zeme', label: 'Země', type: 'badge' },
      { key: 'zakaznici', label: 'Zákazníků', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(o.billing_country,'CZ') AS zeme,
                   COUNT(DISTINCT o.user_id)::int AS zakaznici,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            ${BASE_SALES_SQL}
              AND o.billing_country IS DISTINCT FROM 'CZ'
            GROUP BY 1 ORDER BY trzby_czk DESC LIMIT 50`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_churn_candidates', title: 'Zákazníci bez nákupu 6+ měsíců', category: 'zakaznici',
    description: 'Aktivní zákazníci, kteří nekupovali 6 a více měsíců.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'posledni_nakup', label: 'Posl. nákup', type: 'date' },
      { key: 'celkem_czk', label: 'Lifetime (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid) => ({
      sql: `SELECT u.email,
                   MAX(o.paid_at)::date::text AS posledni_nakup,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS celkem_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            JOIN identity.users u ON u.id=o.user_id
            WHERE e.promoter_id=$1 AND o.status='paid'
            GROUP BY u.id, u.email
            HAVING MAX(o.paid_at) < NOW() - INTERVAL '180 days'
            ORDER BY celkem_czk DESC LIMIT 200`,
      values: [pid],
    }),
  },
  // ── UDÁLOSTI ─────────────────────────────────────────────────────────────────
  {
    id: 'udalosti_press_accred', title: 'Tiskové akreditace', category: 'udalosti',
    description: 'Vydané tiskové akreditace per akce a jejich stav.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'zadosti', label: 'Žádostí', type: 'number' },
      { key: 'schvaleno', label: 'Schváleno', type: 'number' },
      { key: 'zamítnuto', label: 'Zamítnuto', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(pa.id)::int AS zadosti,
                   COUNT(pa.id) FILTER (WHERE pa.status='approved')::int AS schvaleno,
                   COUNT(pa.id) FILTER (WHERE pa.status='rejected')::int AS zamítnuto
            FROM orders.press_accreditations pa
            JOIN catalog.events e ON e.id=pa.event_id
            WHERE e.promoter_id=$1
              AND pa.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY zadosti DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'udalosti_lottery', title: 'Losování kampaně', category: 'udalosti',
    description: 'Přehled losovacích kampaní — přihlášení, výherci, konverze.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kampan', label: 'Kampaň', type: 'text' },
      { key: 'prihlaseni', label: 'Přihlášení', type: 'number' },
      { key: 'vyherce', label: 'Výherců', type: 'number' },
      { key: 'nakoupilo', label: 'Nakoupilo', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT lc.name AS kampan,
                   COUNT(DISTINCT le.user_id)::int AS prihlaseni,
                   COUNT(DISTINCT lw.user_id)::int AS vyherce,
                   COUNT(DISTINCT o.user_id) FILTER (WHERE o.status='paid')::int AS nakoupilo
            FROM orders.lottery_campaigns lc
            LEFT JOIN orders.lottery_entries le ON le.campaign_id=lc.id
            LEFT JOIN marketing.lottery_winners lw ON lw.campaign_id=lc.id
            LEFT JOIN catalog.events e ON e.id=lc.event_id
            LEFT JOIN orders.orders o ON o.event_id=e.id AND o.user_id=lw.user_id
            WHERE lc.promoter_id=$1
              AND lc.created_at::date BETWEEN $2 AND $3
            GROUP BY lc.id, lc.name ORDER BY prihlaseni DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'udalosti_backstage', title: 'Backstage moments', category: 'udalosti',
    description: 'Zákazníci s backstage přístupem — přehled per akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'passu', label: 'Backstage passů', type: 'number' },
      { key: 'vyuzito', label: 'Využito', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(bm.id)::int AS passu,
                   COUNT(bm.id) FILTER (WHERE bm.scanned_at IS NOT NULL)::int AS vyuzito
            FROM catalog.backstage_moments bm
            JOIN catalog.events e ON e.id=bm.event_id
            WHERE e.promoter_id=$1
              AND bm.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY passu DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── MARKETING ────────────────────────────────────────────────────────────────
  {
    id: 'marketing_forgemsg_delivery', title: 'ForgeMsg — doručenost zpráv', category: 'marketing',
    description: 'Doručenost day-of a yield zpráv přes ForgeMsg.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'odeslano', label: 'Odesláno', type: 'number' },
      { key: 'doruceno', label: 'Doručeno', type: 'number' },
      { key: 'pct', label: 'Doručenost %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT fm.sent_at::date::text AS den,
                   COUNT(fm.id)::int AS odeslano,
                   COUNT(fm.id) FILTER (WHERE fm.status='delivered')::int AS doruceno,
                   ROUND(100.0*COUNT(fm.id) FILTER (WHERE fm.status='delivered')
                     /NULLIF(COUNT(fm.id),0),1)::numeric AS pct
            FROM public.forgemsg_outbox fm
            WHERE fm.promoter_id=$1
              AND fm.sent_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_sms_campaigns', title: 'SMS kampaně výsledky', category: 'marketing',
    description: 'Přehled SMS marketingových kampaní — dosah a CTR.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kampan', label: 'Kampaň', type: 'text' },
      { key: 'odeslano', label: 'Odesláno', type: 'number' },
      { key: 'doruceno', label: 'Doručeno', type: 'number' },
      { key: 'prokliknuto', label: 'Prokliknuto', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT sc.name AS kampan,
                   sc.sent_count::int AS odeslano,
                   sc.delivered_count::int AS doruceno,
                   sc.click_count::int AS prokliknuto
            FROM marketing.sms_campaigns sc
            WHERE sc.promoter_id=$1 AND sc.status='sent'
              AND sc.sent_at::date BETWEEN $2 AND $3
            ORDER BY sc.sent_at DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_coupon_pouziti', title: 'Kupóny — využití', category: 'marketing',
    description: 'Hromadné sledování jednorázových kupónů.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kod', label: 'Kód', type: 'text' },
      { key: 'sleva_pct', label: 'Sleva %', type: 'pct' },
      { key: 'pouzito', label: 'Použito', type: 'number' },
      { key: 'uskorneno_czk', label: 'Ušetřeno (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.promo_code AS kod,
                   pc.discount_pct::numeric AS sleva_pct,
                   COUNT(DISTINCT o.id)::int AS pouzito,
                   ROUND(SUM(o.discount_halire)/100.0,2)::numeric AS uskorneno_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            LEFT JOIN marketing.promo_codes pc ON pc.code=o.promo_code AND pc.promoter_id=$1
            WHERE e.promoter_id=$1 AND o.status='paid' AND o.promo_code IS NOT NULL
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY o.promo_code, pc.discount_pct ORDER BY pouzito DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── OPERACE ─────────────────────────────────────────────────────────────────
  {
    id: 'ops_refund_time', title: 'Doba zpracování refundů', category: 'operace',
    description: 'Průměrný čas od požadavku na refund do jeho vyřízení.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'refundu', label: 'Refundů', type: 'number' },
      { key: 'avg_hodiny', label: 'Průměr. doba (h)', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', r.created_at)::date::text AS mesic,
                   COUNT(r.id)::int AS refundu,
                   ROUND(AVG(EXTRACT(EPOCH FROM (r.processed_at - r.created_at))/3600))::int AS avg_hodiny
            FROM public.refunds r
            JOIN orders.orders o ON o.id=r.order_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND r.status='processed'
              AND r.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_reprint_requests', title: 'Požadavky na přetisk vstupenky', category: 'operace',
    description: 'Zákazníci, kteří požádali o nový tisk vstupenky.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'pozadavku', label: 'Požadavků', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT al.created_at::date::text AS den, COUNT(al.id)::int AS pozadavku
            FROM audit.audit_log al
            JOIN orders.orders o ON o.id=al.resource_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND al.action='ticket.reprint'
              AND al.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_staff_activity', title: 'Aktivita personálu', category: 'operace',
    description: 'Přehled akcí provedených staff rolemi (scanner, POS).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'staff_email', label: 'Staff', type: 'text' },
      { key: 'scanu', label: 'Scanů', type: 'number' },
      { key: 'pos_transakci', label: 'POS transakcí', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT u.email AS staff_email,
                   COUNT(DISTINCT sc.id)::int AS scanu,
                   COUNT(DISTINCT pos.id)::int AS pos_transakci
            FROM platform.promoter_members pm
            JOIN identity.users u ON u.id=pm.user_id
            LEFT JOIN tickets.scan_logs sc ON sc.scanned_by=u.id
              AND sc.scanned_at::date BETWEEN $2 AND $3
            LEFT JOIN orders.orders pos ON pos.cashier_id=u.id
              AND pos.status='paid' AND pos.paid_at::date BETWEEN $2 AND $3
            WHERE pm.promoter_id=$1 AND pm.role='staff'
            GROUP BY u.id, u.email ORDER BY scanu DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── SROVNÁNÍ ─────────────────────────────────────────────────────────────────
  {
    id: 'srov_revenue_per_city', title: 'Tržby dle města venue', category: 'srovnani',
    description: 'Sumarizace tržeb dle města, kde se akce konala.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesto', label: 'Město', type: 'text' },
      { key: 'akci', label: 'Akcí', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(v.city,'Online') AS mesto,
                   COUNT(DISTINCT e.id)::int AS akci,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            LEFT JOIN catalog.venues v ON v.id=e.venue_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY trzby_czk DESC LIMIT 50`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_ticket_type_mix', title: 'Ticket type mix (kvartálně)', category: 'srovnani',
    description: 'Jak se mění podíl typů vstupenek (VIP, Standard, Early Bird) kvartálně.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kvartal', label: 'Kvartál', type: 'text' },
      { key: 'typ', label: 'Typ vstupenky', type: 'text' },
      { key: 'pct', label: 'Podíl %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT CONCAT(DATE_PART('year', o.paid_at)::int,'Q',DATE_PART('quarter', o.paid_at)::int) AS kvartal,
                   tt.name AS typ,
                   ROUND(100.0*SUM(oi.quantity)/NULLIF(SUM(SUM(oi.quantity)) OVER (PARTITION BY DATE_TRUNC('quarter', o.paid_at)),0),1)::numeric AS pct
            FROM orders.order_items oi
            JOIN catalog.ticket_types tt ON tt.id=oi.ticket_type_id
            JOIN orders.orders o ON o.id=oi.order_id AND o.status='paid'
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY kvartal, tt.id, tt.name ORDER BY kvartal, pct DESC LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_promo_efficacy', title: 'Efektivita promo kódů (YoY)', category: 'srovnani',
    description: 'Mezirocní srovnání počtu a hodnoty využitých promo kódů.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'rok', label: 'Rok', type: 'text' },
      { key: 'promo_objednavky', label: 'Promo objednávky', type: 'number' },
      { key: 'uskorneno_czk', label: 'Ušetřeno (Kč)', type: 'currency_czk' },
      { key: 'promo_pct', label: 'Podíl promo %', type: 'pct' },
    ],
    buildQuery: (pid) => ({
      sql: `SELECT DATE_PART('year', o.paid_at)::text AS rok,
                   COUNT(DISTINCT o.id) FILTER (WHERE o.promo_code IS NOT NULL)::int AS promo_objednavky,
                   ROUND(SUM(o.discount_halire)/100.0,2)::numeric AS uskorneno_czk,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.promo_code IS NOT NULL)/COUNT(*),1)::numeric AS promo_pct
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
            GROUP BY 1 ORDER BY 1 LIMIT 10`,
      values: [pid],
    }),
  },
  // ── PLATFORMA ────────────────────────────────────────────────────────────────
  {
    id: 'platform_error_rate', title: 'Chybovost plateb (platform)', category: 'platform',
    description: 'Podíl neúspěšných platebních pokusů na celkové platformě.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'pokusy', label: 'Pokusy', type: 'number' },
      { key: 'uspechy', label: 'Úspěchy', type: 'number' },
      { key: 'error_rate', label: 'Error rate %', type: 'pct' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT pa.created_at::date::text AS den,
                   COUNT(pa.id)::int AS pokusy,
                   COUNT(pa.id) FILTER (WHERE pa.status='success')::int AS uspechy,
                   ROUND(100.0*COUNT(pa.id) FILTER (WHERE pa.status='failed')
                     /NULLIF(COUNT(pa.id),0),1)::numeric AS error_rate
            FROM orders.payment_attempts pa
            WHERE pa.created_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1 LIMIT 200`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_growth_rate', title: 'Růst platformy (GMV)', category: 'platform',
    description: 'Měsíční growth rate celkového GMV platformy.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'gmv_czk', label: 'GMV (Kč)', type: 'currency_czk' },
      { key: 'growth_pct', label: 'MoM Growth %', type: 'pct' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `WITH m AS (
              SELECT DATE_TRUNC('month', o.paid_at)::date AS mes,
                     ROUND(SUM(o.total_amount)/100.0,2) AS gmv
              FROM orders.orders o WHERE o.status='paid'
                AND o.paid_at::date BETWEEN $1 AND $2
              GROUP BY 1
            )
            SELECT mes::text AS mesic, gmv AS gmv_czk,
                   ROUND(100.0*(gmv-LAG(gmv) OVER (ORDER BY mes))
                     /NULLIF(LAG(gmv) OVER (ORDER BY mes),0),1)::numeric AS growth_pct
            FROM m ORDER BY mes`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_event_categories_dist', title: 'Distribuce kategorií akcí (platform)', category: 'platform',
    description: 'Jak jsou akce na platformě rozděleny dle kategorií.',
    scope: 'platform', params: [],
    columns: [
      { key: 'kategorie', label: 'Kategorie', type: 'badge' },
      { key: 'akci', label: 'Akcí', type: 'number' },
      { key: 'pct', label: 'Podíl %', type: 'pct' },
    ],
    buildQuery: () => ({
      sql: `SELECT COALESCE(category,'Jiné') AS kategorie,
                   COUNT(id)::int AS akci,
                   ROUND(100.0*COUNT(id)/SUM(COUNT(id)) OVER(),1)::numeric AS pct
            FROM catalog.events
            WHERE status != 'deleted'
            GROUP BY 1 ORDER BY akci DESC`,
      values: [],
    }),
  },
];

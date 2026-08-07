/**
 * Doplňkové reporty — události, marketing, operace, srovnání, platforma (2. sada)
 */
import type { ReportDef } from './types';
import { DATE_PARAMS, from, to, BASE_SALES_SQL, SALES_COLS } from './helpers';

export const REPORTS_EXTRA_2: ReportDef[] = [
  // ── UDÁLOSTI extra ──────────────────────────────────────────────────────────
  {
    id: 'udalosti_multi_date', title: 'Multi-date akce (série)', category: 'udalosti',
    description: 'Akce s více daty (turné, sériová představení) — přehled prodeje per datum.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'datum', label: 'Datum', type: 'date' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, e.date_start::date::text AS datum,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND e.parent_event_id IS NOT NULL
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title, e.date_start ORDER BY e.date_start LIMIT 500`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'udalosti_lead_time', title: 'Lead time nákupu', category: 'udalosti',
    description: 'Kolik dní předem si zákazníci kupují vstupenky.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'pasmo', label: 'Předstih', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'pct', label: 'Podíl %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH ld AS (
              SELECT (e.date_start::date - o.paid_at::date)::int AS days_before
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid'
                AND o.paid_at::date BETWEEN $2 AND $3
            )
            SELECT CASE
                WHEN days_before < 0 THEN 'Po akci'
                WHEN days_before = 0 THEN 'V den akce'
                WHEN days_before BETWEEN 1 AND 3 THEN '1–3 dny'
                WHEN days_before BETWEEN 4 AND 7 THEN '4–7 dní'
                WHEN days_before BETWEEN 8 AND 30 THEN '8–30 dní'
                WHEN days_before BETWEEN 31 AND 90 THEN '1–3 měsíce'
                ELSE '3+ měsíce'
              END AS pasmo,
              COUNT(*)::int AS objednavky,
              ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (),1)::numeric AS pct
            FROM ld GROUP BY 1 ORDER BY MIN(days_before)`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'udalosti_resell', title: 'Resale / přeprodeje', category: 'udalosti',
    description: 'Přeprodané vstupenky přes Tixly Exchange.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'prodeju', label: 'Přeprodejů', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby z resale (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT re.id)::int AS prodeju,
                   ROUND(SUM(re.price_halire)/100.0,2)::numeric AS trzby_czk
            FROM public.resale_listings re
            JOIN catalog.events e ON e.id=re.event_id
            WHERE e.promoter_id=$1 AND re.status='sold'
              AND re.sold_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY prodeju DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'udalosti_charity', title: 'Charitativní vstupenky', category: 'udalosti',
    description: 'Charitably označené vstupenky a výnosy z nich.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'vstupenek', label: 'Charitativních', type: 'number' },
      { key: 'vynos_czk', label: 'Výnos (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   SUM(oi.quantity)::int AS vstupenek,
                   ROUND(SUM(oi.total_price)/100.0,2)::numeric AS vynos_czk
            FROM orders.order_items oi
            JOIN catalog.ticket_types tt ON tt.id=oi.ticket_type_id
            JOIN orders.orders o ON o.id=oi.order_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid' AND tt.is_charity=true
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY vynos_czk DESC LIMIT 50`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'udalosti_scan_rate', title: 'Scan rate per akce', category: 'udalosti',
    description: 'Kolik % vstupů bylo skutečně naskenováno na vstupu.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'vstupenek', label: 'Prodaných', type: 'number' },
      { key: 'naskenováno', label: 'Naskenováno', type: 'number' },
      { key: 'scan_rate', label: 'Scan %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT oi.id)::int AS vstupenek,
                   COUNT(DISTINCT sc.ticket_id)::int AS naskenováno,
                   ROUND(100.0*COUNT(DISTINCT sc.ticket_id)/NULLIF(COUNT(DISTINCT oi.id),0),1)::numeric AS scan_rate
            FROM catalog.events e
            JOIN orders.orders o ON o.event_id=e.id AND o.status='paid'
            JOIN orders.order_items oi ON oi.order_id=o.id
            LEFT JOIN public.scan_logs sc ON sc.order_item_id=oi.id AND sc.result='valid'
            WHERE e.promoter_id=$1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY scan_rate LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'udalosti_rescheduled', title: 'Přeložené akce — dopad', category: 'udalosti',
    description: 'Akce přeložené v daném období a počet refundů po přesunu.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'puvodni_datum', label: 'Původní datum', type: 'date' },
      { key: 'nove_datum', label: 'Nové datum', type: 'date' },
      { key: 'refundy', label: 'Refundů po přeloži', type: 'number' },
      { key: 'refund_czk', label: 'Refundováno (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   er.original_date::date::text AS puvodni_datum,
                   er.new_date::date::text AS nove_datum,
                   COUNT(DISTINCT ref.id)::int AS refundy,
                   ROUND(COALESCE(SUM(ref.amount_halire),0)/100.0,2)::numeric AS refund_czk
            FROM catalog.event_reschedules er
            JOIN catalog.events e ON e.id=er.event_id
            LEFT JOIN public.refunds ref ON ref.event_id=e.id
              AND ref.created_at > er.created_at
            WHERE e.promoter_id=$1
              AND er.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title, er.original_date, er.new_date
            ORDER BY er.original_date LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'udalosti_anniversary', title: 'Výroční akce', category: 'udalosti',
    description: 'Akce, které se každoročně opakují — porovnání tržeb YoY.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'rok', label: 'Rok', type: 'text' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'zmena_pct', label: 'vs. předch. rok %', type: 'pct' },
    ],
    buildQuery: (pid) => ({
      sql: `WITH per_year AS (
              SELECT e.title, DATE_PART('year', e.date_start)::int AS rok,
                     ROUND(SUM(o.total_amount)/100.0,2) AS trzby
              FROM catalog.events e
              JOIN orders.orders o ON o.event_id=e.id AND o.status='paid'
              WHERE e.promoter_id=$1
              GROUP BY e.title, rok
            )
            SELECT title AS akce, rok::text AS rok, trzby AS trzby_czk,
                   ROUND(100.0*(trzby-LAG(trzby) OVER (PARTITION BY title ORDER BY rok))
                     /NULLIF(LAG(trzby) OVER (PARTITION BY title ORDER BY rok),0),1)::numeric AS zmena_pct
            FROM per_year ORDER BY title, rok LIMIT 200`,
      values: [pid],
    }),
  },
  // ── MARKETING extra ─────────────────────────────────────────────────────────
  {
    id: 'marketing_meta_pixel', title: 'Meta Pixel events', category: 'marketing',
    description: 'Počet Purchase/InitiateCheckout events odeslaných přes CAPI.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'purchase', label: 'Purchase events', type: 'number' },
      { key: 'initiate_checkout', label: 'InitiateCheckout', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e_date::text AS den,
                   COUNT(*) FILTER (WHERE event_name='Purchase')::int AS purchase,
                   COUNT(*) FILTER (WHERE event_name='InitiateCheckout')::int AS initiate_checkout
            FROM analytics.pixel_events pe
            JOIN catalog.events e ON e.id=pe.event_id
            WHERE e.promoter_id=$1
              AND pe.sent_at::date BETWEEN $2 AND $3
            GROUP BY pe.sent_at::date ORDER BY pe.sent_at::date LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_broadcast_results', title: 'Broadcast výsledky', category: 'marketing',
    description: 'E-mailové kampaně — opens, clicks a prodeje.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kampan', label: 'Kampaň', type: 'text' },
      { key: 'odeslano', label: 'Odesláno', type: 'number' },
      { key: 'otevreno', label: 'Otevřeno', type: 'number' },
      { key: 'proklik', label: 'Proklik', type: 'number' },
      { key: 'open_rate', label: 'Open rate %', type: 'pct' },
      { key: 'ctr', label: 'CTR %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT bc.subject AS kampan,
                   bc.recipient_count::int AS odeslano,
                   bc.open_count::int AS otevreno,
                   bc.click_count::int AS proklik,
                   ROUND(100.0*bc.open_count/NULLIF(bc.recipient_count,0),1)::numeric AS open_rate,
                   ROUND(100.0*bc.click_count/NULLIF(bc.recipient_count,0),1)::numeric AS ctr
            FROM marketing.crm_broadcasts bc
            WHERE bc.promoter_id=$1 AND bc.status='sent'
              AND bc.sent_at::date BETWEEN $2 AND $3
            ORDER BY bc.sent_at DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_access_codes_pouziti', title: 'Přístupové kódy — využití', category: 'marketing',
    description: 'Kolik přístupových kódů bylo uplatněno vs. vydáno.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'skupina', label: 'Skupina kódů', type: 'text' },
      { key: 'vydano', label: 'Vydáno', type: 'number' },
      { key: 'uplatneno', label: 'Uplatněno', type: 'number' },
      { key: 'vyuziti_pct', label: 'Využití %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT acg.name AS skupina,
                   COUNT(ac.id)::int AS vydano,
                   COUNT(ac.id) FILTER (WHERE ac.used_at IS NOT NULL)::int AS uplatneno,
                   ROUND(100.0*COUNT(ac.id) FILTER (WHERE ac.used_at IS NOT NULL)
                     /NULLIF(COUNT(ac.id),0),1)::numeric AS vyuziti_pct
            FROM marketing.access_code_groups acg
            JOIN catalog.access_codes ac ON ac.group_id=acg.id
            JOIN catalog.events e ON e.id=acg.event_id
            WHERE e.promoter_id=$1
              AND acg.created_at::date BETWEEN $2 AND $3
            GROUP BY acg.id, acg.name ORDER BY vydano DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_rsvp_dle_akce', title: 'RSVP per akce', category: 'marketing',
    description: 'Počet RSVP registrací a konverzí per akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'rsvp', label: 'RSVP', type: 'number' },
      { key: 'konverze', label: 'Konverzí', type: 'number' },
      { key: 'rate', label: 'Rate %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT rsvp.user_id)::int AS rsvp,
                   COUNT(DISTINCT o.user_id) FILTER (WHERE o.status='paid')::int AS konverze,
                   ROUND(100.0*COUNT(DISTINCT o.user_id) FILTER (WHERE o.status='paid')
                     /NULLIF(COUNT(DISTINCT rsvp.user_id),0),1)::numeric AS rate
            FROM marketing.rsvp_registrations rsvp
            JOIN catalog.events e ON e.id=rsvp.event_id
            LEFT JOIN orders.orders o ON o.event_id=e.id AND o.user_id=rsvp.user_id
            WHERE e.promoter_id=$1
              AND rsvp.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY rsvp DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_social_shop', title: 'Social Shop prodeje', category: 'marketing',
    description: 'Objednávky iniciované z Social Shop (IG/TikTok) katalogu.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'platforma', label: 'Platforma', type: 'badge' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(o.referrer_platform, 'Neznámá') AS platforma,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.referrer_type='social_shop'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY trzby_czk DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_guestlist_bulk', title: 'Guestlist — bulk pozvánky', category: 'marketing',
    description: 'Hromadné pozvánky přes guestlist a jejich využití.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'pozvaných', label: 'Pozvaných', type: 'number' },
      { key: 'potvrzeno', label: 'Potvrzeno', type: 'number' },
      { key: 'naskenováno', label: 'Naskenováno', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(gle.id)::int AS pozvaných,
                   COUNT(gle.id) FILTER (WHERE gle.status='confirmed')::int AS potvrzeno,
                   COUNT(gle.id) FILTER (WHERE gle.scanned_at IS NOT NULL)::int AS naskenováno
            FROM public.guest_list_entries gle
            JOIN public.guest_lists gl ON gl.id=gle.guest_list_id
            JOIN catalog.events e ON e.id=gl.event_id
            WHERE e.promoter_id=$1
              AND gl.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY pozvaných DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'marketing_affiliate_partner', title: 'Affiliate partneři', category: 'marketing',
    description: 'Výkonnost affiliate partnerů — prokliky, konverze, komise.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'partner', label: 'Partner', type: 'text' },
      { key: 'prokliky', label: 'Prokliky', type: 'number' },
      { key: 'konverze', label: 'Konverze', type: 'number' },
      { key: 'komise_czk', label: 'Komise (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT ap.name AS partner,
                   COALESCE(SUM(ae.click_count),0)::int AS prokliky,
                   COUNT(DISTINCT o.id)::int AS konverze,
                   ROUND(COALESCE(SUM(ac.amount_halire),0)/100.0,2)::numeric AS komise_czk
            FROM marketing.affiliate_partners ap
            LEFT JOIN marketing.affiliate_events ae ON ae.partner_id=ap.id
              AND ae.occurred_at::date BETWEEN $2 AND $3
            LEFT JOIN orders.orders o ON o.affiliate_partner_id=ap.id
              AND o.status='paid' AND o.paid_at::date BETWEEN $2 AND $3
            LEFT JOIN catalog.events e ON e.id=o.event_id AND e.promoter_id=$1
            LEFT JOIN marketing.affiliate_commissions ac ON ac.order_id=o.id
            WHERE ap.promoter_id=$1
            GROUP BY ap.id, ap.name ORDER BY komise_czk DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── OPERACE extra ───────────────────────────────────────────────────────────
  {
    id: 'ops_ticket_type_scan', title: 'Scan dle typu vstupenky', category: 'operace',
    description: 'Naskenované vstupenky rozdělené dle ticket_type.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'typ', label: 'Typ vstupenky', type: 'text' },
      { key: 'celkem', label: 'Celkem', type: 'number' },
      { key: 'naskenováno', label: 'Naskenováno', type: 'number' },
      { key: 'pct', label: '%', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT tt.name AS typ,
                   COUNT(DISTINCT oi.id)::int AS celkem,
                   COUNT(DISTINCT sc.order_item_id)::int AS naskenováno,
                   ROUND(100.0*COUNT(DISTINCT sc.order_item_id)/NULLIF(COUNT(DISTINCT oi.id),0),1)::numeric AS pct
            FROM catalog.ticket_types tt
            JOIN orders.order_items oi ON oi.ticket_type_id=tt.id
            JOIN orders.orders o ON o.id=oi.order_id AND o.status='paid'
            JOIN catalog.events e ON e.id=o.event_id
            LEFT JOIN public.scan_logs sc ON sc.order_item_id=oi.id AND sc.result='valid'
            WHERE e.promoter_id=$1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY tt.id, tt.name ORDER BY celkem DESC LIMIT 50`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_invalid_scans', title: 'Zamítnuté scany', category: 'operace',
    description: 'Vstupenky, které byly odmítnuty na vstupu (duplikát, neplatná, špatná akce).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'zamitnutych', label: 'Zamítnutých', type: 'number' },
      { key: 'duvod', label: 'Hlavní důvod', type: 'badge' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(*)::int AS zamitnutych,
                   MODE() WITHIN GROUP (ORDER BY sc.result) AS duvod
            FROM public.scan_logs sc
            JOIN orders.order_items oi ON oi.id=sc.order_item_id
            JOIN orders.orders o ON o.id=oi.order_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND sc.result != 'valid'
              AND sc.scanned_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY zamitnutych DESC LIMIT 50`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_foyer_preorders', title: 'Foyer předobjednávky', category: 'operace',
    description: 'Předobjednávky přes foyer (občerstvení) per akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'objednavky', label: 'Objednávek', type: 'number' },
      { key: 'polozek', label: 'Položek', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT fo.id)::int AS objednavky,
                   SUM(foi.quantity)::int AS polozek,
                   ROUND(SUM(fo.total_halire)/100.0,2)::numeric AS trzby_czk
            FROM public.foyer_orders fo
            JOIN public.foyer_order_items foi ON foi.order_id=fo.id
            JOIN catalog.events e ON e.id=fo.event_id
            WHERE e.promoter_id=$1 AND fo.status='paid'
              AND fo.paid_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY trzby_czk DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_emergency_annc', title: 'Nouzová hlášení', category: 'operace',
    description: 'Nouzová oznámení odeslaná zákazníkům per akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'hlaseni', label: 'Hlášení', type: 'number' },
      { key: 'prumerny_dosah', label: 'Průměrný dosah', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(ea.id)::int AS hlaseni,
                   AVG(ea.recipient_count)::int AS prumerny_dosah
            FROM public.emergency_announcements ea
            JOIN catalog.events e ON e.id=ea.event_id
            WHERE e.promoter_id=$1
              AND ea.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY hlaseni DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_insurance_claims', title: 'Pojistné události — detaily', category: 'operace',
    description: 'Zákazníci, kteří žádali o pojistné plnění.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'zadosti', label: 'Žádostí', type: 'number' },
      { key: 'schvaleno', label: 'Schváleno', type: 'number' },
      { key: 'vyplaceno_czk', label: 'Vyplaceno (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(ic.id)::int AS zadosti,
                   COUNT(ic.id) FILTER (WHERE ic.status='approved')::int AS schvaleno,
                   ROUND(COALESCE(SUM(ic.paid_amount_halire) FILTER (WHERE ic.status='approved'),0)/100.0,2)::numeric AS vyplaceno_czk
            FROM public.insurance_claims ic
            JOIN orders.orders o ON o.id=ic.order_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1
              AND ic.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY zadosti DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_pos_sessions', title: 'POS pokladna — sessions', category: 'operace',
    description: 'Prodeje uskutečněné přes POS pokladnu na místě.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'sessions', label: 'Sessions', type: 'number' },
      { key: 'transakcí', label: 'Transakcí', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(DISTINCT o.pos_session_id)::int AS sessions,
                   COUNT(DISTINCT o.id)::int AS transakcí,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid' AND o.pos_session_id IS NOT NULL
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'ops_commemmorative', title: 'Vzpomínkové vstupenky (NFT/PDF)', category: 'operace',
    description: 'Vydané vzpomínkové vstupenky post-event.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'vydanych', label: 'Vydaných', type: 'number' },
      { key: 'stazenych', label: 'Stažených', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(ct.id)::int AS vydanych,
                   COUNT(ct.id) FILTER (WHERE ct.downloaded_at IS NOT NULL)::int AS stazenych
            FROM public.commemorative_tickets ct
            JOIN catalog.events e ON e.id=ct.event_id
            WHERE e.promoter_id=$1
              AND ct.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY vydanych DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── SROVNÁNÍ extra ──────────────────────────────────────────────────────────
  {
    id: 'srov_top_akce_3m', title: 'Top akce — 3 měsíce', category: 'srovnani',
    description: 'Nejlepší akce za posledních 90 dní seřazené dle tržeb.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'datum', label: 'Datum', type: 'date' },
      ...SALES_COLS,
    ],
    buildQuery: (pid) => ({
      sql: `SELECT e.title AS akce, e.date_start::date::text AS datum,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   COALESCE(SUM(oi.quantity),0)::int AS vstupenek,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   ROUND(AVG(o.total_amount)/100.0,2)::numeric AS prumer_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            LEFT JOIN orders.order_items oi ON oi.order_id=o.id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at >= NOW() - INTERVAL '90 days'
            GROUP BY e.id, e.title, e.date_start ORDER BY trzby_czk DESC LIMIT 50`,
      values: [pid],
    }),
  },
  {
    id: 'srov_venue_fill_yoy', title: 'Fill rate YoY per venue', category: 'srovnani',
    description: 'Porovnání obsazenosti sálů mezi lety.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'venue', label: 'Místo', type: 'text' },
      { key: 'rok', label: 'Rok', type: 'text' },
      { key: 'fill_rate', label: 'Fill rate %', type: 'pct' },
    ],
    buildQuery: (pid) => ({
      sql: `SELECT COALESCE(v.name,'Online') AS venue,
                   DATE_PART('year', e.date_start)::text AS rok,
                   ROUND(100.0*COALESCE(SUM(oi.quantity),0)/NULLIF(SUM(e.capacity),0),1)::numeric AS fill_rate
            FROM catalog.events e
            LEFT JOIN catalog.venues v ON v.id=e.venue_id
            JOIN orders.orders o ON o.event_id=e.id AND o.status='paid'
            LEFT JOIN orders.order_items oi ON oi.order_id=o.id
            WHERE e.promoter_id=$1
            GROUP BY v.id, v.name, rok ORDER BY venue, rok LIMIT 200`,
      values: [pid],
    }),
  },
  {
    id: 'srov_promo_vs_organicky', title: 'Promo vs. organický — trend', category: 'srovnani',
    description: 'Měsíční vývoj podílu promo kódů vs. organických nákupů.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'promo_pct', label: 'S promo %', type: 'pct' },
      { key: 'organic_pct', label: 'Bez promo %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.promo_code IS NOT NULL)/COUNT(*),1)::numeric AS promo_pct,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.promo_code IS NULL)/COUNT(*),1)::numeric AS organic_pct
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_platba_trend', title: 'Platební metody — trend', category: 'srovnani',
    description: 'Měsíční vývoj podílu platebních metod (karta / bankovní převod / jiné).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'karta_pct', label: 'Karta %', type: 'pct' },
      { key: 'prevod_pct', label: 'Převod %', type: 'pct' },
      { key: 'jine_pct', label: 'Jiné %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.payment_method='card')/COUNT(*),1)::numeric AS karta_pct,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.payment_method='bank_transfer')/COUNT(*),1)::numeric AS prevod_pct,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.payment_method NOT IN ('card','bank_transfer'))/COUNT(*),1)::numeric AS jine_pct
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_kategorie_yoy', title: 'Kategorie akcí — YoY', category: 'srovnani',
    description: 'Porovnání kategorií (Concert, Theatre, Sport…) mezi lety.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'kategorie', label: 'Kategorie', type: 'badge' },
      { key: 'rok', label: 'Rok', type: 'text' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'zmena_pct', label: 'YoY %', type: 'pct' },
    ],
    buildQuery: (pid) => ({
      sql: `WITH cy AS (
              SELECT COALESCE(e.category,'Jiné') AS kat,
                     DATE_PART('year', e.date_start)::int AS rok,
                     ROUND(SUM(o.total_amount)/100.0,2) AS trzby
              FROM catalog.events e JOIN orders.orders o ON o.event_id=e.id AND o.status='paid'
              WHERE e.promoter_id=$1 GROUP BY kat, rok
            )
            SELECT kat AS kategorie, rok::text AS rok, trzby AS trzby_czk,
                   ROUND(100.0*(trzby-LAG(trzby) OVER (PARTITION BY kat ORDER BY rok))
                     /NULLIF(LAG(trzby) OVER (PARTITION BY kat ORDER BY rok),0),1)::numeric AS zmena_pct
            FROM cy ORDER BY kat, rok LIMIT 200`,
      values: [pid],
    }),
  },
  {
    id: 'srov_channel_roi', title: 'Prodejní kanály ROI', category: 'srovnani',
    description: 'Tržby dle prodejního kanálu (web, POS, embed, API, mobile).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kanal', label: 'Kanál', type: 'badge' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'pct', label: 'Podíl %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(o.sale_channel,'web') AS kanal,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   ROUND(100.0*SUM(o.total_amount)/NULLIF(SUM(SUM(o.total_amount)) OVER(),0),1)::numeric AS pct
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY trzby_czk DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── PLATFORMA extra ─────────────────────────────────────────────────────────
  {
    id: 'platform_onboarding_wizard', title: 'Onboarding wizard stav', category: 'platform',
    description: 'Promotéři v průběhu onboarding wizardu — v jakém kroku stojí.',
    scope: 'platform', params: [],
    columns: [
      { key: 'krok', label: 'Krok', type: 'badge' },
      { key: 'promoteru', label: 'Promotérů', type: 'number' },
    ],
    buildQuery: (pid) => ({
      sql: `SELECT COALESCE(ow.current_step,'nezahájeno') AS krok,
                   COUNT(p.id)::int AS promoteru
            FROM platform.promoters p
            LEFT JOIN platform.onboarding_wizards ow ON ow.promoter_id=p.id
            WHERE p.id != $1
            GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      values: [pid],
    }),
  },
  {
    id: 'platform_kyc_status', title: 'KYC / AML stavy', category: 'platform',
    description: 'Počty promotérů dle stavu KYC verifikace.',
    scope: 'platform', params: [],
    columns: [
      { key: 'kyc_status', label: 'KYC stav', type: 'badge' },
      { key: 'promoteru', label: 'Promotérů', type: 'number' },
    ],
    buildQuery: () => ({
      sql: `SELECT COALESCE(p.kyc_status, 'neuvedeno') AS kyc_status,
                   COUNT(p.id)::int AS promoteru
            FROM platform.promoters p
            GROUP BY 1 ORDER BY 2 DESC`,
      values: [],
    }),
  },
  {
    id: 'platform_new_events', title: 'Nové akce (platform)', category: 'platform',
    description: 'Denní počet nově vytvořených akcí na celé platformě.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'akci', label: 'Nových akcí', type: 'number' },
      { key: 'promoteru', label: 'Aktivních promotérů', type: 'number' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT e.created_at::date::text AS den,
                   COUNT(e.id)::int AS akci,
                   COUNT(DISTINCT e.promoter_id)::int AS promoteru
            FROM catalog.events e
            WHERE e.created_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1 LIMIT 200`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_scan_volume', title: 'Scan volume (platform)', category: 'platform',
    description: 'Celkový denní objem scanů na všech akcích platformy.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'scanu', label: 'Scanů', type: 'number' },
      { key: 'valid_pct', label: 'Valid %', type: 'pct' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT sc.scanned_at::date::text AS den,
                   COUNT(*)::int AS scanu,
                   ROUND(100.0*COUNT(*) FILTER (WHERE sc.result='valid')/COUNT(*),1)::numeric AS valid_pct
            FROM public.scan_logs sc
            WHERE sc.scanned_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1 LIMIT 200`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_resellers', title: 'Reseller partneři (platform)', category: 'platform',
    description: 'Tržby přes reseller síť agregované per promotér.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'promoter', label: 'Promotér', type: 'text' },
      { key: 'resellerov', label: 'Resellerů', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby přes resell (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT pr.name AS promoter,
                   COUNT(DISTINCT rp.id)::int AS resellerov,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM platform.promoters pr
            JOIN platform.reseller_partners rp ON rp.promoter_id=pr.id
            JOIN orders.orders o ON o.reseller_id=rp.id AND o.status='paid'
              AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY pr.id, pr.name ORDER BY trzby_czk DESC LIMIT 100`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_mrr', title: 'MRR (Monthly Recurring Revenue)', category: 'platform',
    description: 'Měsíční opakující se výnosy z předplatného a abonmentek.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'subscriptions', label: 'Předplatných', type: 'number' },
      { key: 'mrr_czk', label: 'MRR (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', sp.paid_at)::date::text AS mesic,
                   COUNT(DISTINCT sp.id)::int AS subscriptions,
                   ROUND(SUM(sp.amount_halire)/100.0,2)::numeric AS mrr_czk
            FROM platform.subscription_payments sp
            WHERE sp.paid_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_top_revenue_global', title: 'Top 50 akcí globálně', category: 'platform',
    description: 'Padesát nejvýnosnějších akcí napříč celou platformou.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'promoter', label: 'Promotér', type: 'text' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT e.title AS akce, pr.name AS promoter,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            JOIN platform.promoters pr ON pr.id=e.promoter_id
            WHERE o.status='paid' AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY e.id, e.title, pr.name ORDER BY trzby_czk DESC LIMIT 50`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_avg_fees', title: 'Průměrné poplatky (platform)', category: 'platform',
    description: 'Průměrná servisní sazba na objednávku dle promotéra.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'promoter', label: 'Promotér', type: 'text' },
      { key: 'objednavky', label: 'Objednávek', type: 'number' },
      { key: 'avg_fee_pct', label: 'Průměr. poplatek %', type: 'pct' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT pr.name AS promoter,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(100.0*AVG(o.platform_fee_halire::numeric/NULLIF(o.total_amount,0)),2)::numeric AS avg_fee_pct
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            JOIN platform.promoters pr ON pr.id=e.promoter_id
            WHERE o.status='paid' AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY pr.id, pr.name HAVING COUNT(DISTINCT o.id) >= 10
            ORDER BY avg_fee_pct DESC LIMIT 100`,
      values: [from(p), to(p)],
    }),
  },
];

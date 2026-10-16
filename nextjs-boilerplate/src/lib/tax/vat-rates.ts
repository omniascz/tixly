/**
 * Sazby DPH pro odhady a PDF vstupenky — kolo 7 (C-54): ŽÁDNÁ procenta v kódu.
 *
 * Dřív tu byla natvrdo zapsaná tabulka sazeb 14 zemí (a v PDF výchozí 10 %, zrušená k 1. 1. 2024).
 * Zdroj pravdy je teď DB: kód sazby na typu vstupenky (catalog.ticket_types.vat_rate_code) a
 * procenta s platností v platform.vat_rates (migrace 494, zdroj hodnot uveden tamtéž).
 *
 *   number  = sazba v %
 *   0       = prodávající není plátce DPH (u odhadů: bez DPH)
 *   null    = plátce, ale sazba není nastavená → volající to musí řešit (ne tichých 0 %)
 */

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Sazba vstupenek akce pro ODHADY (bod zvratu, vyúčtování umělce, náhled honoráře): kód sazby
 * nejčastější mezi placenými typy (při shodě vyšší sazba), procento k datu `date` (výchozí dnes).
 */
export async function eventTicketVatPct(q: Queryable, eventId: string, date: string | Date = today()): Promise<number | null> {
  const d = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  const r = await q.query(
    `SELECT p.vat_payer,
            (SELECT platform.vat_rate_at(x.code, $2::date)
               FROM (SELECT tt.vat_rate_code AS code, count(*) AS n
                       FROM catalog.ticket_types tt
                      WHERE tt.event_id = e.id AND tt.base_price > 0 AND tt.vat_rate_code IS NOT NULL
                      GROUP BY 1) x
              ORDER BY x.n DESC, platform.vat_rate_at(x.code, $2::date) DESC NULLS LAST
              LIMIT 1) AS pct
       FROM catalog.events e JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.id = $1`,
    [eventId, d],
  );
  const row = r.rows[0] as { vat_payer: boolean; pct: string | number | null } | undefined;
  if (!row) return null;
  if (!row.vat_payer) return 0;
  return row.pct === null || row.pct === undefined ? null : Number(row.pct);
}

/**
 * Sazba pro PDF vstupenek objednávky: sazba typů vstupenek objednávky k datu zaplacení
 * (den přijetí úplaty = vznik povinnosti přiznat daň, § 20a ZDPH). Smíšené sazby → sazba položky
 * s největší částkou (PDF vstupenek je přehled; daňový doklad rozepisuje po sazbách zvlášť).
 * null = prodávající není plátce DPH; undefined = plátce bez sazby (rozpis DPH se netiskne).
 */
export async function orderTicketVatPct(q: Queryable, orderId: string): Promise<number | null | undefined> {
  const r = await q.query(
    `SELECT p.vat_payer,
            (SELECT platform.vat_rate_at(tt.vat_rate_code, COALESCE(o.paid_at, o.created_at)::date)
               FROM orders.order_items oi JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
              WHERE oi.order_id = o.id AND tt.vat_rate_code IS NOT NULL
              ORDER BY oi.total_price DESC LIMIT 1) AS pct
       FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE o.id = $1`,
    [orderId],
  );
  const row = r.rows[0] as { vat_payer: boolean; pct: string | number | null } | undefined;
  if (!row) return undefined;
  if (!row.vat_payer) return null;
  return row.pct === null || row.pct === undefined ? undefined : Number(row.pct);
}

export const VAT_RATE_MISSING_MESSAGE =
  'Plátce DPH nemá u placených typů vstupenek nastavenou sazbu DPH — odhad nelze spočítat.';

/**
 * Daňové doklady pořadatele kupci (kolo 7, C-54): vystavení, dobropis při refundu, načtení do modelu.
 *
 * Pravidla:
 *   - Sazba se bere z typu vstupenky (catalog.ticket_types.vat_rate_code) a platí k datu uskutečnění
 *     plnění = den přijetí úplaty (zaplacení objednávky, § 20a ZDPH), v časovém pásmu Europe/Prague.
 *   - Celková částka dokladu = zaplacená částka objednávky; rozdělí se mezi sazby podle podílu položek
 *     (metoda největšího zbytku), pak se každá skupina rozloží na základ a DPH (lib/tax/vat.ts).
 *   - Neplátce: doklad bez DPH s textem „Prodávající není plátcem DPH" (rozpis sazeb se neukládá).
 *   - Číslo z řady per pořadatel × rok × druh (orders.next_document_number) ve STEJNÉ transakci jako
 *     vložení dokladu → bez děr a duplicit i při souběhu.
 *   - Volající běží v systémovém kontextu (asSystemInTx / runWithServiceContext) a ověřuje oprávnění.
 */
import type { PoolClient } from 'pg';
import { breakdownByRate, type VatBreakdownLine } from '@/lib/tax/vat';
import {
  allocateProportionally,
  parseAddress,
  type TaxDocItem,
  type TaxDocParty,
  type TaxDocument,
} from './tax-document';

type Q = Pick<PoolClient, 'query'>;

export class TaxDocumentError extends Error {
  constructor(public code: 'NOT_FOUND' | 'NOT_PAID' | 'VAT_RATE_MISSING' | 'NO_ITEMS', message: string) {
    super(message);
  }
}

export interface DocCustomer {
  name: string;
  email?: string | null;
  address?: string | null;
  ico?: string | null;
  dic?: string | null;
}

const pad = (n: number): string => String(n).padStart(4, '0');

async function nextNumber(q: Q, promoterId: string, year: number, series: 'invoice' | 'credit_note'): Promise<string> {
  const r = await q.query<{ n: number }>(`SELECT orders.next_document_number($1, $2, $3) AS n`, [promoterId, year, series]);
  const n = r.rows[0].n;
  return series === 'invoice' ? `${year}-${pad(n)}` : `D${year}-${pad(n)}`;
}

interface PromoterRow {
  name: string;
  company_ico: string | null;
  company_dic: string | null;
  company_address: string | null;
  vat_payer: boolean;
  bank_account: string | null;
  contact_email: string | null;
}

async function loadPromoter(q: Q, promoterId: string): Promise<PromoterRow> {
  const r = await q.query<PromoterRow>(
    `SELECT name, company_ico, company_dic, company_address, vat_payer, bank_account, contact_email
       FROM platform.promoters WHERE id = $1`,
    [promoterId],
  );
  if (!r.rows[0]) throw new TaxDocumentError('NOT_FOUND', 'Pořadatel nenalezen.');
  return r.rows[0];
}

function supplierSnapshot(p: PromoterRow): TaxDocParty & { vatPayer: boolean } {
  return {
    name: p.name,
    ico: p.company_ico,
    dic: p.vat_payer ? p.company_dic : null,
    address: parseAddress(p.company_address),
    email: p.contact_email,
    bankAccount: p.bank_account,
    vatPayer: p.vat_payer,
  };
}

async function insertDocument(
  q: Q,
  d: {
    docType: 'invoice' | 'credit_note';
    promoterId: string;
    orderId: string | null;
    hospitalityInquiryId?: string | null;
    correctsInvoiceId?: string | null;
    number: string;
    year: number;
    taxableDate: string;
    dueDate: string;
    currency: string;
    customer: DocCustomer;
    supplier: TaxDocParty & { vatPayer: boolean };
    vatLines: VatBreakdownLine[];
    totalMinor: number;
    paidAt: string | null;
  },
): Promise<string> {
  const base = d.supplier.vatPayer ? d.vatLines.reduce((a, l) => a + l.baseMinor, 0) : d.totalMinor;
  const vat = d.supplier.vatPayer ? d.vatLines.reduce((a, l) => a + l.vatMinor, 0) : 0;
  const singleRate = d.supplier.vatPayer && d.vatLines.length === 1 ? Math.round(d.vatLines[0].ratePct) : null;
  const ins = await q.query<{ id: string }>(
    `INSERT INTO orders.invoices
       (order_id, hospitality_inquiry_id, promoter_id, invoice_number, issue_date, due_date,
        subtotal_minor, vat_rate_pct, vat_amount_minor, total_minor, currency,
        customer_name, customer_email, customer_address, customer_ico, customer_dic, paid_at,
        doc_type, corrects_invoice_id, taxable_supply_date, supplier_vat_payer, supplier, series_year)
     VALUES ($1, $2, $3, $4, (NOW() AT TIME ZONE 'Europe/Prague')::date, $5,
             $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21::jsonb, $22)
     RETURNING id`,
    [
      d.orderId, d.hospitalityInquiryId ?? null, d.promoterId, d.number, d.dueDate,
      base, singleRate, vat, d.totalMinor, d.currency,
      d.customer.name, d.customer.email ?? null, d.customer.address ?? null, d.customer.ico ?? null, d.customer.dic ?? null, d.paidAt,
      d.docType, d.correctsInvoiceId ?? null, d.taxableDate, d.supplier.vatPayer, JSON.stringify(d.supplier), d.year,
    ],
  );
  const id = ins.rows[0].id;
  if (d.supplier.vatPayer) {
    for (const l of d.vatLines) {
      await q.query(
        `INSERT INTO orders.invoice_vat_lines (invoice_id, vat_rate_code, rate_pct, base_minor, vat_minor, total_minor)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, l.vatRateCode, l.ratePct, l.baseMinor, l.vatMinor, l.totalMinor],
      );
    }
  }
  return id;
}

/**
 * Vystaví daňový doklad k ZAPLACENÉ objednávce (idempotentně: existující doklad vrátí).
 * Musí běžet v transakci volajícího (číslo z řady + vložení atomicky).
 */
export async function issueOrderDocument(
  q: Q,
  orderId: string,
  customerOverride?: DocCustomer,
): Promise<{ invoiceId: string; created: boolean }> {
  const existing = await q.query<{ id: string }>(
    `SELECT id FROM orders.invoices WHERE order_id = $1 AND doc_type = 'invoice'`,
    [orderId],
  );
  if (existing.rows[0]) return { invoiceId: existing.rows[0].id, created: false };

  const o = await q.query<{
    status: string; total_amount: number; currency: string; paid_on: string | null; paid_at: string | null;
    promoter_id: string; user_name: string | null; user_email: string | null;
  }>(
    `SELECT o.status, o.total_amount, o.currency, o.paid_at::text AS paid_at,
            ((COALESCE(o.paid_at, o.updated_at)) AT TIME ZONE 'Europe/Prague')::date::text AS paid_on,
            e.promoter_id, u.name AS user_name, u.email AS user_email
       FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       LEFT JOIN identity.users u ON u.id = o.user_id
      WHERE o.id = $1
      FOR UPDATE OF o`,
    [orderId],
  );
  const order = o.rows[0];
  if (!order) throw new TaxDocumentError('NOT_FOUND', 'Objednávka nenalezena.');
  if (order.status !== 'paid') throw new TaxDocumentError('NOT_PAID', 'Doklad lze vystavit jen k zaplacené objednávce.');
  const taxableDate = order.paid_on as string;

  const p = await loadPromoter(q, order.promoter_id);
  const supplier = supplierSnapshot(p);

  const items = await q.query<{ vat_rate_code: string | null; total_price: number; quantity: number; name: string; pct: string | null }>(
    `SELECT tt.vat_rate_code, oi.total_price, oi.quantity, tt.name,
            platform.vat_rate_at(tt.vat_rate_code, $2::date)::text AS pct
       FROM orders.order_items oi
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at, oi.id`,
    [orderId, taxableDate],
  );
  if (items.rows.length === 0) throw new TaxDocumentError('NO_ITEMS', 'Objednávka nemá položky.');

  let vatLines: VatBreakdownLine[] = [];
  if (supplier.vatPayer) {
    for (const it of items.rows) {
      if (!it.vat_rate_code || it.pct === null) {
        throw new TaxDocumentError('VAT_RATE_MISSING', `Typ vstupenky „${it.name}" nemá k datu plnění platnou sazbu DPH.`);
      }
    }
    // Zaplacená částka se rozdělí mezi položky podle jejich ceny (slevy/poplatky poměrně).
    const alloc = allocateProportionally(order.total_amount, items.rows.map((it) => Math.max(0, it.total_price)));
    vatLines = breakdownByRate(
      items.rows.map((it, i) => ({ vatRateCode: it.vat_rate_code as string, ratePct: Number(it.pct), grossMinor: alloc[i] })),
    );
  }

  const year = Number(taxableDate.slice(0, 4));
  const number = await nextNumber(q, order.promoter_id, year, 'invoice');
  const customer: DocCustomer = customerOverride ?? { name: order.user_name ?? order.user_email ?? 'Zákazník', email: order.user_email };
  const invoiceId = await insertDocument(q, {
    docType: 'invoice', promoterId: order.promoter_id, orderId, number, year, taxableDate,
    dueDate: taxableDate, currency: order.currency, customer, supplier, vatLines,
    totalMinor: order.total_amount, paidAt: order.paid_at,
  });
  return { invoiceId, created: true };
}

/**
 * Opravný daňový doklad (dobropis) k refundu objednávky, pokud k ní byl vystaven doklad.
 * Plný refund = přesné záporné zrcadlo řádků; částečný refund se rozdělí mezi sazby poměrně.
 * Vrací id dobropisu, nebo null (objednávka doklad nemá → dobropis nevzniká).
 */
export async function issueCreditNoteForRefund(q: Q, orderId: string, refundMinor: number): Promise<string | null> {
  if (refundMinor <= 0) return null;
  const inv = await q.query<{
    id: string; promoter_id: string; currency: string; total_minor: number; supplier: TaxDocParty & { vatPayer: boolean } | null;
    supplier_vat_payer: boolean | null; customer_name: string; customer_email: string | null; customer_address: string | null;
    customer_ico: string | null; customer_dic: string | null; today: string;
  }>(
    `SELECT id, promoter_id, currency, total_minor, supplier, supplier_vat_payer,
            customer_name, customer_email, customer_address, customer_ico, customer_dic,
            (NOW() AT TIME ZONE 'Europe/Prague')::date::text AS today
       FROM orders.invoices WHERE order_id = $1 AND doc_type = 'invoice' FOR UPDATE`,
    [orderId],
  );
  const doc = inv.rows[0];
  if (!doc) return null;

  const supplier = doc.supplier ?? supplierSnapshot(await loadPromoter(q, doc.promoter_id));
  const vatPayer = doc.supplier_vat_payer ?? supplier.vatPayer;
  const amount = Math.min(refundMinor, doc.total_minor);
  let vatLines: VatBreakdownLine[] = [];
  if (vatPayer) {
    const lines = await q.query<{ vat_rate_code: string; rate_pct: string; base_minor: string; vat_minor: string; total_minor: string }>(
      `SELECT vat_rate_code, rate_pct::text, base_minor::text, vat_minor::text, total_minor::text
         FROM orders.invoice_vat_lines WHERE invoice_id = $1 ORDER BY rate_pct DESC, vat_rate_code`,
      [doc.id],
    );
    if (amount === doc.total_minor) {
      vatLines = lines.rows.map((l) => ({
        vatRateCode: l.vat_rate_code, ratePct: Number(l.rate_pct),
        baseMinor: -Number(l.base_minor), vatMinor: -Number(l.vat_minor), totalMinor: -Number(l.total_minor),
      }));
    } else {
      const alloc = allocateProportionally(-amount, lines.rows.map((l) => Number(l.total_minor)));
      vatLines = breakdownByRate(lines.rows.map((l, i) => ({ vatRateCode: l.vat_rate_code, ratePct: Number(l.rate_pct), grossMinor: alloc[i] })));
    }
  }
  const year = Number(doc.today.slice(0, 4));
  const number = await nextNumber(q, doc.promoter_id, year, 'credit_note');
  return insertDocument(q, {
    docType: 'credit_note', promoterId: doc.promoter_id, orderId, correctsInvoiceId: doc.id, number, year,
    taxableDate: doc.today, dueDate: doc.today, currency: doc.currency,
    customer: { name: doc.customer_name, email: doc.customer_email, address: doc.customer_address, ico: doc.customer_ico, dic: doc.customer_dic },
    supplier: { ...supplier, vatPayer }, vatLines, totalMinor: -amount, paidAt: null,
  });
}

/** Načte doklad (vč. rozpisu a položek) do jednotného modelu pro PDF a ISDOC. */
export async function loadTaxDocument(q: Q, invoiceId: string): Promise<TaxDocument | null> {
  const r = await q.query<{
    id: string; doc_type: 'invoice' | 'credit_note'; invoice_number: string; issue_date: string; due_date: string;
    taxable_supply_date: string | null; currency: string; total_minor: string; supplier: (TaxDocParty & { vatPayer: boolean }) | null;
    supplier_vat_payer: boolean | null; promoter_id: string; order_id: string | null; paid_at: string | null;
    customer_name: string; customer_email: string | null; customer_address: string | null; customer_ico: string | null; customer_dic: string | null;
    corrects_invoice_id: string | null; corr_number: string | null; corr_issue: string | null;
  }>(
    `SELECT i.id, i.doc_type, i.invoice_number, i.issue_date::text, i.due_date::text, i.taxable_supply_date::text,
            i.currency, i.total_minor::text, i.supplier, i.supplier_vat_payer, i.promoter_id, i.order_id, i.paid_at::text,
            i.customer_name, i.customer_email, i.customer_address, i.customer_ico, i.customer_dic,
            i.corrects_invoice_id, c.invoice_number AS corr_number, c.issue_date::text AS corr_issue
       FROM orders.invoices i LEFT JOIN orders.invoices c ON c.id = i.corrects_invoice_id
      WHERE i.id = $1`,
    [invoiceId],
  );
  const d = r.rows[0];
  if (!d) return null;
  const supplier = d.supplier ?? supplierSnapshot(await loadPromoter(q, d.promoter_id));
  const vatPayer = d.supplier_vat_payer ?? supplier.vatPayer;
  const lines = vatPayer
    ? (
        await q.query<{ vat_rate_code: string; rate_pct: string; base_minor: string; vat_minor: string; total_minor: string }>(
          `SELECT vat_rate_code, rate_pct::text, base_minor::text, vat_minor::text, total_minor::text
             FROM orders.invoice_vat_lines WHERE invoice_id = $1 ORDER BY rate_pct DESC, vat_rate_code`,
          [d.id],
        )
      ).rows.map((l) => ({
        vatRateCode: l.vat_rate_code, ratePct: Number(l.rate_pct),
        baseMinor: Number(l.base_minor), vatMinor: Number(l.vat_minor), totalMinor: Number(l.total_minor),
      }))
    : [];
  const total = Number(d.total_minor);
  // Položky = řádky po sazbách (vstupné dle sazby); u neplátce jedna položka.
  const items: TaxDocItem[] = vatPayer
    ? lines.map((l) => ({ description: `Vstupné (sazba DPH ${l.ratePct} %)`, quantity: 1, totalMinor: l.totalMinor, vatRateCode: l.vatRateCode, ratePct: l.ratePct }))
    : [{ description: 'Vstupné', quantity: 1, totalMinor: total, vatRateCode: null, ratePct: null }];
  return {
    id: d.id,
    docType: d.doc_type,
    number: d.invoice_number,
    issueDate: d.issue_date,
    taxableSupplyDate: d.taxable_supply_date ?? d.issue_date,
    dueDate: d.due_date,
    currency: d.currency.trim(),
    supplier: { ...supplier, vatPayer },
    customer: {
      name: d.customer_name, email: d.customer_email, ico: d.customer_ico, dic: d.customer_dic,
      address: parseAddress(d.customer_address),
    },
    items,
    vatLines: lines,
    totalMinor: total,
    correctedDocument: d.corrects_invoice_id ? { id: d.corrects_invoice_id, number: d.corr_number ?? '', issueDate: d.corr_issue ?? '' } : null,
    paid: d.doc_type === 'invoice' ? !!d.paid_at : true,
  };
}

/**
 * Doklad k hospitality poptávce (nemá typ vstupenky → sazbu zadá pořadatel; plátce povinně).
 * Musí běžet v transakci volajícího.
 */
export async function issueHospitalityDocument(
  q: Q,
  args: {
    promoterId: string;
    hospitalityInquiryId: string;
    totalMinor: number;
    currency: string;
    vatRateCode: string | null;
    customer: DocCustomer;
    paid: boolean;
  },
): Promise<string> {
  const existing = await q.query<{ id: string }>(
    `SELECT id FROM orders.invoices WHERE hospitality_inquiry_id = $1 AND doc_type = 'invoice'`,
    [args.hospitalityInquiryId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const today = (await q.query<{ d: string }>(`SELECT (NOW() AT TIME ZONE 'Europe/Prague')::date::text AS d`)).rows[0].d;
  const p = await loadPromoter(q, args.promoterId);
  const supplier = supplierSnapshot(p);
  let vatLines: VatBreakdownLine[] = [];
  if (supplier.vatPayer) {
    if (!args.vatRateCode) throw new TaxDocumentError('VAT_RATE_MISSING', 'Plátce DPH musí u dokladu zadat sazbu DPH (vatRateCode).');
    const pct = (await q.query<{ p: string | null }>(`SELECT platform.vat_rate_at($1, $2::date)::text AS p`, [args.vatRateCode, today])).rows[0].p;
    if (pct === null) throw new TaxDocumentError('VAT_RATE_MISSING', `Sazba ${args.vatRateCode} k ${today} neplatí.`);
    vatLines = breakdownByRate([{ vatRateCode: args.vatRateCode, ratePct: Number(pct), grossMinor: args.totalMinor }]);
  }
  const year = Number(today.slice(0, 4));
  const number = await nextNumber(q, args.promoterId, year, 'invoice');
  const due = new Date(`${today}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 14);
  return insertDocument(q, {
    docType: 'invoice', promoterId: args.promoterId, orderId: null, hospitalityInquiryId: args.hospitalityInquiryId,
    number, year, taxableDate: today, dueDate: args.paid ? today : due.toISOString().slice(0, 10), currency: args.currency,
    customer: args.customer, supplier, vatLines, totalMinor: args.totalMinor, paidAt: null,
  });
}

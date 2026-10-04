/**
 * Faktury provize platformy pořadatelům (kolo 7, C-54). Dodavatel = platforma (platform.billing_identity),
 * odběratel = pořadatel. Jedna faktura na výplatu (platform.payouts), provize = payouts.platform_fees.
 *
 * PŘEDPOKLAD (k potvrzení vlastníkem): `platform_fees` je cena služby platformy VČETNĚ DPH — je to
 * částka, o kterou se výplata pořadateli skutečně snížila. Je-li platforma plátce, rozloží se na
 * základ a DPH sazbou CZ_STANDARD (služba) k datu uskutečnění plnění = konec výplatního období.
 * Číslo: řada per pořadatel × rok (orders.document_sequences, druh 'commission'), prefix s kódem
 * pořadatele → jedinečné v rámci dodavatele.
 */
import type { PoolClient } from 'pg';
import { splitGrossMinor } from '@/lib/tax/vat';
import { parseAddress, type TaxDocParty, type TaxDocument } from './tax-document';

type Q = Pick<PoolClient, 'query'>;

export const COMMISSION_VAT_RATE_CODE = 'CZ_STANDARD';

export class CommissionInvoiceError extends Error {
  constructor(public code: 'NOT_FOUND' | 'PLATFORM_BILLING_NOT_CONFIGURED' | 'VAT_RATE_MISSING' | 'NO_FEES', message: string) {
    super(message);
  }
}

interface BillingIdentityRow {
  legal_name: string; ico: string; dic: string | null; vat_payer: boolean;
  street: string; city: string; zip: string; country: string; bank_account: string | null; email: string | null;
}

export async function loadPlatformSupplier(q: Q): Promise<TaxDocParty & { vatPayer: boolean }> {
  const r = await q.query<BillingIdentityRow>(`SELECT * FROM platform.billing_identity WHERE id = 1`);
  const b = r.rows[0];
  if (!b) {
    throw new CommissionInvoiceError(
      'PLATFORM_BILLING_NOT_CONFIGURED',
      'Fakturační údaje platformy (dodavatel) nejsou vyplněné — platform.billing_identity.',
    );
  }
  return {
    name: b.legal_name, ico: b.ico, dic: b.vat_payer ? b.dic : null, vatPayer: b.vat_payer,
    address: { street: b.street, city: b.city, zip: b.zip, country: b.country },
    bankAccount: b.bank_account, email: b.email,
  };
}

/** Vystaví (idempotentně) fakturu provize k výplatě. Musí běžet v transakci volajícího. */
export async function issueCommissionInvoice(
  q: Q,
  payoutId: string,
): Promise<{ invoiceId: string | null; created: boolean; reason?: 'NO_COMMISSION' }> {
  const existing = await q.query<{ id: string }>(`SELECT id FROM platform.commission_invoices WHERE payout_id = $1`, [payoutId]);
  if (existing.rows[0]) return { invoiceId: existing.rows[0].id, created: false };

  const p = await q.query<{
    promoter_id: string; platform_fees: number; currency: string; period_end: string; today: string;
    name: string; company_ico: string | null; company_dic: string | null; company_address: string | null;
    vat_payer: boolean; contact_email: string | null;
  }>(
    `SELECT po.promoter_id, po.platform_fees, po.currency,
            (po.period_to AT TIME ZONE 'Europe/Prague')::date::text AS period_end,
            (NOW() AT TIME ZONE 'Europe/Prague')::date::text AS today,
            pr.name, pr.company_ico, pr.company_dic, pr.company_address, pr.vat_payer, pr.contact_email
       FROM platform.payouts po JOIN platform.promoters pr ON pr.id = po.promoter_id
      WHERE po.id = $1
      FOR UPDATE OF po`,
    [payoutId],
  );
  const row = p.rows[0];
  if (!row) throw new CommissionInvoiceError('NOT_FOUND', 'Výplata nenalezena.');
  // Kolo 8: pořadatel s provizí 0 (vlastní pořadatel platformy) — faktura provize nevzniká a není to
  // chyba (ani při nevyplněných údajích platformy). Kontrola PŘED načtením dodavatele.
  if (row.platform_fees <= 0) return { invoiceId: null, created: false, reason: 'NO_COMMISSION' };

  const supplier = await loadPlatformSupplier(q);
  const taxable = row.period_end;
  let ratePct: number | null = null;
  let baseMinor = row.platform_fees;
  let vatMinor = 0;
  if (supplier.vatPayer) {
    const pct = (await q.query<{ p: string | null }>(`SELECT platform.vat_rate_at($1, $2::date)::text AS p`, [COMMISSION_VAT_RATE_CODE, taxable])).rows[0].p;
    if (pct === null) throw new CommissionInvoiceError('VAT_RATE_MISSING', `Sazba ${COMMISSION_VAT_RATE_CODE} k ${taxable} neplatí.`);
    ratePct = Number(pct);
    ({ baseMinor, vatMinor } = splitGrossMinor(row.platform_fees, ratePct));
  }
  const year = Number(row.today.slice(0, 4));
  const n = (await q.query<{ n: number }>(`SELECT orders.next_document_number($1, $2, 'commission') AS n`, [row.promoter_id, year])).rows[0].n;
  const number = `TX${year}-${row.promoter_id.slice(0, 8).toUpperCase()}-${String(n).padStart(4, '0')}`;
  const customer: TaxDocParty = {
    name: row.name, ico: row.company_ico, dic: row.vat_payer ? row.company_dic : null,
    address: parseAddress(row.company_address), email: row.contact_email,
  };
  const ins = await q.query<{ id: string }>(
    `INSERT INTO platform.commission_invoices
       (payout_id, promoter_id, invoice_number, series_year, issue_date, taxable_supply_date, due_date, currency,
        vat_rate_code, rate_pct, base_minor, vat_minor, total_minor, supplier, customer)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $5::date, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)
     RETURNING id`,
    [
      payoutId, row.promoter_id, number, year, row.today, taxable, row.currency,
      supplier.vatPayer ? COMMISSION_VAT_RATE_CODE : null, ratePct, baseMinor, vatMinor, row.platform_fees,
      JSON.stringify(supplier), JSON.stringify(customer),
    ],
  );
  return { invoiceId: ins.rows[0].id, created: true };
}

/** Faktura provize v jednotném modelu (PDF + ISDOC). Provize je stržená z výplaty → uhrazeno. */
export async function loadCommissionTaxDocument(q: Q, id: string): Promise<TaxDocument | null> {
  const r = await q.query<{
    id: string; invoice_number: string; issue_date: string; taxable_supply_date: string; due_date: string; currency: string;
    vat_rate_code: string | null; rate_pct: string | null; base_minor: string; vat_minor: string; total_minor: string;
    supplier: TaxDocParty & { vatPayer: boolean }; customer: TaxDocParty; period_from: string; period_to: string;
  }>(
    `SELECT ci.id, ci.invoice_number, ci.issue_date::text, ci.taxable_supply_date::text, ci.due_date::text, ci.currency,
            ci.vat_rate_code, ci.rate_pct::text, ci.base_minor::text, ci.vat_minor::text, ci.total_minor::text,
            ci.supplier, ci.customer,
            (po.period_from AT TIME ZONE 'Europe/Prague')::date::text AS period_from,
            (po.period_to AT TIME ZONE 'Europe/Prague')::date::text AS period_to
       FROM platform.commission_invoices ci JOIN platform.payouts po ON po.id = ci.payout_id
      WHERE ci.id = $1`,
    [id],
  );
  const d = r.rows[0];
  if (!d) return null;
  const total = Number(d.total_minor);
  const ratePct = d.rate_pct === null ? null : Number(d.rate_pct);
  return {
    id: d.id, docType: 'invoice', number: d.invoice_number, issueDate: d.issue_date, taxableSupplyDate: d.taxable_supply_date,
    dueDate: d.due_date, currency: d.currency.trim(), supplier: d.supplier, customer: d.customer,
    items: [{
      description: `Provize za prodej vstupenek ${d.period_from} – ${d.period_to}`, quantity: 1, totalMinor: total,
      vatRateCode: d.vat_rate_code, ratePct,
    }],
    vatLines: d.supplier.vatPayer && d.vat_rate_code && ratePct !== null
      ? [{ vatRateCode: d.vat_rate_code, ratePct, baseMinor: Number(d.base_minor), vatMinor: Number(d.vat_minor), totalMinor: total }]
      : [],
    totalMinor: total, correctedDocument: null, paid: true,
  };
}

/**
 * Připravenost akce z pohledu DPH (kolo 7, C-54): plátce DPH musí mít platné DIČ a každý PLACENÝ
 * typ vstupenky musí mít kód sazby s platným procentem. Jinak akci nelze publikovat ani prodávat.
 * Kontrola běží v DB (catalog.event_vat_readiness, migrace 494) — nezávisle na RLS kontextu volajícího.
 */
import { NextResponse } from 'next/server';

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export type VatProblemCode = 'VAT_DIC_MISSING' | 'VAT_RATE_MISSING' | 'VAT_RATE_NOT_VALID';

export interface VatProblem {
  problem: VatProblemCode;
  ticketTypeId: string | null;
  ticketTypeName: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function vatReadinessProblems(q: Queryable, eventId: string): Promise<VatProblem[]> {
  if (!UUID_RE.test(eventId)) return [];
  const r = await q.query(`SELECT problem, ticket_type_id, ticket_type_name FROM catalog.event_vat_readiness($1)`, [eventId]);
  return (r.rows as { problem: VatProblemCode; ticket_type_id: string | null; ticket_type_name: string | null }[]).map((x) => ({
    problem: x.problem,
    ticketTypeId: x.ticket_type_id,
    ticketTypeName: x.ticket_type_name,
  }));
}

/** Srozumitelná česká zpráva pro pořadatele i kupce. */
export function describeVatProblems(problems: VatProblem[]): string {
  const parts: string[] = [];
  if (problems.some((p) => p.problem === 'VAT_DIC_MISSING')) {
    parts.push('pořadatel je plátce DPH, ale v profilu nemá platné DIČ');
  }
  const missing = problems.filter((p) => p.problem === 'VAT_RATE_MISSING').map((p) => p.ticketTypeName ?? '?');
  if (missing.length) parts.push(`placené typy vstupenek bez sazby DPH: ${missing.join(', ')}`);
  const invalid = problems.filter((p) => p.problem === 'VAT_RATE_NOT_VALID').map((p) => p.ticketTypeName ?? '?');
  if (invalid.length) parts.push(`sazba DPH k datu akce neplatí: ${invalid.join(', ')}`);
  return parts.join('; ');
}

/**
 * 422 VAT_NOT_CONFIGURED, když akce nemá DPH připravené; jinak null.
 * `action` určuje text („publikovat" / „prodávat").
 */
export async function vatNotReadyResponse(
  q: Queryable,
  eventId: string,
  action: 'publish' | 'sell',
): Promise<NextResponse | null> {
  const problems = await vatReadinessProblems(q, eventId);
  if (problems.length === 0) return null;
  const verb = action === 'publish' ? 'publikovat' : 'prodávat';
  return NextResponse.json(
    {
      error: 'VAT_NOT_CONFIGURED',
      message: `Akci zatím nelze ${verb}: ${describeVatProblems(problems)}.`,
      problems,
    },
    { status: 422 },
  );
}

/**
 * Validace sazby při uložení typu vstupenky (kolo 7): plátce u placeného typu sazbu povinně vyplní
 * a musí existovat; neplátce ji nevyplňuje (uloží se NULL). Vrací { code } k uložení, nebo { error }.
 */
export async function resolveTicketTypeVatCode(
  q: Queryable,
  promoterId: string,
  priceHalire: number,
  vatRateCode: string | null | undefined,
): Promise<{ code: string | null } | { error: string }> {
  const p = await q.query(`SELECT vat_payer FROM platform.promoters WHERE id = $1`, [promoterId]);
  const vatPayer = (p.rows[0] as { vat_payer: boolean } | undefined)?.vat_payer ?? true;
  if (!vatPayer) return { code: null };
  if (!vatRateCode) {
    return priceHalire > 0
      ? { error: 'Placený typ vstupenky plátce DPH musí mít sazbu DPH (vatRateCode).' }
      : { code: null };
  }
  const c = await q.query(`SELECT 1 FROM platform.vat_rate_codes WHERE code = $1`, [vatRateCode]);
  if (c.rows.length === 0) return { error: `Neznámý kód sazby DPH: ${vatRateCode}.` };
  return { code: vatRateCode };
}

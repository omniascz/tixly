/**
 * ForgeMsg provisioning — ensure a promoter has its own ForgeMsg org + API key.
 *
 * Calls ForgeMsg's partner-provision endpoint (with the platform partner secret)
 * and upserts the returned key into public.forgemsg_credentials, so the outbox
 * dispatcher routes that promoter's events to its own isolated org.
 *
 * Idempotent: ForgeMsg finds-or-creates the org by externalId (the promoter id);
 * Tixly skips promoters that already have credentials.
 */
import { db } from '@/lib/db/rls-pool';

export interface ProvisionOutcome {
  promoterId: string;
  status: 'provisioned' | 'skipped' | 'failed';
  error?: string;
}

/** Provision one promoter (no-op if it already has credentials). */
export async function provisionPromoter(
  promoterId: string,
  opts: { force?: boolean } = {},
): Promise<ProvisionOutcome> {
  const apiUrl = process.env.FORGEMSG_API_URL ?? '';
  const partnerSecret = process.env.FORGEMSG_PARTNER_SECRET ?? '';
  if (!apiUrl || !partnerSecret) {
    return { promoterId, status: 'failed', error: 'FORGEMSG_API_URL / FORGEMSG_PARTNER_SECRET not set' };
  }

  if (!opts.force) {
    const existing = await db().query(
      `SELECT 1 FROM public.forgemsg_credentials WHERE promoter_id = $1 AND enabled = true`,
      [promoterId],
    );
    if (existing.rows.length > 0) return { promoterId, status: 'skipped' };
  }

  const p = await db().query<{ name: string; country: string | null }>(
    `SELECT name, country FROM platform.promoters WHERE id = $1`,
    [promoterId],
  );
  const promoter = p.rows[0];
  if (!promoter) return { promoterId, status: 'failed', error: 'promoter not found' };

  // Tixly country is CZ/SR; ForgeMsg expects ISO (SR → SK).
  const country = promoter.country === 'SR' ? 'SK' : promoter.country ?? undefined;

  try {
    const res = await fetch(`${apiUrl}/api/v1/partner/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-partner-secret': partnerSecret },
      body: JSON.stringify({ externalId: promoterId, name: promoter.name, country }),
    });
    if (!res.ok) {
      return { promoterId, status: 'failed', error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as { data?: { apiKey?: string } };
    const apiKey = json.data?.apiKey;
    if (!apiKey) return { promoterId, status: 'failed', error: 'no apiKey in response' };

    await db().query(
      `INSERT INTO public.forgemsg_credentials (promoter_id, api_key, api_url, enabled, updated_at)
       VALUES ($1, $2, $3, true, now())
       ON CONFLICT (promoter_id)
       DO UPDATE SET api_key = EXCLUDED.api_key, api_url = EXCLUDED.api_url,
                     enabled = true, updated_at = now()`,
      [promoterId, apiKey, apiUrl],
    );
    return { promoterId, status: 'provisioned' };
  } catch (e) {
    return { promoterId, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Provision all active promoters that don't yet have ForgeMsg credentials. */
export async function provisionMissingPromoters(limit = 100): Promise<{
  picked: number;
  provisioned: number;
  failed: number;
  results: ProvisionOutcome[];
}> {
  const due = await db().query<{ id: string }>(
    `SELECT p.id
       FROM platform.promoters p
       LEFT JOIN public.forgemsg_credentials c ON c.promoter_id = p.id AND c.enabled = true
      WHERE c.promoter_id IS NULL
        AND p.status = 'active'
      LIMIT $1`,
    [limit],
  );

  const results: ProvisionOutcome[] = [];
  for (const row of due.rows) results.push(await provisionPromoter(row.id));

  return {
    picked: due.rows.length,
    provisioned: results.filter((r) => r.status === 'provisioned').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}

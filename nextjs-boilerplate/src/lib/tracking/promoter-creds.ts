/**
 * Per-promoter marketing tracking creds.
 *
 * Pixel/measurement ID jsou veřejné; CAPI token a GA4 api_secret jsou uložené
 * šifrovaně (sloupce *_enc) — tady je dešifrujeme přes src/lib/crypto.
 *
 * Pozor: volat jen v server kontextu, kde db() vidí platform.promoters
 * (service kontext nebo promotér nad vlastním řádkem). Dešifrování je
 * best-effort — když selže (špatný klíč / poškozený ciphertext), vrátíme null
 * a tracking se prostě neodpálí, nikdy nepadáme.
 */

import { decryptSecret } from '@/lib/crypto';
import { db } from '@/lib/db/rls-pool';

export interface PromoterTrackingCreds {
  metaPixelId: string | null;
  metaCapiToken: string | null;
  ga4MeasurementId: string | null;
  ga4ApiSecret: string | null;
}

const EMPTY: PromoterTrackingCreds = {
  metaPixelId: null,
  metaCapiToken: null,
  ga4MeasurementId: null,
  ga4ApiSecret: null,
};

function safeDecrypt(enc: string | null): string | null {
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

/** Tracking creds promotéra, který vlastní danou akci. */
export async function getPromoterTrackingByEvent(
  eventId: string,
): Promise<PromoterTrackingCreds> {
  const r = await db().query<{
    meta_pixel_id: string | null;
    meta_capi_token_enc: string | null;
    ga4_measurement_id: string | null;
    ga4_api_secret_enc: string | null;
  }>(
    `SELECT p.meta_pixel_id, p.meta_capi_token_enc,
            p.ga4_measurement_id, p.ga4_api_secret_enc
       FROM catalog.events e
       JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.id = $1`,
    [eventId],
  );
  if (r.rows.length === 0) return EMPTY;
  const row = r.rows[0];
  return {
    metaPixelId: row.meta_pixel_id,
    metaCapiToken: safeDecrypt(row.meta_capi_token_enc),
    ga4MeasurementId: row.ga4_measurement_id,
    ga4ApiSecret: safeDecrypt(row.ga4_api_secret_enc),
  };
}

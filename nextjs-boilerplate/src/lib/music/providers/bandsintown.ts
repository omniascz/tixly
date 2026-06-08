/**
 * Bandsintown — distribuce koncertu na profil umělce.
 *
 * Bandsintown je hlavní agregátor koncertů; Spotify i Apple Music z něj čtou
 * sekci „On Tour". Po vytvoření události na umělci se koncert objeví na jeho
 * Bandsintown/Spotify/Apple profilu s tlačítkem „Tickets" → Tixly checkout.
 *
 * Zápis událostí jde přes Bandsintown for Artists / Partner API a vyžaduje
 * partner credentials (app_id + partner token) — to je obchodní přístup, ne jen
 * běžný app_id (ten je read-only). Bez klíčů → skip. Endpoint/base je konfigurovatelný
 * přes env, protože přesný partner endpoint je nutné potvrdit v Bandsintown partner docs.
 *
 * Env:
 *   BANDSINTOWN_APP_ID        — partner app id
 *   BANDSINTOWN_PARTNER_TOKEN — write/partner token (bez něj je API read-only)
 *   BANDSINTOWN_API_BASE      — default https://rest.bandsintown.com
 */
import type { MusicEventPayload, ProviderResult } from './types';

export async function postBandsintownEvent(p: MusicEventPayload): Promise<ProviderResult> {
  const appId = process.env.BANDSINTOWN_APP_ID;
  const partnerToken = process.env.BANDSINTOWN_PARTNER_TOKEN;
  if (!appId || !partnerToken) {
    return { externalId: null, skipReason: 'BANDSINTOWN_KEYS_MISSING' };
  }
  const base = process.env.BANDSINTOWN_API_BASE ?? 'https://rest.bandsintown.com';
  const artist = encodeURIComponent(p.external_artist_id || p.artist_name || '');
  if (!artist) return { externalId: null, skipReason: 'NO_ARTIST_REF' };

  const body = {
    datetime: new Date(p.date_start).toISOString(),
    title: p.event_title,
    description: p.description ?? undefined,
    venue: {
      name: p.venue_name ?? undefined,
      latitude: p.lat ?? undefined,
      longitude: p.lng ?? undefined,
      city: p.city ?? undefined,
      country: p.country ?? undefined,
      // Bandsintown bere buď lat/lng, nebo city+country pro geokódování.
    },
    // „offers" = prodejní kanály; type Tickets + URL na Tixly checkout.
    offers: p.ticket_url ? [{ type: 'Tickets', url: p.ticket_url, status: 'available' }] : [],
    lineup: p.artist_name ? [p.artist_name] : [],
  };

  const res = await fetch(
    `${base}/artists/${artist}/events?app_id=${encodeURIComponent(appId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${partnerToken}` },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`Bandsintown HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const j = (await res.json().catch(() => ({}))) as { id?: string | number; event_id?: string | number };
  const id = j.id ?? j.event_id;
  return { externalId: id != null ? String(id) : `bit-${p.external_artist_id}` };
}

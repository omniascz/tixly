/**
 * Songkick — distribuce koncertu (druhý hlavní agregátor, který Spotify/Apple čtou).
 *
 * Songkick má read API přes apikey, ale ZÁPIS událostí (submission) je partner-gated
 * a vyžaduje schválený partnerský přístup (Songkick Partner / Metropolis API). Bez
 * klíče → skip. Base/endpoint konfigurovatelný přes env (potvrdit v Songkick partner docs).
 *
 * Env:
 *   SONGKICK_API_KEY    — partner apikey s write rozsahem
 *   SONGKICK_API_BASE   — default https://api.songkick.com/api/3.0
 */
import type { MusicEventPayload, ProviderResult } from './types';

export async function postSongkickEvent(p: MusicEventPayload): Promise<ProviderResult> {
  const apiKey = process.env.SONGKICK_API_KEY;
  if (!apiKey) return { externalId: null, skipReason: 'SONGKICK_KEY_MISSING' };
  const base = process.env.SONGKICK_API_BASE ?? 'https://api.songkick.com/api/3.0';

  const body = {
    event: {
      displayName: p.event_title,
      type: 'Concert',
      start: { date: p.date_start.slice(0, 10), datetime: new Date(p.date_start).toISOString() },
      performance: [
        { artist: { identifier: p.external_artist_id, displayName: p.artist_name ?? undefined }, billing: 'headline' },
      ],
      venue: {
        displayName: p.venue_name ?? undefined,
        city: p.city ?? undefined,
        lat: p.lat ?? undefined,
        lng: p.lng ?? undefined,
      },
      ticketUrl: p.ticket_url ?? undefined,
      description: p.description ?? undefined,
    },
  };

  const res = await fetch(`${base}/events.json?apikey=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Songkick HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const j = (await res.json().catch(() => ({}))) as {
    resultsPage?: { results?: { event?: { id?: string | number } } };
  };
  const id = j.resultsPage?.results?.event?.id;
  return { externalId: id != null ? String(id) : `skk-${p.external_artist_id}` };
}

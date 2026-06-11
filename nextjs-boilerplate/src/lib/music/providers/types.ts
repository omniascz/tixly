/**
 * Sdílené typy pro hudební distribuční providery (Bandsintown, Songkick).
 *
 * Model: Tixly NEPOSTuje přímo na Spotify/Apple Music — ty čtou koncerty
 * z agregátorů (Bandsintown, Songkick). Postujeme tedy na agregátory a Spotify/
 * Apple se objeví automaticky. "Tickets" odkaz vede zpět na Tixly checkout.
 */

export interface MusicEventPayload {
  external_artist_id: string; // bandsintown/songkick artist id (nebo jméno jako fallback)
  artist_name?: string | null;
  event_title: string;
  date_start: string; // ISO datetime
  venue_name?: string | null;
  venue_address?: string | null;
  city?: string | null;
  country?: string | null; // ISO-2
  lat?: number | null;
  lng?: number | null;
  ticket_url?: string | null; // zpětný odkaz na Tixly checkout
  description?: string | null;
}

export interface ProviderResult {
  /** id vytvořené události u providera; null = nepostováno (viz skipReason). */
  externalId: string | null;
  /** důvod přeskočení (chybí klíč / platforma se neposílá přímo). */
  skipReason?: string;
}

/**
 * Vlakový bundle — „přijeď vlakem" k lístku (na klíč pro ČD / Regiojet API).
 *
 * Fail-closed: bez RAIL_API_URL + RAIL_API_KEY vrací `null` config a endpoint
 * vrací 503. Po napojení reálného dopravce (ČD, Regiojet) se aktivuje bez zásahu.
 */

export interface RailConfig {
  apiUrl: string;
  apiKey: string;
}

export function railConfig(): RailConfig | null {
  const apiUrl = process.env.RAIL_API_URL;
  const apiKey = process.env.RAIL_API_KEY;
  if (!apiUrl || !apiKey) return null;
  return { apiUrl, apiKey };
}

export interface RailQuery {
  fromCity: string;
  toCity: string;
  arriveByIso: string;
}

export interface RailOption {
  departIso: string;
  arriveIso: string;
  priceMinor: number;
  currency: string;
  carrier: string;
  co2Grams: number;
  deepLink: string;
}

/** Vyhledá vlakové spoje u nakonfigurovaného dopravce. Bez configu sem endpoint nedojde. */
export async function searchRail(cfg: RailConfig, q: RailQuery): Promise<RailOption[]> {
  const res = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ from: q.fromCity, to: q.toCity, arrive_by: q.arriveByIso }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { options?: RailOption[] };
  return Array.isArray(data.options) ? data.options : [];
}

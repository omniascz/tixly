// =============================================================================
// Geo-blocking utility
// Poskytovatel GeoIP je pluggable — ve výrobě použít MaxMind GeoIP2 nebo
// Cloudflare Workers (cf-ipcountry header).
// =============================================================================

export type GeoBlockMode = "allow_all" | "allowlist" | "blocklist";

export interface GeoBlockConfig {
  mode: GeoBlockMode;
  countries: string[]; // ISO 3166-1 alpha-2
}

export interface GeoProvider {
  /** Vrátí ISO 3166-1 alpha-2 kód země pro danou IP, nebo null pokud neznámo. */
  lookup(ip: string): Promise<string | null>;
}

/**
 * Rozhodne, zda je přístup z dané země povolený.
 *
 * allow_all  → vždy true
 * allowlist  → true jen pokud je země v seznamu
 * blocklist  → true jen pokud země NENÍ v seznamu
 * unknown IP → allow_all: true, ostatní: false (fail closed)
 */
export function isGeoAllowed(
  countryCode: string | null,
  config: GeoBlockConfig
): boolean {
  if (config.mode === "allow_all") return true;

  if (countryCode === null) {
    // Neznámá IP — fail closed pro allowlist/blocklist
    return false;
  }

  const upper = countryCode.toUpperCase();

  if (config.mode === "allowlist") {
    return config.countries.map((c) => c.toUpperCase()).includes(upper);
  }

  // blocklist
  return !config.countries.map((c) => c.toUpperCase()).includes(upper);
}

/**
 * Extrahuje klientskou IP z Next.js Request.
 * Respektuje Cloudflare CF-Connecting-IP a standardní X-Forwarded-For.
 */
export function extractClientIp(headers: Headers): string | null {
  // Cloudflare
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  // Standardní reverse-proxy header (první IP v řetězci = klient)
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }

  // Přímé připojení (lokální dev)
  const real = headers.get("x-real-ip");
  if (real) return real.trim();

  return null;
}

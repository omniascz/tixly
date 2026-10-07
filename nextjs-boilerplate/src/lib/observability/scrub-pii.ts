/**
 * Kolo 14 / krok 3 — maskování osobních údajů kupců před odesláním do Sentry (server, edge i prohlížeč).
 *
 *   - v textu (zpráva chyby, stack, URL, breadcrumbs …): e-maily → [email] (i URL-kódované), telefony → [telefon];
 *   - hodnoty pod klíči jako jméno / e-mail / telefon / držitel / adresa / IP → [skryto];
 *   - z event.user zůstane jen id (sendDefaultPii je navíc vypnuté).
 * UUID, částky, čísla faktur a kódy se nemaskují (jen 9místná telefonní čísla, volitelně s předvolbou).
 */

const EMAIL_RE = /[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)+/gi;
const PHONE_RE = /(?:\+|00)\d{3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b|(?<![\w-])\d{3}[\s-]?\d{3}[\s-]?\d{3}(?![\w-])/g;
const SENSITIVE_KEY = /name|e-?mail|phone|telefon|holder|address|adresa|ip_?address|jmeno|jméno/i;
const MAX_DEPTH = 12;

export function scrubText(s: string): string {
  return s.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[telefon]');
}

function scrubValue(v: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return v;
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && (typeof val === 'string' || typeof val === 'number') ? '[skryto]' : scrubValue(val, depth + 1);
    }
    return out;
  }
  return v;
}

/** Vrátí kopii události Sentry bez osobních údajů kupců (použití v beforeSend). */
export function scrubSentryEvent<T extends Record<string, unknown>>(event: T): T {
  const { user, tags, ...rest } = event as Record<string, unknown>;
  const out = scrubValue(rest, 0) as Record<string, unknown>;
  if (user && typeof user === 'object') {
    const id = (user as { id?: unknown }).id;
    out.user = id !== undefined ? { id } : undefined;
    if (out.user === undefined) delete out.user;
  }
  if (tags !== undefined) out.tags = tags; // tagy nastavuje aplikace (runbook, cron), ne vstup kupce
  return out as T;
}

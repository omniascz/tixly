/**
 * Kolo 14 / krok 3 — maskování osobních údajů kupců před odesláním do Sentry (server, edge i prohlížeč).
 *
 *   - v textu (zpráva chyby, stack, URL, breadcrumbs …): e-maily → [email] (i URL-kódované), telefony → [telefon];
 *   - hodnoty pod klíči jako jméno / e-mail / telefon / držitel / adresa / IP → [skryto];
 *   - z event.user zůstane jen id (sendDefaultPii je navíc vypnuté).
 * UUID, částky, čísla faktur a kódy se nemaskují (jen 9místná telefonní čísla, volitelně s předvolbou).
 * Kolo 19 (Sentry 11): telefony i URL-kódované (%2B420%20777…, mezera jako +); spany (span streaming) beforeSend
 * obcházejí → scrubSentrySpan v beforeSendSpan; SENTRY_DATA_COLLECTION = restriktivní sběr dat (dataCollection).
 */

const EMAIL_RE = /[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)+/gi;
const PHONE_RE =
  /(?:\+|%2B|00)\d{3}(?:[\s-]|%20|\+)?\d{3}(?:[\s-]|%20|\+)?\d{3}(?:[\s-]|%20|\+)?\d{3}\b|(?<![\w-])\d{3}(?:[\s-]|%20|\+)?\d{3}(?:[\s-]|%20|\+)?\d{3}(?![\w-])/gi;
const SENSITIVE_KEY = /name|e-?mail|phone|telefon|holder|address|adresa|ip_?address|jmeno|jméno/i;
const MAX_DEPTH = 12;

/**
 * Kolo 21: názvy parametrů dotazu, které nesou tajemství nebo jednorázový token (soupis logs/r21/1_url_secrets.md) —
 * reset hesla, rezervace míst, pozvánky, odhlášení, OAuth … Hodnota se v každém textu nahradí [skryto] (název bez ohledu
 * na velikost písmen, i URL-kódovaný dotaz vnořené URL); ostatní parametry zůstanou.
 */
export const URL_SECRET_PARAMS = [
  'token', 'code', 'key', 'secret', 'signature', 'sig', 'hash', 'otp', 'password',
  'access_token', 'refresh_token', 'sessionId', 'session_id',
  // z tabulky A soupisu: OAuth state, checkout (fronta, držení míst, loterie, skupinová pozvánka), čekací listina,
  // potvrzení objednávky, návratové adresy (vnořená cesta s tokenem), odchozí volání (klíče třetích stran)
  'state', 'queueToken', 'seatHoldToken', 'lotteryToken', 'lotteryEntryId', 'groupInvitation', 'waitlistId', 'orderId',
  'next', 'redirect', 'client_secret', 'api_secret', 'apikey', 'app_id',
];
const URL_SECRET_RE = new RegExp(
  `(^|[?&#;]|%3F|%26|%23)(${URL_SECRET_PARAMS.join('|')})(=|%3D)((?:(?!%26|%23)[^&#;\\s"'<>])*)`,
  'gi',
);
const URL_SECRET_NAME = new RegExp(`^(?:${URL_SECRET_PARAMS.join('|')})$`, 'i');
// hlavička Referer (událost: request.headers.Referer / referer; span: http.request.header.referer)
const REFERER_KEY = /(?:^|[._-])referr?er$/i;

export function scrubText(s: string): string {
  return s.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[telefon]').replace(URL_SECRET_RE, '$1$2$3[skryto]');
}

/** Kolo 21: z URL v hlavičce Referer zůstane schéma, hostitel a cesta — dotaz a fragment se odstraní. */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
const scrubReferer = (v: unknown): unknown =>
  typeof v === 'string' ? scrubText(stripUrlQuery(v)) : Array.isArray(v) ? (v as unknown[]).map((x) => (typeof x === 'string' ? scrubText(stripUrlQuery(x)) : x)) : v;

function scrubValue(v: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return v;
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) {
    // query_string jako dvojice [název, hodnota]
    if (v.length === 2 && typeof v[0] === 'string' && URL_SECRET_NAME.test(v[0]) && typeof v[1] === 'string') return [v[0], '[skryto]'];
    return v.map((x) => scrubValue(x, depth + 1));
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && (typeof val === 'string' || typeof val === 'number') ? '[skryto]'
        : REFERER_KEY.test(k) ? scrubReferer(val)
          : scrubValue(val, depth + 1);
    }
    return out;
  }
  return v;
}

/** Vrátí kopii události Sentry bez osobních údajů kupců (použití v beforeSend). */
export function scrubSentryEvent<T extends object>(event: T): T {
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

/**
 * Kolo 19: restriktivní sběr dat pro Sentry 11 (`dataCollection` nahradil `sendDefaultPii`, výchozí hodnoty v 11 sbírají
 * víc). Podle MIGRATION.md „If you want to keep the v10 default behavior" + hlavičky s identitou a tajemstvím.
 */
const DENY_V10 = ['forwarded', '-ip', 'remote-', 'via', '-user'];
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: [...DENY_V10, 'authorization', 'cookie', 'x-internal-token', 'x-user-id'] },
    response: { deny: [...DENY_V10, 'set-cookie'] },
  },
  httpBodies: [],
  // Kolo 21: + názvy s tajemstvím v URL (SDK páruje podřetězec bez ohledu na velikost písmen, logs/r21/2_sdk_deny.md)
  urlQueryParams: { deny: [...DENY_V10, ...URL_SECRET_PARAMS] },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
};

// atributy spanu: hlavičky s identitou / tajemstvím / IP, adresa klienta, uživatel kromě id
const SPAN_DROP_ATTR =
  /(?:^|[._])(?:authorization|cookie|set[-_]cookie|x[-_]internal[-_]token|x[-_]user[-_]id|x[-_]real[-_]ip|x[-_]forwarded[-_]for|forwarded)$|^client\.address$|ip_address|^user\.(?!id$)/i;

/** Vrátí span (Sentry 11, StreamedSpanJSON) bez osobních údajů kupců (použití v beforeSendSpan). */
export function scrubSentrySpan<T extends { name?: string; attributes?: object }>(span: T): T {
  if (typeof span.name === 'string') span.name = scrubText(span.name);
  const attrs = span.attributes as Record<string, unknown> | undefined;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (SPAN_DROP_ATTR.test(k)) delete attrs[k];
      else if (REFERER_KEY.test(k)) attrs[k] = scrubReferer(v);
      else if (typeof v === 'string') attrs[k] = scrubText(v);
      else if (Array.isArray(v)) attrs[k] = (v as unknown[]).map((x) => (typeof x === 'string' ? scrubText(x) : x));
    }
  }
  return span;
}

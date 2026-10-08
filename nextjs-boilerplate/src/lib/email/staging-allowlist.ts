/**
 * Kolo 10 / krok 4 — e-maily na stagingu jdou přes Resend (skuteční příjemci), proto povinný allowlist.
 *
 * TIXLY_ENV=staging → e-mail odejde jen na adresy ze STAGING_EMAIL_ALLOWLIST (čárkou oddělené):
 *   - celá adresa:   tester@firma.cz      (pasuje i tester+cokoli@firma.cz — plus-adresování jedné schránky)
 *   - celá doména:   @firma.cz
 * Adresa mimo allowlist se NEODEŠLE a zaloguje se (maskovaně). Prázdný allowlist = staging nenastartuje
 * (src/lib/env/staging-guard.ts). Mimo staging se nic nefiltruje.
 */

export interface Allowlist {
  entries: string[];
  invalid: string[];
}

const ADDRESS_RE = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
const DOMAIN_RE = /^@[^\s@<>,]+\.[^\s@<>,]+$/;

export function parseAllowlist(raw: string | undefined): Allowlist {
  const entries: string[] = [];
  const invalid: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const e = part.trim().toLowerCase();
    if (!e) continue;
    if (ADDRESS_RE.test(e) || DOMAIN_RE.test(e)) entries.push(stripTag(e));
    else invalid.push(part.trim());
  }
  return { entries, invalid };
}

function stripTag(addr: string): string {
  const at = addr.lastIndexOf('@');
  if (at <= 0) return addr;
  const local = addr.slice(0, at);
  const plus = local.indexOf('+');
  return (plus > 0 ? local.slice(0, plus) : local) + addr.slice(at);
}

/** Adresa z tvaru `Jméno <a@b.cz>` nebo `a@b.cz`, malými písmeny. */
export function bareAddress(value: string): string {
  const m = /<([^>]+)>/.exec(value);
  return (m ? m[1] : value).trim().toLowerCase();
}

export function isAllowed(address: string, list: Allowlist): boolean {
  const a = stripTag(bareAddress(address));
  const domain = a.slice(a.lastIndexOf('@'));
  return list.entries.some((e) => (e.startsWith('@') ? e === domain : e === a));
}

/** `j***@firma.cz` — do logu bez celé adresy. */
export function maskAddress(address: string): string {
  const a = bareAddress(address);
  const at = a.lastIndexOf('@');
  return at > 0 ? `${a[0]}***${a.slice(at)}` : '***';
}

export function stagingEmailFilterActive(env: Record<string, string | undefined> = process.env): boolean {
  return (env.TIXLY_ENV ?? '').toLowerCase() === 'staging';
}

// Tvar adresy v nodemaileru. Vstup: od nodemaileru 10 jsou v typech name i address nepovinné; flatten() propustí jen
// objekty s address (řetězec), výstup ho má proto povinný.
type AddressLike = string | { name?: string; address: string };
type AddressInput = string | { name?: string; address?: string } | AddressInput[];
export type RecipientField = AddressInput | undefined | null;

function flatten(field: RecipientField): AddressLike[] {
  if (!field) return [];
  const items = Array.isArray(field) ? field : [field];
  const out: AddressLike[] = [];
  for (const it of items) {
    if (Array.isArray(it)) { out.push(...flatten(it)); continue; } // vnořená pole (typ nodemaileru 10)
    if (typeof it === 'string') {
      // „a@b.cz, Jméno <c@d.cz>" — čárka uvnitř jména v uvozovkách se tu nevyskytuje (adresy skládá kód)
      for (const s of it.split(',')) if (s.trim()) out.push(s.trim());
    } else if (it && typeof it.address === 'string') out.push({ ...it, address: it.address });
  }
  return out;
}

const addrOf = (a: AddressLike): string => (typeof a === 'string' ? a : a.address);

/**
 * Rozdělí příjemce (to/cc/bcc ve tvaru nodemaileru) na povolené a zablokované.
 * Povolené pole vrací ve stejném tvaru (prázdné → undefined).
 */
export function filterRecipients(
  fields: { to?: RecipientField; cc?: RecipientField; bcc?: RecipientField },
  list: Allowlist,
): { to?: AddressLike[]; cc?: AddressLike[]; bcc?: AddressLike[]; allowedCount: number; blocked: string[] } {
  const blocked: string[] = [];
  let allowedCount = 0;
  const pick = (f: RecipientField): AddressLike[] | undefined => {
    const keep = flatten(f).filter((a) => {
      if (isAllowed(addrOf(a), list)) return true;
      blocked.push(addrOf(a));
      return false;
    });
    allowedCount += keep.length;
    return keep.length ? keep : undefined;
  };
  return { to: pick(fields.to), cc: pick(fields.cc), bcc: pick(fields.bcc), allowedCount, blocked };
}

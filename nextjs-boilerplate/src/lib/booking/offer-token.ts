/**
 * Odkaz pro agenta — jednorázový token bez zakládání účtu.
 *
 * Agent nemá důvod si u nás zakládat účet kvůli jedné nabídce. Oprávnění proto
 * nese token v odkazu. Aby to bylo bezpečné, platí tři pravidla:
 *
 *   • V databázi je jen **otisk** tokenu. Kdo získá přístup k databázi,
 *     odkazy tím nezneužije.
 *   • Token má **platnost**. Po ní odkaz nic neukáže, i kdyby se dostal ven.
 *   • Porovnání otisků je **časově nezávislé** — jinak by šlo token uhodnout
 *     po znacích měřením doby odpovědi.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Délka tokenu v bajtech. 32 B = 256 bitů entropie, v odkazu 43 znaků. */
const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Token do odkazu — ukládá se jen sem, do databáze nikdy. */
  token: string;
  hash: string;
  expiresAt: Date;
}

export function hashOfferToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Vytvoří token s danou platností ve dnech. */
export function issueOfferToken(validDays: number, now: Date): IssuedToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);
  return { token, hash: hashOfferToken(token), expiresAt };
}

/** Časově nezávislé porovnání otisků. */
export function offerTokenMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashOfferToken(token), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type OfferAccess =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'expired' | 'closed' };

/**
 * Smí agent nabídku otevřít? Uzavřená nabídka (přijatá, odmítnutá, stažená)
 * se dál needituje, ale zůstává čitelná — agent má právo vidět, co podepsal.
 */
export function checkOfferAccess(args: {
  matches: boolean;
  tokenExpiresAt: Date | null;
  status: string;
  now: Date;
}): OfferAccess {
  if (!args.matches) return { ok: false, reason: 'not_found' };
  if (args.tokenExpiresAt !== null && args.tokenExpiresAt.getTime() < args.now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  if (args.status === 'withdrawn' || args.status === 'superseded') {
    return { ok: false, reason: 'closed' };
  }
  return { ok: true };
}

/** Smí agent na nabídku ještě odpovědět? */
export function canRespond(status: string, validUntil: Date | null, now: Date): boolean {
  if (status !== 'sent' && status !== 'countered') return false;
  if (validUntil !== null && validUntil.getTime() < now.getTime()) return false;
  return true;
}

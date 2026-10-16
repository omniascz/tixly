import type { NextRequest } from 'next/server';
import { safeEqualStr } from './compare';

/**
 * Autorizace cron rout: VÝHRADNĚ tajemstvím `CRON_SECRET`
 * (`Authorization: Bearer <CRON_SECRET>` — tak volá Vercel cron — nebo `x-cron-secret`).
 *
 * Hlavička `x-vercel-cron` NENÍ důkaz čehokoli: pošle ji kdokoli. Middleware ji
 * z příchozích požadavků zahazuje; tady se na ni záměrně nehledí.
 * Bez nastaveného `CRON_SECRET` je odpověď vždy false (fail-closed).
 */
export function isCronAuthorized(req: NextRequest | Request): boolean {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret) return false;
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const header = req.headers.get('x-cron-secret') ?? '';
  return (bearer !== '' && safeEqualStr(bearer, secret)) || (header !== '' && safeEqualStr(header, secret));
}

/**
 * Interní volání (`x-internal-token` = INTERNAL_SERVICE_TOKEN) — fail-closed: bez nastaveného
 * tajemství v env je odpověď vždy false (kolo 3: dvě cron routy dřív při chybějícím env
 * pustily JAKÝKOLI token), porovnání v konstantním čase.
 */
export function isInternalTokenAuthorized(req: NextRequest | Request): boolean {
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected) return false;
  const token = req.headers.get('x-internal-token') ?? '';
  return token !== '' && safeEqualStr(token, expected);
}

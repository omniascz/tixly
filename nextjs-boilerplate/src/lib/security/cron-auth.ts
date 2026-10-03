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

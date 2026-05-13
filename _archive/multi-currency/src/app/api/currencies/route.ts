/**
 * GET /api/currencies — seznam aktivnich men
 * GET /api/currencies/rates?base=CZK&quote=EUR&date=2026-04-12 — kurz
 */

import { NextRequest, NextResponse } from 'next/server';
import type { DbAdapter } from '@tixly/db-adapter';
import { listCurrencies, getLatestRate, getRate } from '../../../services/currency.service.js';

// DI: injected from module bootstrap
let _db: DbAdapter;
export function injectDb(db: DbAdapter) { _db = db; }

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const base = searchParams.get('base');
  const quote = searchParams.get('quote');

  // Pokud je base+quote, vrat kurz
  if (base && quote) {
    const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    const source = searchParams.get('source') ?? undefined;

    try {
      const rate = await getRate({ db: _db }, base, quote, date, source);
      return NextResponse.json({ base, quote, rate: rate.toFixed(8), date });
    } catch {
      return NextResponse.json(
        { error: `Rate not found: ${base}/${quote} on ${date}` },
        { status: 404 },
      );
    }
  }

  // Jinak vrat seznam men
  const currencies = await listCurrencies({ db: _db });
  return NextResponse.json({ currencies });
}

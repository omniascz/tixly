/**
 * GET /api/currencies/convert?amount=15050&from=CZK&to=EUR&date=2026-04-12
 *
 * Konvertuje castku v subunitech z jedne meny do druhe.
 * amount je v subunitech zdrojove meny (halere pro CZK, centy pro EUR).
 */

import { NextRequest, NextResponse } from 'next/server';
import type { DbAdapter } from '@tixly/db-adapter';
import { convertCurrency } from '../../../../services/currency.service.js';

let _db: DbAdapter;
export function injectDb(db: DbAdapter) { _db = db; }

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const amountStr = searchParams.get('amount');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  if (!amountStr || !from || !to) {
    return NextResponse.json(
      { error: 'Missing required params: amount, from, to' },
      { status: 400 },
    );
  }

  const amount = Number(amountStr);
  if (!Number.isInteger(amount) || amount < 0) {
    return NextResponse.json(
      { error: 'amount must be a non-negative integer (subunits)' },
      { status: 400 },
    );
  }

  try {
    const result = await convertCurrency({ db: _db }, amount, from, to, date);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: `Conversion failed: ${from}→${to} on ${date}` },
      { status: 404 },
    );
  }
}

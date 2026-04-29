import { NextRequest, NextResponse } from 'next/server';
import { recoverCart } from '../../../../services/cart.service';
import { CartNotFoundError, CartTokenExpiredError, CartAlreadyConvertedError } from '../../../../types/cart.types';

const deps = { db: null as any, kafka: { send: async () => {} } };

// GET /api/cart/recover?token=xxx — ověří token a vrátí košík + checkoutUrl
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  try {
    const result = await recoverCart(deps, token);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof CartTokenExpiredError) {
      return NextResponse.json({ error: err.message }, { status: 410 });   // Gone
    }
    if (err instanceof CartAlreadyConvertedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof CartNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }
}

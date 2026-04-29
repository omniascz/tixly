import { NextRequest, NextResponse } from 'next/server';
import { saveCart, markConverted } from '../../../services/cart.service';
import { z } from 'zod';

const deps = { db: null as any, kafka: { send: async () => {} } };

const SaveCartSchema = z.object({
  eventId: z.string().min(1).max(100),
  items: z.array(z.object({
    ticketTypeId: z.string(),
    ticketTypeName: z.string(),
    quantity: z.number().int().min(1).max(10),
    unitPrice: z.number().int().min(0),
  })).min(1).max(20),
});

// POST /api/cart — uloží nebo aktualizuje košík
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SaveCartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const cart = await saveCart(deps, userId, parsed.data);
  return NextResponse.json(cart, { status: 201 });
}

// DELETE /api/cart?eventId=xxx — označí košík jako konvertovaný (po úspěšné platbě)
export async function DELETE(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const eventId = request.nextUrl.searchParams.get('eventId');
  if (!eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 });

  await markConverted(deps, userId, eventId);
  return new NextResponse(null, { status: 204 });
}

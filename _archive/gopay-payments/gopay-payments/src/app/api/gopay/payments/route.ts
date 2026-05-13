// =============================================================================
// POST /api/gopay/payments — vytvoří novou GoPay platbu
// =============================================================================

import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { createGopayPayment } from '../../../../services/gopay-payment.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import { GopayError, isGopayError } from '../../../../lib/gopay-errors.js';

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------
const GopayPaymentItemSchema = z.object({
  name: z.string().min(1).max(200, { message: 'Název položky může mít max. 200 znaků.' }),
  amount: z.number().int().positive({ message: 'Částka položky musí být kladné celé číslo (haléře).' }),
  count: z.number().int().min(1).max(999),
  vatRate: z.number().int().min(0).max(100).optional(),
});

const CreateGopayPaymentSchema = z.object({
  orderId: z.string().uuid({ message: 'orderId musí být platné UUID.' }),
  amountHalire: z.number().int().positive({ message: 'amountHalire musí být kladné celé číslo.' }).max(100_000_000, { message: 'Maximální částka je 1 000 000 Kč.' }),
  currency: z.enum(['CZK', 'EUR', 'USD'], { message: 'Nepodporovaná měna. Povoleno: CZK, EUR, USD.' }),
  buyerEmail: z.string().email({ message: 'buyerEmail musí být platná e-mailová adresa.' }).max(254),
  buyerName: z.string().min(1).max(200).optional(),
  returnUrl: z.string().url({ message: 'returnUrl musí být platná URL.' }).optional(),
  notifyUrl: z.string().url({ message: 'notifyUrl musí být platná URL.' }).optional(),
  items: z.array(GopayPaymentItemSchema).min(1, { message: 'Musí být alespoň jedna položka.' }).max(100),
  lang: z.enum(['CS', 'EN', 'SK']).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await request.json();
    const body = CreateGopayPaymentSchema.parse(raw);

    const deps = getServiceDeps();
    const payment = await createGopayPayment(body, deps);
    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Neplatná data požadavku.', details: err.errors },
        { status: 400 },
      );
    }
    if (isGopayError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    // eslint-disable-next-line no-console
    console.error('[gopay POST /payments] unexpected error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Interní chyba serveru.' }, { status: 500 });
  }
}

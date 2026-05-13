import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { InsuranceService } from '../../../../services/insurance.service';

const querySchema = z.object({
  ticket_price: z
    .string()
    .regex(/^\d+$/, 'ticket_price must be a positive integer (haléře)')
    .transform(Number)
    .refine((n) => n > 0, 'ticket_price must be greater than 0'),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const parsed = querySchema.safeParse({ ticket_price: searchParams.get('ticket_price') });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const quote = InsuranceService.getQuote(parsed.data.ticket_price);
  return NextResponse.json(quote, { status: 200 });
}

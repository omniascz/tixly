/**
 * POST /api/cart/validate
 *
 * Read-only pre-check — frontend volá před zobrazením checkout formuláře.
 * Ověří dostupnost vstupenek a vrátí aktuální ceny + kapacity.
 *
 * Žádná autentizace. Žádné vedlejší efekty (bez INSERTu, bez zámků).
 *
 * Body:
 *   { eventId: string, items: Array<{ ticketTypeId: string, quantity: number }> }
 *
 * Response 200:
 *   {
 *     valid: boolean,
 *     items: Array<{
 *       ticketTypeId: string,
 *       name: string,
 *       unitPriceHalire: number,
 *       quantity: number,
 *       available: boolean,
 *       remainingCapacity: number,
 *     }>,
 *     subtotalHalire: number,
 *     issues: string[]         // česky — např. "VIP: pouze 3 zbývající (požadováno 5)"
 *   }
 *
 * Všechny částky jsou INTEGER haléře (1 Kč = 100 haléřů). Nikdy float.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCheckoutDb } from '@lib/checkout-deps.js';
import { runWithServiceContext } from '@/lib/db/rls-pool';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const CartValidateSchema = z.object({
  eventId: z.string().uuid({ message: 'eventId musí být platné UUID' }),
  items: z
    .array(
      z.object({
        ticketTypeId: z.string().uuid({ message: 'ticketTypeId musí být platné UUID' }),
        quantity: z
          .number()
          .int({ message: 'množství musí být celé číslo' })
          .min(1, { message: 'minimální množství je 1' })
          .max(10, { message: 'maximální množství je 10' }),
      }),
    )
    .min(1, { message: 'košík musí obsahovat alespoň jednu položku' })
    .max(20, { message: 'košík může obsahovat nejvýše 20 položek' }),
});

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface TicketTypeRow {
  id: string;
  name: string;
  price_halire: number;
  available_capacity: number;
  max_per_order: number | null;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { valid: false, items: [], subtotalHalire: 0, issues: ['Neplatné tělo požadavku'] },
      { status: 400 },
    );
  }

  // Validate with Zod
  const parsed = CartValidateSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message);
    return NextResponse.json(
      { valid: false, items: [], subtotalHalire: 0, issues },
      { status: 400 },
    );
  }

  const { eventId, items } = parsed.data;

  // Cart validace (buyer/guest) → service kontext; getCheckoutDb adaptér zdědí.
  return runWithServiceContext(async () => {
  const db = getCheckoutDb();

  try {
    const ticketTypeIds = items.map((i) => i.ticketTypeId);

    // Single query — load all requested ticket types for this event
    const rows = await db.query<TicketTypeRow>(
      `SELECT id, name, price_halire, available_capacity, max_per_order
       FROM catalog.ticket_types
       WHERE id = ANY($1::uuid[]) AND event_id = $2`,
      [ticketTypeIds, eventId],
    );

    const rowMap = new Map<string, TicketTypeRow>(rows.map((r) => [r.id, r]));

    const resultItems: Array<{
      ticketTypeId: string;
      name: string;
      unitPriceHalire: number;
      quantity: number;
      available: boolean;
      remainingCapacity: number;
    }> = [];

    const issues: string[] = [];
    let subtotalHalire = 0;

    for (const item of items) {
      const tt = rowMap.get(item.ticketTypeId);

      if (!tt) {
        // Ticket type not found for this event
        resultItems.push({
          ticketTypeId: item.ticketTypeId,
          name: 'Neznámý typ vstupenky',
          unitPriceHalire: 0,
          quantity: item.quantity,
          available: false,
          remainingCapacity: 0,
        });
        issues.push(`Typ vstupenky ${item.ticketTypeId} nebyl nalezen pro tuto akci.`);
        continue;
      }

      const available = tt.available_capacity >= item.quantity;
      const perOrderOk = tt.max_per_order === null || item.quantity <= tt.max_per_order;

      if (!available) {
        if (tt.available_capacity === 0) {
          issues.push(`${tt.name}: vyprodáno`);
        } else {
          issues.push(
            `${tt.name}: pouze ${tt.available_capacity} zbývající (požadováno ${item.quantity})`,
          );
        }
      }

      if (!perOrderOk && tt.max_per_order !== null) {
        issues.push(
          `${tt.name}: v jedné objednávce lze zakoupit nejvýše ${tt.max_per_order} vstupenek`,
        );
      }

      const lineTotal = item.quantity * tt.price_halire;
      // Integers only — price_halire must be integer, quantity is integer → product is integer
      subtotalHalire += lineTotal;

      resultItems.push({
        ticketTypeId: item.ticketTypeId,
        name: tt.name,
        unitPriceHalire: tt.price_halire,
        quantity: item.quantity,
        available: available && perOrderOk,
        remainingCapacity: tt.available_capacity,
      });
    }

    const valid = issues.length === 0;

    return NextResponse.json(
      {
        valid,
        items: resultItems,
        subtotalHalire,
        issues,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/cart/validate] Chyba:', err);
    return NextResponse.json(
      {
        valid: false,
        items: [],
        subtotalHalire: 0,
        issues: ['Interní chyba serveru. Zkuste to prosím znovu.'],
      },
      { status: 500 },
    );
  }
  });
}

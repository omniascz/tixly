import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../middleware/rate-limit";
import { WebhookDeliveryService, webhookDb, webhookHttp } from "../../../../services/webhook-delivery.service";

const webhookService = new WebhookDeliveryService(webhookDb, webhookHttp);

// ---------------------------------------------------------------------------
// Validation schema for POST /api/v1/orders
// ---------------------------------------------------------------------------
const B2BOrderItemSchema = z.object({
  ticket_type_id: z.string().uuid({ message: "ticket_type_id musí být platné UUID." }),
  quantity: z.number().int().min(1).max(100, { message: "Množství musí být 1–100." }),
  seat_ids: z.array(z.string().max(50)).max(100).optional(),
});

const B2BCreateOrderSchema = z.object({
  event_id: z.string().uuid({ message: "event_id musí být platné UUID." }),
  items: z
    .array(B2BOrderItemSchema)
    .min(1, { message: "Musí být alespoň jedna položka." })
    .max(50, { message: "Maximálně 50 položek na objednávku." }),
  customer: z.object({
    email: z.string().email({ message: "customer.email musí být platná e-mailová adresa." }).max(254),
    name: z.string().min(1).max(200, { message: "customer.name může mít max. 200 znaků." }),
    phone: z.string().max(30).optional(),
  }),
  payment_method: z.literal("external", { errorMap: () => ({ message: "payment_method musí být 'external' pro B2B API." }) }),
  external_reference: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

interface CreateOrderDBAdapter {
  checkAvailability(items: OrderItem[]): Promise<{
    available: boolean;
    unavailableItems: string[];
  }>;
  createOrder(input: CreateOrderInput): Promise<OrderCreated>;
}

interface OrderItem {
  ticket_type_id: string;
  quantity: number;
  seat_ids?: string[];
}

interface CreateOrderInput {
  promoterId: string;
  environment: string;
  eventId: string;
  items: OrderItem[];
  customer: { email: string; name: string; phone?: string };
  paymentMethod: "external";
  externalReference?: string;
  metadata?: Record<string, unknown>;
}

interface OrderCreated {
  orderId: string;
  tickets: Array<{
    ticket_id: string;
    ticket_type: string;
    seat_info: string | null;
    qr_token: string | null;
  }>;
  totalAmount: number;
  currency: string;
  createdAt: Date;
}

const db = {} as CreateOrderDBAdapter;

// ---------------------------------------------------------------------------
// POST /api/v1/orders — POS objednávka
//
// payment_method: "external" = platba proběhla mimo platformu (hotovost, POS terminál).
// Objednávka přechází přímo do stavu 'paid', vstupenky jsou ihned vydány.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "write:orders");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  let body: z.infer<typeof B2BCreateOrderSchema>;
  try {
    const raw = await request.json();
    body = B2BCreateOrderSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
        auth.requestId,
      );
    }
    return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON", auth.requestId);
  }

  const items = body.items as OrderItem[];

  // Kontrola dostupnosti
  const { available, unavailableItems } = await db.checkAvailability(items);
  if (!available) {
    return withRateLimitHeaders(
      errorResponse(
        409,
        "INSUFFICIENT_AVAILABILITY",
        `Insufficient availability for ticket types: ${unavailableItems.join(", ")}`,
        auth.requestId
      ),
      rl.headers
    );
  }

  const created = await db.createOrder({
    promoterId: auth.promoterId,
    environment: auth.environment,
    eventId: body.event_id,
    items,
    customer: {
      email: body.customer.email,
      name: body.customer.name,
      phone: body.customer.phone,
    },
    paymentMethod: "external",
    externalReference: body.external_reference,
    metadata: body.metadata,
  });

  // Enqueue webhooky (fire & forget)
  Promise.all([
    webhookService.enqueue(auth.promoterId, "order.created", {
      order_id: created.orderId,
      promoter_id: auth.promoterId,
      event_id: body.event_id as string,
      total_amount: created.totalAmount,
      currency: created.currency,
    }),
    webhookService.enqueue(auth.promoterId, "order.paid", {
      order_id: created.orderId,
      promoter_id: auth.promoterId,
      payment_method: "external",
    }),
  ]).catch(() => {});

  const hasTicketScope = auth.scopes.includes("read:tickets");

  return withRateLimitHeaders(
    NextResponse.json(
      {
        order_id: created.orderId,
        status: "paid",
        tickets: created.tickets.map((t) => ({
          ticket_id: t.ticket_id,
          ticket_type: t.ticket_type,
          seat_info: t.seat_info,
          // QR token pouze pokud má klíč read:tickets scope
          ...(hasTicketScope ? { qr_token: t.qr_token } : {}),
        })),
        total_amount: created.totalAmount,
        currency: created.currency,
        created_at: created.createdAt.toISOString(),
      },
      { status: 201 }
    ),
    rl.headers
  );
}

// ---------------------------------------------------------------------------
// GET /api/v1/orders — seznam objednávek promotéra
// ---------------------------------------------------------------------------
interface OrderListDBAdapter {
  listOrders(promoterId: string, filters: {
    eventId?: string;
    status?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ orders: OrderSummary[]; total: number }>;
}

interface OrderSummary {
  id: string;
  event_id: string;
  status: string;
  total_amount: number;
  currency: string;
  customer_email: string;
  external_reference: string | null;
  created_at: string;
}

const listDb = {} as OrderListDBAdapter;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "read:orders");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const { orders, total } = await listDb.listOrders(auth.promoterId, {
    eventId: searchParams.get("event_id") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    from: searchParams.get("from") ? new Date(searchParams.get("from")!) : undefined,
    to: searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined,
    limit,
    offset,
  });

  return withRateLimitHeaders(
    NextResponse.json({ data: orders, total, limit, offset }),
    rl.headers
  );
}

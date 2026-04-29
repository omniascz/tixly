// intent.handler.ts — Routes voice intents to domain actions
// Platform-agnostic: receives normalized VoiceRequest, returns VoiceResponse.
// Each intent handler gets db + cache adapters for pure testability.

import type {
  VoiceRequest,
  VoiceResponse,
  VoiceSession,
  VoiceEventResult,
  VoiceOrderSummary,
  DbAdapter,
  CacheAdapter,
  IntentName,
} from '../lib/types';
import {
  VoiceAuthRequiredError,
  VoiceIntentNotFoundError,
  VoiceSlotMissingError,
  VoiceCartEmptyError,
} from '../lib/types';

export interface IntentHandlerDeps {
  db: DbAdapter;
  cache: CacheAdapter;
}

const SESSION_TTL = 300; // 5 minutes

// ─── Session helpers ──────────────────────────────────────────

export async function getSession(
  deps: IntentHandlerDeps,
  sessionId: string,
): Promise<VoiceSession | null> {
  return deps.cache.get<VoiceSession>(`voice:session:${sessionId}`);
}

export async function saveSession(
  deps: IntentHandlerDeps,
  session: VoiceSession,
): Promise<void> {
  await deps.cache.set(`voice:session:${session.sessionId}`, session, SESSION_TTL);
}

// ─── Main dispatcher ──────────────────────────────────────────

/**
 * Route a normalized VoiceRequest to the appropriate handler.
 * Returns a platform-agnostic VoiceResponse.
 */
export async function handleIntent(
  deps: IntentHandlerDeps,
  request: VoiceRequest,
): Promise<VoiceResponse> {
  const session = await getOrCreateSession(deps, request);

  try {
    switch (request.intent) {
      case 'LaunchRequest':
        return handleLaunch(request, session);
      case 'SearchEvents':
        return handleSearchEvents(deps, request, session);
      case 'GetEventDetails':
        return handleGetEventDetails(deps, request, session);
      case 'AddToCart':
        return handleAddToCart(deps, request, session);
      case 'Checkout':
        return handleCheckout(deps, request, session);
      case 'CheckOrderStatus':
        return handleCheckOrderStatus(deps, request, session);
      case 'ListMyTickets':
        return handleListMyTickets(deps, request, session);
      case 'CancelOrder':
        return handleCancelOrder(deps, request, session);
      case 'AMAZON.HelpIntent':
        return helpResponse();
      case 'AMAZON.CancelIntent':
      case 'AMAZON.StopIntent':
        return goodbyeResponse();
      default:
        throw new VoiceIntentNotFoundError(request.intent);
    }
  } finally {
    session.lastIntent = request.intent;
    session.lastUpdated = new Date();
    await saveSession(deps, session);
  }
}

// ─── Session management ───────────────────────────────────────

async function getOrCreateSession(
  deps: IntentHandlerDeps,
  request: VoiceRequest,
): Promise<VoiceSession> {
  const existing = await getSession(deps, request.sessionId);
  if (existing) return { ...existing, userId: request.userId ?? existing.userId };

  return {
    sessionId: request.sessionId,
    userId: request.userId,
    platform: request.platform,
    lastUpdated: new Date(),
  };
}

// ─── Intent handlers ─────────────────────────────────────────

function handleLaunch(_request: VoiceRequest, _session: VoiceSession): VoiceResponse {
  return {
    speech: 'Vítejte v Tixly. Mohu vám pomoci najít vstupenky na akce. Zkuste říct: Najdi koncerty v Praze.',
    reprompt: 'Na jakou akci hledáte vstupenky?',
    endSession: false,
  };
}

async function handleSearchEvents(
  deps: IntentHandlerDeps,
  request: VoiceRequest,
  _session: VoiceSession,
): Promise<VoiceResponse> {
  const city = getSlotValue(request, 'city');
  const category = getSlotValue(request, 'category');
  const date = getSlotValue(request, 'date');

  const events = await searchEvents(deps.db, { city, category, date });

  if (events.length === 0) {
    return {
      speech: `Nenašel jsem žádné akce${city ? ` v ${city}` : ''}${category ? ` z kategorie ${category}` : ''}. Zkuste jiné hledání.`,
      endSession: false,
    };
  }

  const topEvent = events[0];
  const priceKc = Math.floor(topEvent.lowestPriceHalire / 100);
  const dateStr = formatDate(topEvent.dateStart);

  const speechParts = [
    `Našel jsem ${events.length} ${pluralize(events.length, 'akci', 'akce', 'akcí')}.`,
    `Například: ${topEvent.name} v ${topEvent.venue}, ${dateStr}, vstupenky od ${priceKc} korun.`,
  ];

  if (events.length > 1) {
    speechParts.push(`Chcete slyšet více, nebo mám přidat tuto akci do košíku?`);
  } else {
    speechParts.push(`Mám přidat do košíku?`);
  }

  return {
    speech: speechParts.join(' '),
    reprompt: 'Mám přidat vstupenku do košíku?',
    card: {
      title: topEvent.name,
      content: `${topEvent.venue} · ${dateStr} · od ${priceKc} Kč`,
    },
    endSession: false,
    data: { eventId: topEvent.id, events: events.slice(0, 3) },
  };
}

async function handleGetEventDetails(
  deps: IntentHandlerDeps,
  request: VoiceRequest,
  session: VoiceSession,
): Promise<VoiceResponse> {
  const eventId = getSlotValue(request, 'eventId') ?? session.pendingCart?.eventId;
  if (!eventId) throw new VoiceSlotMissingError('eventId');

  const event = await getEventById(deps.db, eventId);
  if (!event) {
    return { speech: 'Tuto akci jsem nenašel.', endSession: false };
  }

  const priceKc = Math.floor(event.lowestPriceHalire / 100);
  return {
    speech: `${event.name}. Místo konání: ${event.venue} v ${event.city}. Datum: ${formatDate(event.dateStart)}. Vstupenky od ${priceKc} korun. Zbývá ${event.availableTickets} vstupenek. Mám přidat do košíku?`,
    reprompt: 'Mám přidat vstupenku do košíku?',
    card: {
      title: event.name,
      content: `${event.venue}, ${event.city}\n${formatDate(event.dateStart)}\nOd ${priceKc} Kč · ${event.availableTickets} zbývá`,
    },
    endSession: false,
    data: { eventId: event.id },
  };
}

async function handleAddToCart(
  deps: IntentHandlerDeps,
  request: VoiceRequest,
  session: VoiceSession,
): Promise<VoiceResponse> {
  if (!session.userId) throw new VoiceAuthRequiredError();

  const eventId = getSlotValue(request, 'eventId') ?? session.pendingCart?.eventId;
  if (!eventId) throw new VoiceSlotMissingError('eventId');

  const quantityStr = getSlotValue(request, 'quantity') ?? '1';
  const quantity = parseInt(quantityStr, 10) || 1;

  const event = await getEventById(deps.db, eventId);
  if (!event) {
    return { speech: 'Tuto akci jsem nenašel.', endSession: false };
  }

  session.pendingCart = {
    eventId: event.id,
    eventName: event.name,
    quantity,
    priceHalire: event.lowestPriceHalire * quantity,
  };

  const totalKc = Math.floor((event.lowestPriceHalire * quantity) / 100);
  return {
    speech: `Přidal jsem ${quantity} ${pluralize(quantity, 'vstupenku', 'vstupenky', 'vstupenek')} na ${event.name}. Celkem ${totalKc} korun. Mám dokončit objednávku?`,
    reprompt: 'Mám dokončit objednávku? Nebo říkejte zrušit.',
    endSession: false,
  };
}

async function handleCheckout(
  deps: IntentHandlerDeps,
  request: VoiceRequest,
  session: VoiceSession,
): Promise<VoiceResponse> {
  if (!session.userId) throw new VoiceAuthRequiredError();
  if (!session.pendingCart) throw new VoiceCartEmptyError();

  const { eventId, eventName, quantity, priceHalire } = session.pendingCart;

  // Create order via DB (real implementation would call Order Service)
  const orderId = await createVoiceOrder(deps.db, {
    userId: session.userId,
    eventId,
    quantity,
    totalHalire: priceHalire,
  });

  // Clear cart
  session.pendingCart = undefined;

  const totalKc = Math.floor(priceHalire / 100);
  return {
    speech: `Skvěle! Objednávka na ${eventName} byla vytvořena. Celková cena ${totalKc} korun. Potvrzení vám přijde na e-mail. Číslo objednávky je ${orderId}.`,
    card: {
      title: 'Objednávka potvrzena',
      content: `${eventName}\n${quantity} × vstupenka\nCelkem: ${totalKc} Kč\nObjednávka: ${orderId}`,
    },
    endSession: true,
  };
}

async function handleCheckOrderStatus(
  deps: IntentHandlerDeps,
  request: VoiceRequest,
  session: VoiceSession,
): Promise<VoiceResponse> {
  if (!session.userId) throw new VoiceAuthRequiredError();

  const orders = await getRecentOrders(deps.db, session.userId);
  if (orders.length === 0) {
    return { speech: 'Nemáte žádné objednávky.', endSession: false };
  }

  const latest = orders[0];
  const totalKc = Math.floor(latest.totalHalire / 100);
  return {
    speech: `Vaše poslední objednávka: ${latest.eventName}, ${latest.ticketCount} ${pluralize(latest.ticketCount, 'vstupenka', 'vstupenky', 'vstupenek')}, celkem ${totalKc} korun. Stav: ${translateStatus(latest.status)}.`,
    endSession: false,
  };
}

async function handleListMyTickets(
  deps: IntentHandlerDeps,
  _request: VoiceRequest,
  session: VoiceSession,
): Promise<VoiceResponse> {
  if (!session.userId) throw new VoiceAuthRequiredError();

  const orders = await getRecentOrders(deps.db, session.userId);
  const upcoming = orders.filter((o) => o.status === 'completed');

  if (upcoming.length === 0) {
    return { speech: 'Nemáte žádné nadcházející akce.', endSession: false };
  }

  const names = upcoming.slice(0, 3).map((o) => o.eventName).join(', ');
  return {
    speech: `Máte vstupenky na ${upcoming.length} ${pluralize(upcoming.length, 'akci', 'akce', 'akcí')}: ${names}.`,
    endSession: false,
  };
}

async function handleCancelOrder(
  deps: IntentHandlerDeps,
  request: VoiceRequest,
  session: VoiceSession,
): Promise<VoiceResponse> {
  if (!session.userId) throw new VoiceAuthRequiredError();

  // If there's a pending cart, clear it
  if (session.pendingCart) {
    session.pendingCart = undefined;
    return {
      speech: 'Košík byl vyprázdněn. Mohu vám pomoci s něčím jiným?',
      endSession: false,
    };
  }

  return {
    speech: 'Nemáte žádný aktivní košík. Chcete zrušit existující objednávku? To lze pouze přes aplikaci nebo web.',
    endSession: false,
  };
}

// ─── Utility responses ────────────────────────────────────────

function helpResponse(): VoiceResponse {
  return {
    speech: 'Tixly vám pomůže koupit vstupenky hlasem. Můžete říct: Najdi koncerty, Přidej do košíku, nebo Zkontroluj mé objednávky.',
    reprompt: 'Na co se chcete zeptat?',
    endSession: false,
  };
}

function goodbyeResponse(): VoiceResponse {
  return {
    speech: 'Na shledanou! Těšíme se na vás.',
    endSession: true,
  };
}

// ─── DB helpers ───────────────────────────────────────────────

interface EventRow {
  id: string;
  name: string;
  date_start: string;
  venue: string;
  city: string;
  lowest_price_halire: number;
  available_tickets: number;
}

async function searchEvents(
  db: DbAdapter,
  filters: { city?: string | null; category?: string | null; date?: string | null },
): Promise<VoiceEventResult[]> {
  const conditions: string[] = ['e.status = \'published\'', 'e.date_start > NOW()'];
  const params: unknown[] = [];

  if (filters.city) {
    params.push(filters.city);
    conditions.push(`v.city ILIKE $${params.length}`);
  }
  if (filters.category) {
    params.push(`%${filters.category}%`);
    conditions.push(`e.category ILIKE $${params.length}`);
  }

  const rows = await db.query<EventRow>(
    `SELECT e.id, e.title as name, e.date_start, v.name as venue, v.city,
            MIN(tp.price_halire) as lowest_price_halire,
            SUM(tp.available) as available_tickets
     FROM events.events e
     JOIN events.venues v ON e.venue_id = v.id
     JOIN events.ticket_types tp ON tp.event_id = e.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY e.id, e.title, e.date_start, v.name, v.city
     ORDER BY e.date_start ASC
     LIMIT 5`,
    params,
  );

  return rows.map(mapEventRow);
}

async function getEventById(db: DbAdapter, eventId: string): Promise<VoiceEventResult | null> {
  const row = await db.queryOne<EventRow>(
    `SELECT e.id, e.title as name, e.date_start, v.name as venue, v.city,
            MIN(tp.price_halire) as lowest_price_halire,
            SUM(tp.available) as available_tickets
     FROM events.events e
     JOIN events.venues v ON e.venue_id = v.id
     JOIN events.ticket_types tp ON tp.event_id = e.id
     WHERE e.id = $1
     GROUP BY e.id, e.title, e.date_start, v.name, v.city`,
    [eventId],
  );
  return row ? mapEventRow(row) : null;
}

function mapEventRow(row: EventRow): VoiceEventResult {
  return {
    id: row.id,
    name: row.name,
    dateStart: new Date(row.date_start),
    venue: row.venue,
    city: row.city,
    lowestPriceHalire: row.lowest_price_halire,
    availableTickets: row.available_tickets,
  };
}

async function createVoiceOrder(
  db: DbAdapter,
  opts: { userId: string; eventId: string; quantity: number; totalHalire: number },
): Promise<string> {
  const row = await db.queryOne<{ id: string }>(
    `INSERT INTO orders.orders (user_id, event_id, quantity, total_amount_halire, status, source, created_at)
     VALUES ($1, $2, $3, $4, 'pending_payment', 'voice', NOW())
     RETURNING id`,
    [opts.userId, opts.eventId, opts.quantity, opts.totalHalire],
  );
  return row!.id;
}

async function getRecentOrders(db: DbAdapter, userId: string): Promise<VoiceOrderSummary[]> {
  const rows = await db.query<{
    order_id: string; status: string; event_name: string; ticket_count: number; total_halire: number;
  }>(
    `SELECT o.id as order_id, o.status, e.title as event_name,
            COUNT(ot.id) as ticket_count, o.total_amount_halire as total_halire
     FROM orders.orders o
     JOIN events.events e ON o.event_id = e.id
     LEFT JOIN orders.order_tickets ot ON ot.order_id = o.id
     WHERE o.user_id = $1
     GROUP BY o.id, o.status, e.title, o.total_amount_halire
     ORDER BY o.created_at DESC
     LIMIT 5`,
    [userId],
  );

  return rows.map((r) => ({
    orderId: r.order_id,
    status: r.status,
    eventName: r.event_name,
    ticketCount: Number(r.ticket_count),
    totalHalire: r.total_halire,
  }));
}

// ─── String helpers ───────────────────────────────────────────

function getSlotValue(request: VoiceRequest, slotName: string): string | null {
  return request.slots[slotName]?.resolved ?? request.slots[slotName]?.value ?? null;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

function pluralize(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}

function translateStatus(status: string): string {
  const map: Record<string, string> = {
    pending_payment: 'čekající na platbu',
    completed: 'zaplaceno',
    cancelled: 'zrušeno',
    refunded: 'vráceno',
  };
  return map[status] ?? status;
}

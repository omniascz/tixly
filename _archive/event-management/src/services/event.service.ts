import { randomUUID } from 'crypto';
import type { ServiceDeps } from '../lib/service-container.js';
import { EventManagementError } from '../lib/event-errors.js';
import type {
  Event,
  EventListItem,
  EventStatus,
  EventWithTicketTypes,
  CreateEventInput,
  CreateTicketTypeInput,
  UpdateEventInput,
  UpdateTicketTypeInput,
  TicketType,
} from '../types/event.js';

// ─── DB row shapes (snake_case from PostgreSQL) ───────────────────────────────

interface EventRow {
  id: string;
  promoter_id: string;
  venue_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  date_start: Date;
  date_end: Date | null;
  status: EventStatus;
  capacity: number | null;
  sold_count: number;
  on_sale_at: Date | null;
  off_sale_at: Date | null;
  resale_allowed: boolean;
  resale_commission_rate: number | null;
  re_entry_allowed: boolean;
  tags: string[];
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price_halire: number;
  capacity: number | null;
  sold_count: number;
  zone: string | null;
  sort_order: number;
  sale_start_at: Date | null;
  sale_end_at: Date | null;
  min_per_order: number;
  max_per_order: number;
  is_active: boolean;
  transferable: boolean;
  created_at: Date;
}

interface EventListRow extends EventRow {
  ticket_type_count: string; // bigint přichází jako string z pg
  venue_name: string | null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function rowToEvent(row: EventRow): Event {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    venueId: row.venue_id,
    title: row.title,
    description: row.description,
    category: row.category,
    subcategory: row.subcategory,
    imageUrl: row.image_url,
    startDate: row.date_start,
    endDate: row.date_end,
    status: row.status,
    capacity: row.capacity,
    soldCount: row.sold_count,
    onSaleAt: row.on_sale_at,
    offSaleAt: row.off_sale_at,
    resaleAllowed: row.resale_allowed,
    resaleCommissionRate: row.resale_commission_rate,
    reEntryAllowed: row.re_entry_allowed,
    tags: row.tags ?? [],
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTicketType(row: TicketTypeRow): TicketType {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    description: row.description,
    priceHalire: row.price_halire,
    capacity: row.capacity,
    soldCount: row.sold_count,
    zone: row.zone,
    sortOrder: row.sort_order,
    saleStartAt: row.sale_start_at,
    saleEndAt: row.sale_end_at,
    minPerOrder: row.min_per_order,
    maxPerOrder: row.max_per_order,
    isActive: row.is_active,
    transferable: row.transferable,
    createdAt: row.created_at,
  };
}

function rowToEventListItem(row: EventListRow): EventListItem {
  return {
    id: row.id,
    title: row.title,
    startDate: row.date_start,
    status: row.status,
    capacity: row.capacity,
    soldCount: row.sold_count,
    ticketTypeCount: parseInt(row.ticket_type_count, 10),
    imageUrl: row.image_url,
    venueName: row.venue_name,
  };
}

function buildEventWithTicketTypes(event: Event, ticketTypes: TicketType[]): EventWithTicketTypes {
  const totalSold = ticketTypes.reduce((sum, tt) => sum + tt.soldCount, 0);
  const totalRemaining =
    event.capacity !== null ? event.capacity - totalSold : null;

  return { ...event, ticketTypes, totalSold, totalRemaining };
}

// ─── Internal helper: load event + verify ownership ───────────────────────────

async function loadEventOrThrow(
  eventId: string,
  promoterId: string,
  db: ServiceDeps['db'],
): Promise<Event> {
  const rows = await db.query<EventRow>(
    `SELECT
       id, promoter_id, venue_id, title, description, category, subcategory,
       image_url, date_start, date_end, status, capacity, sold_count,
       on_sale_at, off_sale_at, resale_allowed, resale_commission_rate,
       re_entry_allowed, tags, metadata, created_at, updated_at
     FROM catalog.events
     WHERE id = $1`,
    [eventId],
  );

  if (rows.length === 0) {
    throw new EventManagementError('EVENT_NOT_FOUND', `Akce ${eventId} nebyla nalezena.`);
  }

  const row = rows[0]!;

  // Anti-enumerace: vracíme 404 i když je problém s vlastnictvím
  if (row.promoter_id !== promoterId) {
    throw new EventManagementError('EVENT_NOT_OWNED', `Akce ${eventId} nebyla nalezena.`);
  }

  return rowToEvent(row);
}

async function loadTicketTypesForEvent(
  eventId: string,
  db: ServiceDeps['db'],
): Promise<TicketType[]> {
  const rows = await db.query<TicketTypeRow>(
    `SELECT
       id, event_id, name, description, price_halire, capacity, sold_count,
       zone, sort_order, sale_start_at, sale_end_at, min_per_order,
       max_per_order, is_active, transferable, created_at
     FROM catalog.ticket_types
     WHERE event_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [eventId],
  );

  return rows.map(rowToTicketType);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createEvent(
  promoterId: string,
  input: CreateEventInput,
  deps: ServiceDeps,
): Promise<EventWithTicketTypes> {
  const eventId = randomUUID();

  return deps.db.transaction(async (trx) => {
    // 1. Vložit akci
    const eventRows = await trx.query<EventRow>(
      `INSERT INTO catalog.events (
         id, promoter_id, venue_id, title, description, category, subcategory,
         image_url, date_start, date_end, status, capacity, sold_count,
         on_sale_at, off_sale_at, resale_allowed, re_entry_allowed,
         tags, metadata, created_at, updated_at
       ) VALUES (
         $1,  $2,  $3,  $4,  $5,  $6,  $7,
         $8,  $9,  $10, $11, $12, $13,
         $14, $15, $16, $17,
         $18, $19, NOW(), NOW()
       )
       RETURNING
         id, promoter_id, venue_id, title, description, category, subcategory,
         image_url, date_start, date_end, status, capacity, sold_count,
         on_sale_at, off_sale_at, resale_allowed, resale_commission_rate,
         re_entry_allowed, tags, metadata, created_at, updated_at`,
      [
        eventId,
        promoterId,
        input.venueId ?? null,
        input.title,
        input.description ?? null,
        input.category ?? null,
        input.subcategory ?? null,
        input.imageUrl ?? null,
        input.startDate,
        input.endDate ?? null,
        'draft',
        input.capacity ?? null,
        0,
        input.onSaleAt ?? null,
        input.offSaleAt ?? null,
        input.resaleAllowed ?? false,
        input.reEntryAllowed ?? false,
        input.tags ?? [],
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );

    const event = rowToEvent(eventRows[0]!);

    // 2. Vložit typy vstupenek
    const ticketTypes: TicketType[] = [];

    for (let i = 0; i < input.ticketTypes.length; i++) {
      const tt = input.ticketTypes[i]!;
      const ttId = randomUUID();
      const sortOrder = tt.sortOrder ?? i;

      const ttRows = await trx.query<TicketTypeRow>(
        `INSERT INTO catalog.ticket_types (
           id, event_id, name, description, price_halire, capacity, sold_count,
           zone, sort_order, sale_start_at, sale_end_at, min_per_order,
           max_per_order, is_active, transferable, created_at
         ) VALUES (
           $1,  $2,  $3,  $4,  $5,  $6,  $7,
           $8,  $9,  $10, $11, $12,
           $13, $14, $15, NOW()
         )
         RETURNING
           id, event_id, name, description, price_halire, capacity, sold_count,
           zone, sort_order, sale_start_at, sale_end_at, min_per_order,
           max_per_order, is_active, transferable, created_at`,
        [
          ttId,
          eventId,
          tt.name,
          tt.description ?? null,
          tt.priceHalire,
          tt.capacity ?? null,
          0,
          tt.zone ?? null,
          sortOrder,
          tt.saleStartAt ?? null,
          tt.saleEndAt ?? null,
          tt.minPerOrder ?? 1,
          tt.maxPerOrder ?? 10,
          true,
          tt.transferable ?? true,
        ],
      );

      ticketTypes.push(rowToTicketType(ttRows[0]!));
    }

    // 3. Emit Kafka event.created
    await deps.kafka.send('event.created', {
      eventId,
      promoterId,
      title: event.title,
      startDate: event.startDate,
      ticketTypeCount: ticketTypes.length,
    });

    return buildEventWithTicketTypes(event, ticketTypes);
  });
}

export async function getEvent(
  eventId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<EventWithTicketTypes> {
  const event = await loadEventOrThrow(eventId, promoterId, deps.db);
  const ticketTypes = await loadTicketTypesForEvent(eventId, deps.db);
  return buildEventWithTicketTypes(event, ticketTypes);
}

export async function listEvents(
  promoterId: string,
  filters: { status?: EventStatus; search?: string; from?: Date; to?: Date },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: EventListItem[]; total: number }> {
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;

  const params: unknown[] = [promoterId];
  const conditions: string[] = ['e.promoter_id = $1'];
  let p = 2;

  if (filters.status) {
    conditions.push(`e.status = $${p}`);
    params.push(filters.status);
    p++;
  }

  if (filters.search) {
    conditions.push(`e.title ILIKE $${p}`);
    params.push(`%${filters.search}%`);
    p++;
  }

  if (filters.from) {
    conditions.push(`e.date_start >= $${p}`);
    params.push(filters.from);
    p++;
  }

  if (filters.to) {
    conditions.push(`e.date_start <= $${p}`);
    params.push(filters.to);
    p++;
  }

  const whereClause = conditions.join(' AND ');

  const baseQuery = `
    FROM catalog.events e
    LEFT JOIN catalog.venues v ON v.id = e.venue_id
    WHERE ${whereClause}
  `;

  const [countRows, itemRows] = await Promise.all([
    deps.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total ${baseQuery}`,
      params,
    ),
    deps.db.query<EventListRow>(
      `SELECT
         e.id, e.promoter_id, e.venue_id, e.title, e.description, e.category,
         e.subcategory, e.image_url, e.date_start, e.date_end, e.status,
         e.capacity, e.sold_count, e.on_sale_at, e.off_sale_at,
         e.resale_allowed, e.resale_commission_rate, e.re_entry_allowed,
         e.tags, e.metadata, e.created_at, e.updated_at,
         v.name AS venue_name,
         (
           SELECT COUNT(*)::text
           FROM catalog.ticket_types tt
           WHERE tt.event_id = e.id
         ) AS ticket_type_count
       ${baseQuery}
       ORDER BY e.date_start DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset],
    ),
  ]);

  return {
    items: itemRows.map(rowToEventListItem),
    total: parseInt(countRows[0]?.total ?? '0', 10),
  };
}

export async function updateEvent(
  eventId: string,
  promoterId: string,
  input: UpdateEventInput,
  deps: ServiceDeps,
): Promise<Event> {
  const event = await loadEventOrThrow(eventId, promoterId, deps.db);

  // Pole uzamčená po publikaci
  const LOCKED_FIELDS_AFTER_PUBLISH: Array<keyof UpdateEventInput> = [
    'title',
    'startDate',
    'capacity',
    'venueId',
    'category',
    'subcategory',
    'resaleAllowed',
    'reEntryAllowed',
  ];

  if (event.status === 'published') {
    for (const field of LOCKED_FIELDS_AFTER_PUBLISH) {
      if (input[field] !== undefined) {
        throw new EventManagementError(
          'CANNOT_EDIT_PUBLISHED_EVENT',
          `Pole '${field}' nelze upravit po publikaci akce. Povolené změny: description, imageUrl, metadata, offSaleAt.`,
        );
      }
    }
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let pidx = 1;

  const fieldMap: Record<string, string> = {
    title: 'title',
    description: 'description',
    category: 'category',
    subcategory: 'subcategory',
    imageUrl: 'image_url',
    venueId: 'venue_id',
    startDate: 'date_start',
    endDate: 'date_end',
    capacity: 'capacity',
    onSaleAt: 'on_sale_at',
    offSaleAt: 'off_sale_at',
    resaleAllowed: 'resale_allowed',
    reEntryAllowed: 're_entry_allowed',
    tags: 'tags',
    metadata: 'metadata',
  };

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = (input as Record<string, unknown>)[key];
    if (val !== undefined) {
      if (key === 'metadata' && val !== null) {
        setClauses.push(`${dbCol} = $${pidx}`);
        params.push(JSON.stringify(val));
      } else {
        setClauses.push(`${dbCol} = $${pidx}`);
        params.push(val);
      }
      pidx++;
    }
  }

  if (setClauses.length === 0) {
    return event;
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(eventId);

  const rows = await deps.db.query<EventRow>(
    `UPDATE catalog.events
     SET ${setClauses.join(', ')}
     WHERE id = $${pidx}
     RETURNING
       id, promoter_id, venue_id, title, description, category, subcategory,
       image_url, date_start, date_end, status, capacity, sold_count,
       on_sale_at, off_sale_at, resale_allowed, resale_commission_rate,
       re_entry_allowed, tags, metadata, created_at, updated_at`,
    params,
  );

  return rowToEvent(rows[0]!);
}

export async function deleteEvent(
  eventId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const event = await loadEventOrThrow(eventId, promoterId, deps.db);

  if (event.status !== 'draft') {
    throw new EventManagementError(
      'EVENT_ALREADY_PUBLISHED',
      'Smazat lze pouze akci ve stavu "draft". Publikovanou nebo zrušenou akci nejprve zrušte.',
    );
  }

  // Smazat typy vstupenek (nebo CASCADE v DB)
  await deps.db.execute(
    `DELETE FROM catalog.ticket_types WHERE event_id = $1`,
    [eventId],
  );

  await deps.db.execute(
    `DELETE FROM catalog.events WHERE id = $1`,
    [eventId],
  );
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export async function publishEvent(
  eventId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<Event> {
  const event = await loadEventOrThrow(eventId, promoterId, deps.db);

  if (event.status === 'published') {
    throw new EventManagementError(
      'EVENT_ALREADY_PUBLISHED',
      'Akce je již publikována.',
    );
  }

  if (event.status === 'cancelled') {
    throw new EventManagementError(
      'EVENT_ALREADY_CANCELLED',
      'Zrušenou akci nelze znovu publikovat.',
    );
  }

  // Musí existovat alespoň jeden aktivní typ vstupenky
  const ticketTypes = await loadTicketTypesForEvent(eventId, deps.db);
  const activeTicketTypes = ticketTypes.filter((tt) => tt.isActive);

  if (activeTicketTypes.length === 0) {
    throw new EventManagementError(
      'TICKET_TYPE_NOT_FOUND',
      'Akce musí mít alespoň jeden aktivní typ vstupenky před publikací.',
    );
  }

  // Datum musí být v budoucnosti
  if (event.startDate <= new Date()) {
    throw new EventManagementError(
      'INVALID_DATE_RANGE',
      'Datum zahájení akce musí být v budoucnosti.',
    );
  }

  const rows = await deps.db.query<EventRow>(
    `UPDATE catalog.events
     SET status = 'published', updated_at = NOW()
     WHERE id = $1
     RETURNING
       id, promoter_id, venue_id, title, description, category, subcategory,
       image_url, date_start, date_end, status, capacity, sold_count,
       on_sale_at, off_sale_at, resale_allowed, resale_commission_rate,
       re_entry_allowed, tags, metadata, created_at, updated_at`,
    [eventId],
  );

  const updatedEvent = rowToEvent(rows[0]!);

  await deps.kafka.send('event.published', {
    eventId,
    promoterId,
    title: updatedEvent.title,
    startDate: updatedEvent.startDate,
  });

  return updatedEvent;
}

export async function unpublishEvent(
  eventId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<Event> {
  const event = await loadEventOrThrow(eventId, promoterId, deps.db);

  if (event.status !== 'published') {
    throw new EventManagementError(
      'EVENT_NOT_FOUND',
      `Akci nelze odebrat z publikace — aktuální stav: ${event.status}.`,
    );
  }

  const rows = await deps.db.query<EventRow>(
    `UPDATE catalog.events
     SET status = 'draft', updated_at = NOW()
     WHERE id = $1
     RETURNING
       id, promoter_id, venue_id, title, description, category, subcategory,
       image_url, date_start, date_end, status, capacity, sold_count,
       on_sale_at, off_sale_at, resale_allowed, resale_commission_rate,
       re_entry_allowed, tags, metadata, created_at, updated_at`,
    [eventId],
  );

  return rowToEvent(rows[0]!);
}

export async function cancelEvent(
  eventId: string,
  promoterId: string,
  reason: string,
  deps: ServiceDeps,
): Promise<Event> {
  const event = await loadEventOrThrow(eventId, promoterId, deps.db);

  if (event.status === 'cancelled') {
    throw new EventManagementError(
      'EVENT_ALREADY_CANCELLED',
      'Akce je již zrušena.',
    );
  }

  if (event.status === 'ended') {
    throw new EventManagementError(
      'EVENT_ALREADY_CANCELLED',
      'Ukončenou akci nelze zrušit.',
    );
  }

  const rows = await deps.db.query<EventRow>(
    `UPDATE catalog.events
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1
     RETURNING
       id, promoter_id, venue_id, title, description, category, subcategory,
       image_url, date_start, date_end, status, capacity, sold_count,
       on_sale_at, off_sale_at, resale_allowed, resale_commission_rate,
       re_entry_allowed, tags, metadata, created_at, updated_at`,
    [eventId],
  );

  const updatedEvent = rowToEvent(rows[0]!);

  // Downstream: spouštěč hromadného vrácení peněz
  await deps.kafka.send('event.cancelled', {
    eventId,
    promoterId,
    reason,
    cancelledAt: new Date().toISOString(),
  });

  return updatedEvent;
}

// ─── Ticket Types ─────────────────────────────────────────────────────────────

export async function addTicketType(
  eventId: string,
  promoterId: string,
  input: CreateTicketTypeInput,
  deps: ServiceDeps,
): Promise<TicketType> {
  // Ověříme vlastnictví
  await loadEventOrThrow(eventId, promoterId, deps.db);

  const ttId = randomUUID();

  // Zjistit aktuální nejvyšší sort_order
  const maxRows = await deps.db.query<{ max_sort: number | null }>(
    `SELECT MAX(sort_order) AS max_sort FROM catalog.ticket_types WHERE event_id = $1`,
    [eventId],
  );
  const nextSortOrder = (maxRows[0]?.max_sort ?? -1) + 1;
  const sortOrder = input.sortOrder ?? nextSortOrder;

  const rows = await deps.db.query<TicketTypeRow>(
    `INSERT INTO catalog.ticket_types (
       id, event_id, name, description, price_halire, capacity, sold_count,
       zone, sort_order, sale_start_at, sale_end_at, min_per_order,
       max_per_order, is_active, transferable, created_at
     ) VALUES (
       $1,  $2,  $3,  $4,  $5,  $6,  $7,
       $8,  $9,  $10, $11, $12,
       $13, $14, $15, NOW()
     )
     RETURNING
       id, event_id, name, description, price_halire, capacity, sold_count,
       zone, sort_order, sale_start_at, sale_end_at, min_per_order,
       max_per_order, is_active, transferable, created_at`,
    [
      ttId,
      eventId,
      input.name,
      input.description ?? null,
      input.priceHalire,
      input.capacity ?? null,
      0,
      input.zone ?? null,
      sortOrder,
      input.saleStartAt ?? null,
      input.saleEndAt ?? null,
      input.minPerOrder ?? 1,
      input.maxPerOrder ?? 10,
      true,
      input.transferable ?? true,
    ],
  );

  return rowToTicketType(rows[0]!);
}

export async function updateTicketType(
  ticketTypeId: string,
  promoterId: string,
  input: UpdateTicketTypeInput,
  deps: ServiceDeps,
): Promise<TicketType> {
  // Načíst typ vstupenky + ověřit vlastnictví přes event
  const ttRows = await deps.db.query<TicketTypeRow & { promoter_id: string }>(
    `SELECT
       tt.id, tt.event_id, tt.name, tt.description, tt.price_halire,
       tt.capacity, tt.sold_count, tt.zone, tt.sort_order,
       tt.sale_start_at, tt.sale_end_at, tt.min_per_order,
       tt.max_per_order, tt.is_active, tt.transferable, tt.created_at,
       e.promoter_id
     FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id
     WHERE tt.id = $1`,
    [ticketTypeId],
  );

  if (ttRows.length === 0) {
    throw new EventManagementError(
      'TICKET_TYPE_NOT_FOUND',
      `Typ vstupenky ${ticketTypeId} nebyl nalezen.`,
    );
  }

  const ttRow = ttRows[0]!;

  if (ttRow.promoter_id !== promoterId) {
    throw new EventManagementError(
      'TICKET_TYPE_NOT_FOUND',
      `Typ vstupenky ${ticketTypeId} nebyl nalezen.`,
    );
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let pidx = 1;

  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    priceHalire: 'price_halire',
    capacity: 'capacity',
    zone: 'zone',
    sortOrder: 'sort_order',
    saleStartAt: 'sale_start_at',
    saleEndAt: 'sale_end_at',
    minPerOrder: 'min_per_order',
    maxPerOrder: 'max_per_order',
    isActive: 'is_active',
    transferable: 'transferable',
  };

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = (input as Record<string, unknown>)[key];
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${pidx}`);
      params.push(val);
      pidx++;
    }
  }

  if (setClauses.length === 0) {
    return rowToTicketType(ttRow);
  }

  params.push(ticketTypeId);

  const updatedRows = await deps.db.query<TicketTypeRow>(
    `UPDATE catalog.ticket_types
     SET ${setClauses.join(', ')}
     WHERE id = $${pidx}
     RETURNING
       id, event_id, name, description, price_halire, capacity, sold_count,
       zone, sort_order, sale_start_at, sale_end_at, min_per_order,
       max_per_order, is_active, transferable, created_at`,
    params,
  );

  return rowToTicketType(updatedRows[0]!);
}

export async function deleteTicketType(
  ticketTypeId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const ttRows = await deps.db.query<TicketTypeRow & { promoter_id: string }>(
    `SELECT
       tt.id, tt.event_id, tt.name, tt.description, tt.price_halire,
       tt.capacity, tt.sold_count, tt.zone, tt.sort_order,
       tt.sale_start_at, tt.sale_end_at, tt.min_per_order,
       tt.max_per_order, tt.is_active, tt.transferable, tt.created_at,
       e.promoter_id
     FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id
     WHERE tt.id = $1`,
    [ticketTypeId],
  );

  if (ttRows.length === 0) {
    throw new EventManagementError(
      'TICKET_TYPE_NOT_FOUND',
      `Typ vstupenky ${ticketTypeId} nebyl nalezen.`,
    );
  }

  const ttRow = ttRows[0]!;

  if (ttRow.promoter_id !== promoterId) {
    throw new EventManagementError(
      'TICKET_TYPE_NOT_FOUND',
      `Typ vstupenky ${ticketTypeId} nebyl nalezen.`,
    );
  }

  if (ttRow.sold_count > 0) {
    throw new EventManagementError(
      'TICKET_TYPE_HAS_SALES',
      `Typ vstupenky ${ticketTypeId} nelze smazat — bylo prodáno ${ttRow.sold_count} vstupenek.`,
    );
  }

  await deps.db.execute(
    `DELETE FROM catalog.ticket_types WHERE id = $1`,
    [ticketTypeId],
  );
}

export async function reorderTicketTypes(
  eventId: string,
  promoterId: string,
  orderedIds: string[],
  deps: ServiceDeps,
): Promise<TicketType[]> {
  // Ověřit vlastnictví
  await loadEventOrThrow(eventId, promoterId, deps.db);

  // Aktualizovat sort_order pro každý ID
  for (let i = 0; i < orderedIds.length; i++) {
    await deps.db.execute(
      `UPDATE catalog.ticket_types
       SET sort_order = $1
       WHERE id = $2 AND event_id = $3`,
      [i, orderedIds[i], eventId],
    );
  }

  return loadTicketTypesForEvent(eventId, deps.db);
}

// ─── Public queries (bez autentifikace) ──────────────────────────────────────

export async function getPublicEvent(
  eventId: string,
  deps: ServiceDeps,
): Promise<EventWithTicketTypes | null> {
  const rows = await deps.db.query<EventRow>(
    `SELECT
       id, promoter_id, venue_id, title, description, category, subcategory,
       image_url, date_start, date_end, status, capacity, sold_count,
       on_sale_at, off_sale_at, resale_allowed, resale_commission_rate,
       re_entry_allowed, tags, metadata, created_at, updated_at
     FROM catalog.events
     WHERE id = $1
       AND status = 'published'`,
    [eventId],
  );

  if (rows.length === 0) {
    return null;
  }

  const event = rowToEvent(rows[0]!);

  // Pouze aktivní typy vstupenek pro veřejné API
  const ttRows = await deps.db.query<TicketTypeRow>(
    `SELECT
       id, event_id, name, description, price_halire, capacity, sold_count,
       zone, sort_order, sale_start_at, sale_end_at, min_per_order,
       max_per_order, is_active, transferable, created_at
     FROM catalog.ticket_types
     WHERE event_id = $1
       AND is_active = TRUE
     ORDER BY sort_order ASC, created_at ASC`,
    [eventId],
  );

  const ticketTypes = ttRows.map(rowToTicketType);
  return buildEventWithTicketTypes(event, ticketTypes);
}

export async function listPublicEvents(
  filters: { category?: string; city?: string; from?: Date; to?: Date; search?: string },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: EventListItem[]; total: number }> {
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;

  const params: unknown[] = [];
  const conditions: string[] = [
    "e.status = 'published'",
    'e.date_start > NOW()',
  ];
  let p = 1;

  if (filters.category) {
    conditions.push(`e.category = $${p}`);
    params.push(filters.category);
    p++;
  }

  if (filters.city) {
    conditions.push(`v.city = $${p}`);
    params.push(filters.city);
    p++;
  }

  if (filters.from) {
    conditions.push(`e.date_start >= $${p}`);
    params.push(filters.from);
    p++;
  }

  if (filters.to) {
    conditions.push(`e.date_start <= $${p}`);
    params.push(filters.to);
    p++;
  }

  if (filters.search) {
    conditions.push(`e.title ILIKE $${p}`);
    params.push(`%${filters.search}%`);
    p++;
  }

  const whereClause = conditions.join(' AND ');

  const baseQuery = `
    FROM catalog.events e
    LEFT JOIN catalog.venues v ON v.id = e.venue_id
    WHERE ${whereClause}
  `;

  const [countRows, itemRows] = await Promise.all([
    deps.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total ${baseQuery}`,
      params,
    ),
    deps.db.query<EventListRow>(
      `SELECT
         e.id, e.promoter_id, e.venue_id, e.title, e.description, e.category,
         e.subcategory, e.image_url, e.date_start, e.date_end, e.status,
         e.capacity, e.sold_count, e.on_sale_at, e.off_sale_at,
         e.resale_allowed, e.resale_commission_rate, e.re_entry_allowed,
         e.tags, e.metadata, e.created_at, e.updated_at,
         v.name AS venue_name,
         (
           SELECT COUNT(*)::text
           FROM catalog.ticket_types tt
           WHERE tt.event_id = e.id AND tt.is_active = TRUE
         ) AS ticket_type_count
       ${baseQuery}
       ORDER BY e.date_start ASC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset],
    ),
  ]);

  return {
    items: itemRows.map(rowToEventListItem),
    total: parseInt(countRows[0]?.total ?? '0', 10),
  };
}

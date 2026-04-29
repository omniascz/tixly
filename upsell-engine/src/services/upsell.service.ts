import type { ServiceDeps, DbAdapter } from '../lib/service-container.js';
import type {
  UpsellItemPublic,
  UpsellItemOrganizer,
  UpsellItemRow,
  UpsellRuleRow,
  UpsellOrderItemRow,
  UpsellInventoryRow,
  KafkaUpsellPurchasedEvent,
  KafkaUpsellInventoryLowEvent,
  UpsellTiming,
} from '../types/upsell.js';
import { UpsellError } from '../lib/upsell-errors.js';
import { getAvailableUpsells } from '../lib/filtering-pipeline.js';
import {
  lockAndGetInventory,
  assertSufficientInventory,
  reserveInventory,
  releaseReservation,
  getInventoryAfterReservation,
} from './upsell-inventory.service.js';
import type { CreateUpsellItemInput, UpdateUpsellItemInput } from '../lib/zod-schemas.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GetAvailableUpsellsParams {
  eventId: string;
  ticketTypeId?: string;
  timing: UpsellTiming;
  userId?: string;
  orderId?: string;
}

interface AddUpsellItemInput {
  upsellItemId: string;
  quantity: number;
  ticketId?: string;
  variantMetadata?: Record<string, unknown>;
}

interface AddUpsellsToOrderResult {
  orderItems: UpsellOrderItemRow[];
}

// ─── Analytics ────────────────────────────────────────────────────────────────

async function recordAnalytics(
  upsellItemId: string,
  eventType: string,
  userId: string | null,
  orderId: string | null,
  metadata: Record<string, unknown>,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `INSERT INTO upsell.upsell_analytics
       (upsell_item_id, event_type, user_id, order_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [upsellItemId, eventType, userId ?? null, orderId ?? null, JSON.stringify(metadata)],
  );
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function getAvailableUpsellsWithAnalytics(
  params: GetAvailableUpsellsParams,
  deps: ServiceDeps,
): Promise<UpsellItemPublic[]> {
  const items = await getAvailableUpsells(
    {
      eventId: params.eventId,
      ticketTypeId: params.ticketTypeId,
      timing: params.timing,
      userId: params.userId,
      orderId: params.orderId,
    },
    deps,
  );

  // Fire-and-forget impression tracking
  for (const item of items) {
    recordAnalytics(
      item.id,
      'impression',
      params.userId ?? null,
      params.orderId ?? null,
      { timing: params.timing, ticketTypeId: params.ticketTypeId ?? null },
      deps.db,
    ).catch(() => {
      // Analytics failures must not affect main flow
    });
  }

  return items;
}

export async function addUpsellsToOrder(
  orderId: string,
  items: AddUpsellItemInput[],
  idempotencyKey: string,
  userId: string,
  deps: ServiceDeps,
): Promise<AddUpsellsToOrderResult> {
  // Idempotency check — outside transaction for quick short-circuit
  const existing = await deps.db.query<UpsellOrderItemRow>(
    `SELECT * FROM upsell.upsell_order_items WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  if (existing.length > 0) {
    throw new UpsellError('DUPLICATE_UPSELL', 'Request with this idempotency key already processed', 409);
  }

  const now = new Date().toISOString();

  const createdItems = await deps.db.transaction(async (tx) => {
    const results: UpsellOrderItemRow[] = [];

    for (const item of items) {
      // Load upsell item
      const upsellRows = await tx.query<UpsellItemRow & { event_id: string }>(
        `SELECT * FROM upsell.upsell_items WHERE id = $1 AND status = 'active'`,
        [item.upsellItemId],
      );
      if (upsellRows.length === 0) {
        throw new UpsellError('UPSELL_NOT_FOUND', `Upsell item ${item.upsellItemId} not found`, 404);
      }
      const upsellItem = upsellRows[0];

      // Load and validate rules for this upsell
      const ruleRows = await tx.query<UpsellRuleRow>(
        `SELECT * FROM upsell.upsell_rules
         WHERE upsell_item_id = $1 AND is_active = TRUE`,
        [item.upsellItemId],
      );

      if (ruleRows.length === 0) {
        throw new UpsellError('UPSELL_NOT_AVAILABLE', `No active rules for upsell ${item.upsellItemId}`, 422);
      }

      // Time window check
      const applicableRule = ruleRows.find((r) => {
        const fromOk = !r.available_from || new Date(r.available_from) <= new Date(now);
        const untilOk = !r.available_until || new Date(r.available_until) >= new Date(now);
        return fromOk && untilOk;
      });

      if (!applicableRule) {
        throw new UpsellError('TIME_WINDOW_CLOSED', `Upsell ${item.upsellItemId} is outside its available time window`, 422);
      }

      // Max per order check
      if (applicableRule.max_per_order !== null && item.quantity > applicableRule.max_per_order) {
        throw new UpsellError(
          'MAX_PER_ORDER_EXCEEDED',
          `Max ${applicableRule.max_per_order} of this upsell allowed per order`,
          422,
        );
      }

      // Lock inventory row and check capacity
      const inv = await lockAndGetInventory(item.upsellItemId, tx);
      assertSufficientInventory(inv, item.quantity);

      // Reserve inventory
      await reserveInventory(item.upsellItemId, item.quantity, tx);

      // Calculate financials — all integer haléře, no floats
      const unitPrice = upsellItem.price;
      const totalPrice = unitPrice * item.quantity;
      const platformFeeAmt = Math.floor((totalPrice * upsellItem.platform_fee_pct) / 100);
      const organizerPayout = totalPrice - platformFeeAmt;

      // Insert order item
      const inserted = await tx.query<UpsellOrderItemRow>(
        `INSERT INTO upsell.upsell_order_items
           (order_id, ticket_id, upsell_item_id, quantity, unit_price, total_price,
            platform_fee_pct, platform_fee_amt, organizer_payout, status, idempotency_key, variant_metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11)
         RETURNING *`,
        [
          orderId,
          item.ticketId ?? null,
          item.upsellItemId,
          item.quantity,
          unitPrice,
          totalPrice,
          upsellItem.platform_fee_pct,
          platformFeeAmt,
          organizerPayout,
          idempotencyKey,
          JSON.stringify(item.variantMetadata ?? {}),
        ],
      );

      results.push(inserted[0]);

      // Record conversion analytics (fire-and-forget inside transaction is acceptable)
      await recordAnalytics(
        item.upsellItemId,
        'conversion',
        userId,
        orderId,
        { quantity: item.quantity, totalPrice },
        tx,
      );
    }

    return results;
  });

  // Post-transaction: emit Kafka events and low-inventory alerts
  for (const orderItem of createdItems) {
    const upsellRows = await deps.db.query<UpsellItemRow & { event_id: string }>(
      `SELECT * FROM upsell.upsell_items WHERE id = $1`,
      [orderItem.upsell_item_id],
    );

    if (upsellRows.length > 0) {
      const upsellItem = upsellRows[0];

      const kafkaPayload: KafkaUpsellPurchasedEvent = {
        eventType: 'upsell.purchased',
        orderId,
        ticketId: orderItem.ticket_id,
        upsellItemId: orderItem.upsell_item_id,
        upsellType: upsellItem.type,
        userId,
        eventId: upsellItem.event_id,
        quantity: orderItem.quantity,
        totalPrice: orderItem.total_price,
        timestamp: new Date().toISOString(),
      };

      await deps.kafka.send('upsell.purchased', kafkaPayload);

      // Low inventory alert
      const inv = await getInventoryAfterReservation(orderItem.upsell_item_id, deps.db);
      if (inv && inv.total_qty !== null) {
        const remaining = inv.total_qty - inv.sold_count - inv.reserved_count;
        if (remaining <= inv.low_threshold) {
          const lowPayload: KafkaUpsellInventoryLowEvent = {
            eventType: 'upsell.inventory.low',
            upsellItemId: orderItem.upsell_item_id,
            eventId: upsellItem.event_id,
            remaining,
          };
          await deps.kafka.send('upsell.inventory.low', lowPayload);
        }
      }
    }
  }

  return { orderItems: createdItems };
}

export async function removeUpsellFromOrder(
  orderId: string,
  upsellOrderItemId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const rows = await tx.query<UpsellOrderItemRow>(
      `SELECT * FROM upsell.upsell_order_items WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [upsellOrderItemId, orderId],
    );

    if (rows.length === 0) {
      throw new UpsellError('ORDER_NOT_FOUND', 'Upsell order item not found', 404);
    }

    const orderItem = rows[0];

    if (orderItem.status !== 'pending') {
      throw new UpsellError(
        'UPSELL_NOT_AVAILABLE',
        `Cannot cancel upsell order item with status '${orderItem.status}'`,
        422,
      );
    }

    // Release inventory reservation
    await releaseReservation(orderItem.upsell_item_id, orderItem.quantity, tx);

    // Mark as cancelled
    await tx.execute(
      `UPDATE upsell.upsell_order_items SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [upsellOrderItemId],
    );

    // Record refund analytics
    await recordAnalytics(
      orderItem.upsell_item_id,
      'refund',
      userId,
      orderId,
      { upsellOrderItemId },
      tx,
    );
  });
}

// ─── Organizer functions ──────────────────────────────────────────────────────

export async function getOrganizerUpsells(
  eventId: string,
  deps: Pick<ServiceDeps, 'db'>,
): Promise<UpsellItemOrganizer[]> {
  const itemRows = await deps.db.query<UpsellItemRow>(
    `SELECT * FROM upsell.upsell_items WHERE event_id = $1 AND status != 'archived' ORDER BY created_at ASC`,
    [eventId],
  );

  if (itemRows.length === 0) return [];

  const itemIds = itemRows.map((r) => r.id);

  const ruleRows = await deps.db.query<UpsellRuleRow>(
    `SELECT * FROM upsell.upsell_rules WHERE upsell_item_id = ANY($1) ORDER BY sort_order ASC`,
    [itemIds],
  );

  const invRows = await deps.db.query<UpsellInventoryRow>(
    `SELECT * FROM upsell.upsell_inventory WHERE upsell_item_id = ANY($1)`,
    [itemIds],
  );

  const rulesByItemId = new Map<string, UpsellRuleRow[]>();
  for (const rule of ruleRows) {
    const list = rulesByItemId.get(rule.upsell_item_id) ?? [];
    list.push(rule);
    rulesByItemId.set(rule.upsell_item_id, list);
  }

  const invByItemId = new Map<string, UpsellInventoryRow>();
  for (const inv of invRows) {
    invByItemId.set(inv.upsell_item_id, inv);
  }

  return itemRows.map((item): UpsellItemOrganizer => {
    const inv = invByItemId.get(item.id);
    const rules = rulesByItemId.get(item.id) ?? [];
    const totalQty = inv?.total_qty ?? null;
    const soldCount = inv?.sold_count ?? 0;
    const reservedCount = inv?.reserved_count ?? 0;
    const lowThreshold = inv?.low_threshold ?? 5;
    const remainingQty = totalQty !== null ? totalQty - soldCount - reservedCount : null;
    const isLowStock = remainingQty !== null && remainingQty <= lowThreshold;

    return {
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
      price: item.price,
      currency: item.currency,
      imageUrl: item.image_url,
      metadata: item.metadata,
      remainingQty,
      isLowStock,
      status: item.status,
      platformFeePct: item.platform_fee_pct,
      totalQty,
      soldCount,
      reservedCount,
      rules: rules.map((r) => ({
        id: r.id,
        ticketTypeId: r.ticket_type_id,
        timing: r.timing,
        sortOrder: r.sort_order,
        maxPerOrder: r.max_per_order,
        availableFrom: r.available_from,
        availableUntil: r.available_until,
        exclusiveToTicketTypes: r.exclusive_to_ticket_types ?? [],
        isActive: r.is_active,
      })),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  });
}

export async function createOrganizerUpsell(
  eventId: string,
  input: CreateUpsellItemInput,
  deps: Pick<ServiceDeps, 'db'>,
): Promise<UpsellItemOrganizer> {
  return deps.db.transaction(async (tx) => {
    // Insert item
    const itemRows = await tx.query<UpsellItemRow>(
      `INSERT INTO upsell.upsell_items
         (event_id, type, name, description, price, currency, platform_fee_pct, image_url, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, 10, $7, $8, 'active')
       RETURNING *`,
      [
        eventId,
        input.type,
        input.name,
        input.description ?? null,
        input.price,
        input.currency ?? 'CZK',
        input.imageUrl ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    const item = itemRows[0];

    // Insert rules
    const insertedRules: UpsellRuleRow[] = [];
    for (const rule of input.rules) {
      const ruleRows = await tx.query<UpsellRuleRow>(
        `INSERT INTO upsell.upsell_rules
           (upsell_item_id, ticket_type_id, timing, sort_order, max_per_order,
            available_from, available_until, exclusive_to_ticket_types, conditions, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
         RETURNING *`,
        [
          item.id,
          rule.ticketTypeId ?? null,
          rule.timing,
          rule.sortOrder ?? 100,
          rule.maxPerOrder ?? null,
          rule.availableFrom ?? null,
          rule.availableUntil ?? null,
          rule.exclusiveToTicketTypes ?? [],
          JSON.stringify(rule.conditions ?? {}),
        ],
      );
      insertedRules.push(ruleRows[0]);
    }

    // Insert inventory
    const invRows = await tx.query<UpsellInventoryRow>(
      `INSERT INTO upsell.upsell_inventory
         (upsell_item_id, total_qty, sold_count, reserved_count, low_threshold)
       VALUES ($1, $2, 0, 0, $3)
       RETURNING *`,
      [item.id, input.totalQty ?? null, input.lowThreshold ?? 5],
    );
    const inv = invRows[0];

    const remainingQty = inv.total_qty !== null ? inv.total_qty - inv.sold_count - inv.reserved_count : null;
    const isLowStock = remainingQty !== null && remainingQty <= inv.low_threshold;

    return {
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
      price: item.price,
      currency: item.currency,
      imageUrl: item.image_url,
      metadata: item.metadata,
      remainingQty,
      isLowStock,
      status: item.status,
      platformFeePct: item.platform_fee_pct,
      totalQty: inv.total_qty,
      soldCount: inv.sold_count,
      reservedCount: inv.reserved_count,
      rules: insertedRules.map((r) => ({
        id: r.id,
        ticketTypeId: r.ticket_type_id,
        timing: r.timing,
        sortOrder: r.sort_order,
        maxPerOrder: r.max_per_order,
        availableFrom: r.available_from,
        availableUntil: r.available_until,
        exclusiveToTicketTypes: r.exclusive_to_ticket_types ?? [],
        isActive: r.is_active,
      })),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  });
}

export async function updateOrganizerUpsell(
  eventId: string,
  upsellItemId: string,
  input: UpdateUpsellItemInput,
  deps: Pick<ServiceDeps, 'db'>,
): Promise<UpsellItemOrganizer> {
  return deps.db.transaction(async (tx) => {
    // Verify ownership
    const existing = await tx.query<UpsellItemRow>(
      `SELECT * FROM upsell.upsell_items WHERE id = $1 AND event_id = $2 AND status != 'archived'`,
      [upsellItemId, eventId],
    );
    if (existing.length === 0) {
      throw new UpsellError('UPSELL_NOT_FOUND', 'Upsell item not found', 404);
    }

    // Build update
    const updates: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let idx = 1;

    if (input.name !== undefined) { updates.push(`name = $${idx++}`); params.push(input.name); }
    if (input.description !== undefined) { updates.push(`description = $${idx++}`); params.push(input.description); }
    if (input.price !== undefined) { updates.push(`price = $${idx++}`); params.push(input.price); }
    if (input.currency !== undefined) { updates.push(`currency = $${idx++}`); params.push(input.currency); }
    if (input.imageUrl !== undefined) { updates.push(`image_url = $${idx++}`); params.push(input.imageUrl); }
    if (input.metadata !== undefined) { updates.push(`metadata = $${idx++}`); params.push(JSON.stringify(input.metadata)); }

    params.push(upsellItemId);
    const itemRows = await tx.query<UpsellItemRow>(
      `UPDATE upsell.upsell_items SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    );
    const item = itemRows[0];

    // Update inventory if qty params provided
    if (input.totalQty !== undefined || input.lowThreshold !== undefined) {
      const invUpdates: string[] = ['updated_at = NOW()'];
      const invParams: unknown[] = [];
      let invIdx = 1;

      if (input.totalQty !== undefined) { invUpdates.push(`total_qty = $${invIdx++}`); invParams.push(input.totalQty); }
      if (input.lowThreshold !== undefined) { invUpdates.push(`low_threshold = $${invIdx++}`); invParams.push(input.lowThreshold); }

      invParams.push(upsellItemId);
      await tx.execute(
        `UPDATE upsell.upsell_inventory SET ${invUpdates.join(', ')} WHERE upsell_item_id = $${invIdx}`,
        invParams,
      );
    }

    // Replace rules if provided
    if (input.rules !== undefined) {
      await tx.execute(`DELETE FROM upsell.upsell_rules WHERE upsell_item_id = $1`, [upsellItemId]);

      for (const rule of input.rules) {
        await tx.execute(
          `INSERT INTO upsell.upsell_rules
             (upsell_item_id, ticket_type_id, timing, sort_order, max_per_order,
              available_from, available_until, exclusive_to_ticket_types, conditions, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)`,
          [
            upsellItemId,
            rule.ticketTypeId ?? null,
            rule.timing,
            rule.sortOrder ?? 100,
            rule.maxPerOrder ?? null,
            rule.availableFrom ?? null,
            rule.availableUntil ?? null,
            rule.exclusiveToTicketTypes ?? [],
            JSON.stringify(rule.conditions ?? {}),
          ],
        );
      }
    }

    // Fetch final state
    const invRows = await tx.query<UpsellInventoryRow>(
      `SELECT * FROM upsell.upsell_inventory WHERE upsell_item_id = $1`,
      [upsellItemId],
    );
    const ruleRows = await tx.query<UpsellRuleRow>(
      `SELECT * FROM upsell.upsell_rules WHERE upsell_item_id = $1 ORDER BY sort_order ASC`,
      [upsellItemId],
    );

    const inv = invRows[0];
    const totalQty = inv?.total_qty ?? null;
    const soldCount = inv?.sold_count ?? 0;
    const reservedCount = inv?.reserved_count ?? 0;
    const lowThreshold = inv?.low_threshold ?? 5;
    const remainingQty = totalQty !== null ? totalQty - soldCount - reservedCount : null;

    return {
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
      price: item.price,
      currency: item.currency,
      imageUrl: item.image_url,
      metadata: item.metadata,
      remainingQty,
      isLowStock: remainingQty !== null && remainingQty <= lowThreshold,
      status: item.status,
      platformFeePct: item.platform_fee_pct,
      totalQty,
      soldCount,
      reservedCount,
      rules: ruleRows.map((r) => ({
        id: r.id,
        ticketTypeId: r.ticket_type_id,
        timing: r.timing,
        sortOrder: r.sort_order,
        maxPerOrder: r.max_per_order,
        availableFrom: r.available_from,
        availableUntil: r.available_until,
        exclusiveToTicketTypes: r.exclusive_to_ticket_types ?? [],
        isActive: r.is_active,
      })),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  });
}

export async function archiveOrganizerUpsell(
  eventId: string,
  upsellItemId: string,
  deps: Pick<ServiceDeps, 'db'>,
): Promise<void> {
  const rows = await deps.db.query<{ id: string }>(
    `UPDATE upsell.upsell_items
     SET status = 'archived', updated_at = NOW()
     WHERE id = $1 AND event_id = $2 AND status != 'archived'
     RETURNING id`,
    [upsellItemId, eventId],
  );

  if (rows.length === 0) {
    throw new UpsellError('UPSELL_NOT_FOUND', 'Upsell item not found', 404);
  }
}

// ─── Analytics aggregation ────────────────────────────────────────────────────

export interface UpsellAnalyticsSummary {
  upsellItemId: string;
  impressions: number;
  clicks: number;
  conversions: number;
  refunds: number;
  revenue: number;
}

export async function getUpsellAnalytics(
  eventId: string,
  deps: Pick<ServiceDeps, 'db'>,
): Promise<UpsellAnalyticsSummary[]> {
  const rows = await deps.db.query<{
    upsell_item_id: string;
    event_type: string;
    count: string;
  }>(
    `SELECT ua.upsell_item_id, ua.event_type, COUNT(*) AS count
     FROM upsell.upsell_analytics ua
     JOIN upsell.upsell_items ui ON ui.id = ua.upsell_item_id
     WHERE ui.event_id = $1
     GROUP BY ua.upsell_item_id, ua.event_type`,
    [eventId],
  );

  const revenueRows = await deps.db.query<{ upsell_item_id: string; revenue: string }>(
    `SELECT uoi.upsell_item_id, SUM(uoi.total_price) AS revenue
     FROM upsell.upsell_order_items uoi
     JOIN upsell.upsell_items ui ON ui.id = uoi.upsell_item_id
     WHERE ui.event_id = $1 AND uoi.status = 'paid'
     GROUP BY uoi.upsell_item_id`,
    [eventId],
  );

  const revenueMap = new Map<string, number>();
  for (const r of revenueRows) {
    revenueMap.set(r.upsell_item_id, parseInt(r.revenue, 10));
  }

  const summaryMap = new Map<string, UpsellAnalyticsSummary>();

  for (const row of rows) {
    if (!summaryMap.has(row.upsell_item_id)) {
      summaryMap.set(row.upsell_item_id, {
        upsellItemId: row.upsell_item_id,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        refunds: 0,
        revenue: revenueMap.get(row.upsell_item_id) ?? 0,
      });
    }

    const summary = summaryMap.get(row.upsell_item_id)!;
    const count = parseInt(row.count, 10);

    switch (row.event_type) {
      case 'impression': summary.impressions = count; break;
      case 'click': summary.clicks = count; break;
      case 'conversion': summary.conversions = count; break;
      case 'refund': summary.refunds = count; break;
    }
  }

  return Array.from(summaryMap.values());
}

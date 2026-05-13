// =============================================================================
// Multichannel distribuce — Feature #55
//
// Inventory sync s Goout a SMSticket jako distribuční kanály.
// Pořadatel přidělí část inventory externímu kanálu; systém synchronizuje
// dostupnost v reálném čase (push) a stahuje prodeje (pull).
//
// SCHEMA: channels.* (migration 112)
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelId = 'goout' | 'smsticket' | string;
export type AllocationStatus = 'draft' | 'active' | 'paused' | 'closed';
export type SyncDirection = 'push' | 'pull';
export type SyncStatus = 'ok' | 'error';

export interface ChannelAllocation {
  id: string;
  eventId: string;
  promoterId: string;
  channelId: ChannelId;
  allocatedQty: number;
  soldQty: number;
  availableQty: number;         // derived: allocatedQty - soldQty
  priceOverrideHalire: number | null;
  externalEventId: string | null;
  status: AllocationStatus;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAllocationInput {
  channelId: ChannelId;
  allocatedQty: number;
  priceOverrideHalire?: number;
}

export interface UpdateAllocationInput {
  allocatedQty?: number;
  priceOverrideHalire?: number | null;
  status?: AllocationStatus;
  externalEventId?: string;
}

export interface SyncResult {
  allocationId: string;
  direction: SyncDirection;
  status: SyncStatus;
  deltaQty?: number;            // pull: počet nově zjištěných prodejů
  errorMessage?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// External channel adapter (injectable for testing)
// ---------------------------------------------------------------------------

export interface ChannelAdapter {
  /** Push aktuální dostupnost na cizí platformu. Vrátí external event ID. */
  pushAvailability(
    externalEventId: string | null,
    availableQty: number,
    priceHalire: number | null,
    meta: Record<string, unknown>,
  ): Promise<{ externalEventId: string }>;

  /** Pull počet prodaných vstupenek z cizí platformy. */
  pullSoldQty(externalEventId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface AllocationRow {
  id: string;
  event_id: string;
  promoter_id: string;
  channel_id: string;
  allocated_qty: number;
  sold_qty: number;
  price_override_halire: number | null;
  external_event_id: string | null;
  status: AllocationStatus;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapAllocation(row: AllocationRow): ChannelAllocation {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    channelId: row.channel_id,
    allocatedQty: row.allocated_qty,
    soldQty: row.sold_qty,
    availableQty: row.allocated_qty - row.sold_qty,
    priceOverrideHalire: row.price_override_halire,
    externalEventId: row.external_event_id,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Vytvoří alokaci inventory pro distribuční kanál.
 * Jedinečnost zajišťuje UNIQUE(event_id, channel_id).
 */
export async function createAllocation(
  eventId: string,
  promoterId: string,
  input: CreateAllocationInput,
  db: DbAdapter,
): Promise<ChannelAllocation> {
  if (input.allocatedQty < 0) {
    throw new Error('VALIDATION_ERROR: allocatedQty must be >= 0');
  }
  const rows = await db.query<AllocationRow>(
    `INSERT INTO channels.event_channel_allocations
       (event_id, promoter_id, channel_id, allocated_qty, price_override_halire)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      eventId,
      promoterId,
      input.channelId,
      input.allocatedQty,
      input.priceOverrideHalire ?? null,
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: allocation insert failed');
  return mapAllocation(rows[0]);
}

/** Aktualizuje alokaci. Tenant-scoped na promoter_id. */
export async function updateAllocation(
  allocationId: string,
  promoterId: string,
  input: UpdateAllocationInput,
  db: DbAdapter,
): Promise<ChannelAllocation> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [allocationId, promoterId];

  if (input.allocatedQty !== undefined) {
    if (input.allocatedQty < 0) throw new Error('VALIDATION_ERROR: allocatedQty must be >= 0');
    params.push(input.allocatedQty);
    setClauses.push(`allocated_qty = $${params.length}`);
  }
  if (input.priceOverrideHalire !== undefined) {
    params.push(input.priceOverrideHalire);
    setClauses.push(`price_override_halire = $${params.length}`);
  }
  if (input.status !== undefined) {
    params.push(input.status);
    setClauses.push(`status = $${params.length}`);
  }
  if (input.externalEventId !== undefined) {
    params.push(input.externalEventId);
    setClauses.push(`external_event_id = $${params.length}`);
  }

  const rows = await db.query<AllocationRow>(
    `UPDATE channels.event_channel_allocations
     SET ${setClauses.join(', ')}
     WHERE id = $1 AND promoter_id = $2  -- tenant-scoped
     RETURNING *`,
    params,
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Allocation not found');
  return mapAllocation(rows[0]);
}

/** Vrátí všechny alokace pro akci (tenant-scoped). */
export async function listAllocations(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<ChannelAllocation[]> {
  const rows = await db.query<AllocationRow>(
    `SELECT * FROM channels.event_channel_allocations
     WHERE event_id = $1 AND promoter_id = $2
     ORDER BY created_at`,
    [eventId, promoterId],
  );
  return rows.map(mapAllocation);
}

/**
 * Push — synchronizuje dostupné množství na externí kanál.
 * Uloží výsledek do sync_log.
 */
export async function pushToChannel(
  allocationId: string,
  promoterId: string,
  channelAdapter: ChannelAdapter,
  db: DbAdapter,
): Promise<SyncResult> {
  const allocs = await db.query<AllocationRow>(
    `SELECT * FROM channels.event_channel_allocations
     WHERE id = $1 AND promoter_id = $2 AND status = 'active'`,
    [allocationId, promoterId],
  );
  if (!allocs[0]) {
    throw new Error('NOT_FOUND: Active allocation not found');
  }
  const alloc = allocs[0];
  const available = alloc.allocated_qty - alloc.sold_qty;
  const t0 = Date.now();

  let externalEventId = alloc.external_event_id;
  let syncStatus: SyncStatus = 'ok';
  let errorMessage: string | undefined;

  try {
    const result = await channelAdapter.pushAvailability(
      externalEventId,
      available,
      alloc.price_override_halire,
      { event_id: alloc.event_id, channel_id: alloc.channel_id },
    );
    externalEventId = result.externalEventId;
  } catch (err) {
    syncStatus = 'error';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - t0;

  await db.execute(
    `INSERT INTO channels.sync_log
       (allocation_id, direction, status, error_message, duration_ms)
     VALUES ($1, 'push', $2, $3, $4)`,
    [allocationId, syncStatus, errorMessage ?? null, durationMs],
  );

  if (syncStatus === 'ok' && externalEventId) {
    await db.execute(
      `UPDATE channels.event_channel_allocations
       SET external_event_id = $1, last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [externalEventId, allocationId],
    );
  }

  return { allocationId, direction: 'push', status: syncStatus, errorMessage, durationMs };
}

/**
 * Pull — stáhne počet prodejů z externího kanálu a aktualizuje sold_qty.
 * Používá transakci k atomické aktualizaci (zákazník nemůže přetáhnout alokaci).
 */
export async function pullFromChannel(
  allocationId: string,
  promoterId: string,
  channelAdapter: ChannelAdapter,
  db: DbAdapter,
): Promise<SyncResult> {
  const allocs = await db.query<AllocationRow>(
    `SELECT * FROM channels.event_channel_allocations
     WHERE id = $1 AND promoter_id = $2 AND status = 'active'`,
    [allocationId, promoterId],
  );
  if (!allocs[0]) throw new Error('NOT_FOUND: Active allocation not found');
  const alloc = allocs[0];
  if (!alloc.external_event_id) {
    throw new Error('VALIDATION_ERROR: No external_event_id — push first');
  }

  const t0 = Date.now();
  let soldQty = 0;
  let syncStatus: SyncStatus = 'ok';
  let errorMessage: string | undefined;
  let deltaQty: number | undefined;

  try {
    soldQty = await channelAdapter.pullSoldQty(alloc.external_event_id);
    if (soldQty > alloc.allocated_qty) {
      throw new Error(`OVERSELL: channel reports ${soldQty} sold but only ${alloc.allocated_qty} allocated`);
    }
    deltaQty = soldQty - alloc.sold_qty;
  } catch (err) {
    syncStatus = 'error';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - t0;

  await db.execute(
    `INSERT INTO channels.sync_log
       (allocation_id, direction, status, error_message, duration_ms)
     VALUES ($1, 'pull', $2, $3, $4)`,
    [allocationId, syncStatus, errorMessage ?? null, durationMs],
  );

  if (syncStatus === 'ok') {
    await db.execute(
      `UPDATE channels.event_channel_allocations
       SET sold_qty = $1, last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [soldQty, allocationId],
    );
  }

  return {
    allocationId,
    direction: 'pull',
    status: syncStatus,
    deltaQty,
    errorMessage,
    durationMs,
  };
}

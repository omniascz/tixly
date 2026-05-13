import { hashPresaleCode, validatePresaleAccess } from '../lib/presale-validator.js';
import { validateGeofence } from '../lib/geofence.js';
import type { PresaleConfig, PresaleValidationResult, GeofenceConfig } from '../types/presale.types.js';
import {
  PresaleNotConfiguredError,
  UnauthorizedPresaleError,
} from '../types/presale.types.js';

// ---------------------------------------------------------------------------
// Platform secret — never log or expose this value
// ---------------------------------------------------------------------------

const PLATFORM_SECRET =
  process.env['PLATFORM_SECRET'] ?? 'dev-secret-change-in-production';

// ---------------------------------------------------------------------------
// DB adapter interface — injected; never imported from ORM directly
// ---------------------------------------------------------------------------

export interface PresaleDbAdapter {
  /** Load presale configuration for a ticket type. Returns null if not configured. */
  findPresaleConfig(ticketTypeId: string): Promise<PresaleConfig | null>;

  /** Load basic ticket type info for sale window checks. */
  findTicketType(
    id: string,
  ): Promise<{ sale_start: Date; sale_end: Date; name: string } | null>;

  /**
   * Atomically increment the presale sold counter.
   * Must be called inside an open transaction (tx is passed through).
   */
  incrementPresaleSoldCount(ticketTypeId: string, tx: unknown): Promise<void>;

  /**
   * Persist a new or updated presale configuration.
   * Creates the row if it does not exist; updates it otherwise.
   */
  upsertPresaleConfig(config: PresaleConfig): Promise<PresaleConfig>;

  /**
   * Verify that the given organizer owns the event that contains this ticket type.
   * Returns the organizer ID if ownership confirmed, null otherwise.
   */
  findOrganizerForTicketType(ticketTypeId: string): Promise<string | null>;

  /** Execute a callback inside a serialisable transaction. */
  withTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// PresaleService
// ---------------------------------------------------------------------------

export class PresaleService {
  // -------------------------------------------------------------------------
  // validateAccess
  //
  // Validates a presale code for a given ticket type at the current moment.
  // Does NOT write to the database — call recordPresalePurchase after a
  // successful order is placed.
  // -------------------------------------------------------------------------

  async validateAccess(
    ticketTypeId: string,
    code: string,
    db: PresaleDbAdapter,
    now: Date = new Date(),
    headers?: Headers,
    geofenceConfig?: GeofenceConfig,
  ): Promise<PresaleValidationResult> {
    // 1. Geofence check (if configured and headers provided)
    if (geofenceConfig && headers) {
      validateGeofence(headers, geofenceConfig);
    }

    const config = await db.findPresaleConfig(ticketTypeId);
    if (config === null) {
      throw new PresaleNotConfiguredError(ticketTypeId);
    }

    const ticketType = await db.findTicketType(ticketTypeId);
    if (ticketType === null) {
      throw new PresaleNotConfiguredError(ticketTypeId);
    }

    return validatePresaleAccess(code, config, ticketType, now, PLATFORM_SECRET);
  }

  // -------------------------------------------------------------------------
  // createOrUpdatePresaleConfig
  //
  // Hashes the plain-text code immediately and persists only the hash.
  // The plain-text code is never stored or logged.
  // Verifies organizer ownership before persisting.
  // -------------------------------------------------------------------------

  async createOrUpdatePresaleConfig(
    ticketTypeId: string,
    organizerId: string,
    config: {
      presaleCode: string;
      presaleStart: Date;
      presaleEnd: Date;
      presaleCapacity?: number;
    },
    db: PresaleDbAdapter,
  ): Promise<PresaleConfig> {
    // 1. Ownership check
    const ownerOrganizerId = await db.findOrganizerForTicketType(ticketTypeId);
    if (ownerOrganizerId !== organizerId) {
      throw new UnauthorizedPresaleError();
    }

    // 2. Hash the plain-text code immediately — never store or log the raw value
    const presaleCodeHash = hashPresaleCode(config.presaleCode, PLATFORM_SECRET);

    // 3. Preserve existing sold count if config already exists
    const existing = await db.findPresaleConfig(ticketTypeId);

    const presaleConfig: PresaleConfig = {
      ticket_type_id: ticketTypeId,
      presale_code_hash: presaleCodeHash,
      presale_start: config.presaleStart,
      presale_end: config.presaleEnd,
      presale_capacity: config.presaleCapacity ?? null,
      presale_sold_count: existing?.presale_sold_count ?? 0,
    };

    return db.upsertPresaleConfig(presaleConfig);
  }

  // -------------------------------------------------------------------------
  // recordPresalePurchase
  //
  // Atomically increments presale_sold_count. Call this from the order
  // service after an order is successfully completed, inside the same
  // transaction that finalises the order.
  // -------------------------------------------------------------------------

  async recordPresalePurchase(
    ticketTypeId: string,
    db: PresaleDbAdapter,
  ): Promise<void> {
    await db.withTransaction(async (tx) => {
      await db.incrementPresaleSoldCount(ticketTypeId, tx);
    });
  }
}

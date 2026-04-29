// =============================================================================
// All-In Pricing Service — EU Regulatory Compliance
// Feature #35: Display total price (face value + fees + VAT) from first display
// All monetary values in halíře (1 CZK = 100 halíře)
// =============================================================================

export interface PriceTier {
  id: string;
  eventId: string;
  ticketTypeId?: string;
  faceValueHellers: number;
  platformFeeHellers: number;
  vatRate: number;
  vatHellers: number;
  totalHellers: number;
  createdAt: string;
  updatedAt: string;
}

export interface PriceBreakdown {
  faceValue: number;
  platformFee: number;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  currency: string;
}

export interface PricingConfig {
  id: string;
  promoterId: string;
  showBreakdown: boolean;
  showPlatformFee: boolean;
  showVat: boolean;
  hideVatValue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface PriceTierRow {
  id: string;
  event_id: string;
  ticket_type_id: string | null;
  face_value_hellers: number;
  platform_fee_hellers: number;
  vat_rate: number;
  vat_hellers: number;
  total_hellers: number;
  created_at: string;
  updated_at: string;
}

interface PricingConfigRow {
  id: string;
  promoter_id: string;
  show_breakdown: boolean;
  show_platform_fee: boolean;
  show_vat: boolean;
  hide_vat_value: boolean;
  created_at: string;
  updated_at: string;
}

function mapPriceTier(row: PriceTierRow): PriceTier {
  return {
    id: row.id,
    eventId: row.event_id,
    ticketTypeId: row.ticket_type_id || undefined,
    faceValueHellers: row.face_value_hellers,
    platformFeeHellers: row.platform_fee_hellers,
    vatRate: row.vat_rate,
    vatHellers: row.vat_hellers,
    totalHellers: row.total_hellers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPricingConfig(row: PricingConfigRow): PricingConfig {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    showBreakdown: row.show_breakdown,
    showPlatformFee: row.show_platform_fee,
    showVat: row.show_vat,
    hideVatValue: row.hide_vat_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Calculate all-in price including VAT.
 * Returns price breakdown for display.
 */
export function calculateTotalPrice(
  faceValueHellers: number,
  platformFeeHellers: number,
  vatRate: number = 21.0,
): PriceBreakdown {
  if (faceValueHellers < 0 || platformFeeHellers < 0) {
    throw new Error('VALIDATION_ERROR: prices must be non-negative');
  }

  const subtotal = faceValueHellers + platformFeeHellers;
  const vatAmount = Math.floor(subtotal * (vatRate / 100));
  const total = subtotal + vatAmount;

  return {
    faceValue: faceValueHellers,
    platformFee: platformFeeHellers,
    subtotal,
    vatRate,
    vatAmount,
    total,
    currency: 'CZK',
  };
}

/**
 * Get price breakdown for a specific ticket type in an event.
 */
export async function getPriceBreakdown(
  eventId: string,
  ticketTypeId: string,
  db: DbAdapter,
): Promise<PriceBreakdown | null> {
  const rows = await db.query<PriceTierRow>(
    `SELECT * FROM pricing.price_tiers
     WHERE event_id = $1 AND ticket_type_id = $2`,
    [eventId, ticketTypeId],
  );

  if (!rows[0]) return null;

  const tier = rows[0];
  return {
    faceValue: tier.face_value_hellers,
    platformFee: tier.platform_fee_hellers,
    subtotal: tier.face_value_hellers + tier.platform_fee_hellers,
    vatRate: tier.vat_rate,
    vatAmount: tier.vat_hellers,
    total: tier.total_hellers,
    currency: 'CZK',
  };
}

/**
 * Format price for UI display (all-in total shown first).
 * Includes optional breakdown text.
 */
export function formatPriceDisplay(
  breakdown: PriceBreakdown,
  showBreakdown: boolean = true,
): { total: string; breakdown?: string } {
  const czk = (hellers: number) => `${(hellers / 100).toFixed(2)} CZK`;

  const totalDisplay = czk(breakdown.total);

  let breakdownText = '';
  if (showBreakdown) {
    breakdownText = `(${czk(breakdown.faceValue)} + ${czk(breakdown.platformFee)} fee + ${czk(breakdown.vatAmount)} VAT)`;
  }

  return {
    total: totalDisplay,
    breakdown: breakdownText || undefined,
  };
}

/**
 * Create or update a price tier for a ticket type.
 */
export async function setOrUpdatePriceTier(
  eventId: string,
  ticketTypeId: string,
  faceValueHellers: number,
  platformFeeHellers: number,
  vatRate: number = 21.0,
  db: DbAdapter,
): Promise<PriceTier> {
  const breakdown = calculateTotalPrice(faceValueHellers, platformFeeHellers, vatRate);

  const rows = await db.query<PriceTierRow>(
    `INSERT INTO pricing.price_tiers
       (event_id, ticket_type_id, face_value_hellers, platform_fee_hellers, vat_rate, vat_hellers, total_hellers)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id, ticket_type_id)
     DO UPDATE SET
       face_value_hellers = $3,
       platform_fee_hellers = $4,
       vat_rate = $5,
       vat_hellers = $6,
       total_hellers = $7,
       updated_at = NOW()
     RETURNING *`,
    [
      eventId,
      ticketTypeId,
      faceValueHellers,
      platformFeeHellers,
      vatRate,
      breakdown.vatAmount,
      breakdown.total,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: price tier creation failed');
  return mapPriceTier(rows[0]);
}

/**
 * Get organizer's pricing display preferences.
 */
export async function getPricingConfig(
  promoterId: string,
  db: DbAdapter,
): Promise<PricingConfig | null> {
  const rows = await db.query<PricingConfigRow>(
    `SELECT * FROM pricing.organizer_pricing_config WHERE promoter_id = $1`,
    [promoterId],
  );
  return rows[0] ? mapPricingConfig(rows[0]) : null;
}

/**
 * Set organizer's pricing display preferences.
 */
export async function setPricingConfig(
  promoterId: string,
  config: Partial<Omit<PricingConfig, 'id' | 'promoterId' | 'createdAt' | 'updatedAt'>>,
  db: DbAdapter,
): Promise<PricingConfig> {
  const rows = await db.query<PricingConfigRow>(
    `INSERT INTO pricing.organizer_pricing_config
       (promoter_id, show_breakdown, show_platform_fee, show_vat, hide_vat_value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (promoter_id)
     DO UPDATE SET
       show_breakdown = COALESCE($2, show_breakdown),
       show_platform_fee = COALESCE($3, show_platform_fee),
       show_vat = COALESCE($4, show_vat),
       hide_vat_value = COALESCE($5, hide_vat_value),
       updated_at = NOW()
     RETURNING *`,
    [
      promoterId,
      config.showBreakdown !== undefined ? config.showBreakdown : true,
      config.showPlatformFee !== undefined ? config.showPlatformFee : true,
      config.showVat !== undefined ? config.showVat : true,
      config.hideVatValue !== undefined ? config.hideVatValue : false,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: pricing config failed');
  return mapPricingConfig(rows[0]);
}

/**
 * Get all price tiers for an event.
 */
export async function getEventPriceTiers(
  eventId: string,
  db: DbAdapter,
): Promise<PriceTier[]> {
  const rows = await db.query<PriceTierRow>(
    `SELECT * FROM pricing.price_tiers WHERE event_id = $1 ORDER BY created_at ASC`,
    [eventId],
  );
  return rows.map(mapPriceTier);
}

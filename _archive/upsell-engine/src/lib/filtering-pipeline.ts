import type { ServiceDeps } from './service-container.js';
import type {
  UpsellItemPublic,
  UpsellItemRow,
  UpsellRuleRow,
  UpsellInventoryRow,
} from '../types/upsell.js';
import type { UpsellTiming } from '../types/upsell.js';

interface PipelineParams {
  eventId: string;
  ticketTypeId?: string;
  timing: UpsellTiming;
  userId?: string;
  orderId?: string;
}

interface RawUpsellRow extends UpsellItemRow {
  rule_id: string;
  ticket_type_id: string | null;
  timing: UpsellTiming;
  sort_order: number;
  max_per_order: number | null;
  available_from: string | null;
  available_until: string | null;
  exclusive_to_ticket_types: string[];
  conditions: Record<string, unknown>;
  is_active: boolean;
  total_qty: number | null;
  sold_count: number;
  reserved_count: number;
  low_threshold: number;
}

export async function getAvailableUpsells(
  params: PipelineParams,
  deps: Pick<ServiceDeps, 'db'>,
): Promise<UpsellItemPublic[]> {
  const now = new Date().toISOString();

  const rows = await deps.db.query<RawUpsellRow>(
    `
    SELECT
      ui.id,
      ui.event_id,
      ui.type,
      ui.name,
      ui.description,
      ui.price,
      ui.currency,
      ui.platform_fee_pct,
      ui.image_url,
      ui.metadata,
      ui.status,
      ui.created_at,
      ui.updated_at,
      ur.id          AS rule_id,
      ur.ticket_type_id,
      ur.timing,
      ur.sort_order,
      ur.max_per_order,
      ur.available_from,
      ur.available_until,
      ur.exclusive_to_ticket_types,
      ur.conditions,
      ur.is_active,
      inv.total_qty,
      inv.sold_count,
      inv.reserved_count,
      inv.low_threshold
    FROM upsell.upsell_items ui
    JOIN upsell.upsell_rules ur ON ur.upsell_item_id = ui.id
    LEFT JOIN upsell.upsell_inventory inv ON inv.upsell_item_id = ui.id
    WHERE ui.event_id = $1
      AND ui.status = 'active'
      AND ur.timing = $2
      AND ur.is_active = TRUE
      AND (ur.available_from IS NULL OR ur.available_from <= $3)
      AND (ur.available_until IS NULL OR ur.available_until >= $3)
    ORDER BY ur.sort_order ASC
    `,
    [params.eventId, params.timing, now],
  );

  // Capacity filter (in-memory)
  const capacityFiltered = rows.filter((row) => {
    if (row.total_qty === null) return true;
    return row.sold_count + row.reserved_count < row.total_qty;
  });

  // Ticket type compatibility filter
  const ticketTypeFiltered = capacityFiltered.filter((row) => {
    const exclusive = row.exclusive_to_ticket_types ?? [];

    if (exclusive.length === 0) {
      // Rule applies to all ticket types unless ticket_type_id is set
      if (row.ticket_type_id !== null && params.ticketTypeId) {
        return row.ticket_type_id === params.ticketTypeId;
      }
      return true;
    }

    // Exclusive to specific ticket types
    if (!params.ticketTypeId) return false;
    return exclusive.includes(params.ticketTypeId);
  });

  // Deduplicate by upsell_item_id — keep first occurrence (lowest sort_order due to ORDER BY)
  const seen = new Set<string>();
  const deduplicated = ticketTypeFiltered.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  // Map to public view
  return deduplicated.map((row): UpsellItemPublic => {
    const remainingQty =
      row.total_qty !== null ? row.total_qty - row.sold_count - row.reserved_count : null;

    const isLowStock =
      remainingQty !== null && remainingQty <= (row.low_threshold ?? 5);

    return {
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description,
      price: row.price,
      currency: row.currency,
      imageUrl: row.image_url,
      metadata: row.metadata,
      remainingQty,
      isLowStock,
    };
  });
}

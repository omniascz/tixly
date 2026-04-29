import type { DbAdapter } from '../lib/service-container.js';
import type { UpsellInventoryRow } from '../types/upsell.js';
import { UpsellError } from '../lib/upsell-errors.js';

export async function lockAndGetInventory(
  upsellItemId: string,
  tx: DbAdapter,
): Promise<UpsellInventoryRow> {
  const rows = await tx.query<UpsellInventoryRow>(
    `SELECT * FROM upsell.upsell_inventory WHERE upsell_item_id = $1 FOR UPDATE`,
    [upsellItemId],
  );

  if (rows.length === 0) {
    throw new UpsellError('UPSELL_NOT_FOUND', `Inventory not found for upsell item ${upsellItemId}`, 404);
  }

  return rows[0];
}

export function assertSufficientInventory(
  inv: UpsellInventoryRow,
  quantity: number,
): void {
  if (inv.total_qty === null) return;

  const available = inv.total_qty - inv.sold_count - inv.reserved_count;
  if (available < quantity) {
    throw new UpsellError('UPSELL_SOLD_OUT', 'Upsell item is sold out or insufficient quantity available', 409);
  }
}

export async function reserveInventory(
  upsellItemId: string,
  quantity: number,
  tx: DbAdapter,
): Promise<void> {
  await tx.execute(
    `UPDATE upsell.upsell_inventory
     SET reserved_count = reserved_count + $1,
         updated_at = NOW()
     WHERE upsell_item_id = $2`,
    [quantity, upsellItemId],
  );
}

export async function releaseReservation(
  upsellItemId: string,
  quantity: number,
  tx: DbAdapter,
): Promise<void> {
  await tx.execute(
    `UPDATE upsell.upsell_inventory
     SET reserved_count = GREATEST(0, reserved_count - $1),
         updated_at = NOW()
     WHERE upsell_item_id = $2`,
    [quantity, upsellItemId],
  );
}

export async function confirmInventory(
  upsellItemId: string,
  quantity: number,
  tx: DbAdapter,
): Promise<void> {
  await tx.execute(
    `UPDATE upsell.upsell_inventory
     SET reserved_count = GREATEST(0, reserved_count - $1),
         sold_count = sold_count + $1,
         updated_at = NOW()
     WHERE upsell_item_id = $2`,
    [quantity, upsellItemId],
  );
}

export async function getInventoryAfterReservation(
  upsellItemId: string,
  db: DbAdapter,
): Promise<UpsellInventoryRow | null> {
  const rows = await db.query<UpsellInventoryRow>(
    `SELECT * FROM upsell.upsell_inventory WHERE upsell_item_id = $1`,
    [upsellItemId],
  );
  return rows[0] ?? null;
}

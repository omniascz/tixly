// Placeholder DB adapter factory.
// Replace this with a real Postgres/Prisma/Drizzle implementation at integration time.
//
// The extended interface adds findScheduleForOwner (ownership check for the GET route)
// and upsertDeliveryConfig (used by the PUT route).

import type { DeliveryDbAdapter } from '../services/delayed-delivery.service';
import type { DeliverySchedule, DeliveryConfig } from '../types/delayed-delivery.types';

// ---------------------------------------------------------------------------
// Extended adapter interface (delivery-specific additions)
// ---------------------------------------------------------------------------

export interface DeliveryDbAdapterExtended extends DeliveryDbAdapter {
  /**
   * Find a schedule for a specific ticket, verifying it belongs to the given user.
   * Returns null if no schedule exists or the ticket does not belong to the user.
   */
  findScheduleForOwner(ticketId: string, userId: string): Promise<DeliverySchedule | null>;

  /**
   * Insert or update the delivery config for a ticket type.
   */
  upsertDeliveryConfig(config: DeliveryConfig): Promise<DeliveryConfig>;
}

// ---------------------------------------------------------------------------
// Factory — swap this for your real adapter in production
// ---------------------------------------------------------------------------

let _adapter: DeliveryDbAdapterExtended | null = null;

export function getDeliveryDbAdapter(): DeliveryDbAdapterExtended {
  if (_adapter) return _adapter;
  throw new Error(
    '[delayed-delivery] DB adapter not initialised. ' +
      'Call setDeliveryDbAdapter(adapter) at application startup.',
  );
}

export function setDeliveryDbAdapter(adapter: DeliveryDbAdapterExtended): void {
  _adapter = adapter;
}

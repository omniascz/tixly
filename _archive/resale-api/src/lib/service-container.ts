/**
 * Lightweight service locator for Next.js API routes.
 * In tests, call `setServiceContainer(mockContainer)` to inject mocks.
 * In production, the default container is built from environment variables.
 */
import { ResaleListingService } from '../services/resale-listing.service';
import { ResalePayoutService } from '../services/resale-payout.service';
import { WatchlistService } from '../services/watchlist.service';
import type {
  DbAdapter,
  RedisAdapter,
  EventBusAdapter,
  GopayAdapter,
  PushNotificationAdapter,
} from '../types/resale';

export interface ServiceContainer {
  db: DbAdapter;
  redis: RedisAdapter;
  eventBus: EventBusAdapter;
  gopay: GopayAdapter;
  push: PushNotificationAdapter;
  resaleListingService: ResaleListingService;
  resalePayoutService: ResalePayoutService;
  watchlistService: WatchlistService;
}

let _container: ServiceContainer | null = null;

export function setServiceContainer(container: ServiceContainer): void {
  _container = container;
}

export function getServiceContainer(): ServiceContainer {
  if (_container) return _container;

  // Production: build real adapters here.
  // Kept as a stub so the module compiles without actual DB/Redis/GoPay SDKs.
  throw new Error(
    'ServiceContainer not initialised. Call setServiceContainer() at application startup.',
  );
}

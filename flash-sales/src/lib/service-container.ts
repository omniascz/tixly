/**
 * Lightweight service locator for Next.js API routes.
 * In tests, call `setServiceContainer(mockContainer)` to inject mocks.
 * In production, build the container at application startup and call
 * `setServiceContainer(container)` before handling the first request.
 */
import type { FlashSaleDbAdapter } from '../services/flash-sale.service';

export interface ServiceContainer {
  db: FlashSaleDbAdapter;
}

let _container: ServiceContainer | null = null;

export function setServiceContainer(container: ServiceContainer): void {
  _container = container;
}

export function getServiceContainer(): ServiceContainer {
  if (_container !== null) return _container;

  // Production: initialise real adapters and call setServiceContainer() at startup.
  throw new Error(
    'ServiceContainer not initialised. Call setServiceContainer() at application startup.',
  );
}

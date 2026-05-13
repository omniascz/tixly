/**
 * Lightweight service locator for Next.js API routes.
 * In tests, call `setServiceContainer(mockContainer)` to inject mocks.
 * In production, the default container is built from environment variables.
 */
import type { DbAdapter, EventBusAdapter } from '../types/blacklist.types';

export interface BlacklistServiceContainer {
  db: DbAdapter;
  eventBus: EventBusAdapter;
}

let _container: BlacklistServiceContainer | null = null;

export function setServiceContainer(container: BlacklistServiceContainer): void {
  _container = container;
}

export function getServiceContainer(): BlacklistServiceContainer {
  if (_container) return _container;

  // Production: build real adapters here.
  // Kept as a stub so the module compiles without actual DB/Kafka SDKs.
  throw new Error(
    'BlacklistServiceContainer not initialised. Call setServiceContainer() at application startup.',
  );
}

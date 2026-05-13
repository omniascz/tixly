// =============================================================================
// Service Container — Stripe Payments
//
// Vzor: promoter-onboarding/src/lib/service-container.ts
// Poskytuje dependency-injection adaptéry pro testovatelnost.
// =============================================================================

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface StripeDeps {
  db: DbAdapter;
}

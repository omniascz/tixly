/**
 * @tixly/rls-multitenancy — Service container interfaces
 *
 * Adapter interfaces pro dependency injection.
 * Konkrétní implementace (postgres.js, pg, mock) implementují DbAdapter.
 */

import type { TenantContext } from '../types/tenant';

export type { TenantContext };

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface ServiceDeps {
  db: DbAdapter;
}

export type ActionType = string;

export interface ActionLogEntry {
  id: string;
  promoterId: string;
  actorUserId: string;
  /** Entity type: 'reservation', 'package', 'client', etc. */
  entityType: string;
  entityId: string;
  actionType: ActionType;
  /** Stav PŘED změnou — slouží pro rollback */
  beforeState: Record<string, unknown> | null;
  /** Stav PO změně */
  afterState: Record<string, unknown> | null;
  /** Volitelný popis akce pro human admins */
  description: string | null;
  /** Lze tuto akci automaticky vrátit zpět? */
  rollbackable: boolean;
  /** Pokud je tato akce už vrácena, kdy */
  rolledBackAt: Date | null;
  rolledBackByUserId: string | null;
  createdAt: Date;
}

export interface LogActionInput {
  promoterId: string;
  actorUserId: string;
  entityType: string;
  entityId: string;
  actionType: ActionType;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  description?: string;
  rollbackable?: boolean;
}

export interface ListActionsFilters {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
}

export interface Pagination {
  limit?: number;
  offset?: number;
}

// =============================================================================
// System Status page — Availability monitoring (Feature #169)
//
// Veřejná stránka dostupnosti systému: real-time stav API, payment gateway,
// scanner, webhooks. Automatické incidenty z monitoringu.
//
// SCHEMA: monitoring.* (migration 122)
// =============================================================================

export type ComponentStatus = 'operational' | 'degraded' | 'down';
export type IncidentSeverity = 'informational' | 'minor' | 'major' | 'critical';

export interface SystemComponent {
  id: string;
  name: string;
  description: string;
  status: ComponentStatus;
  lastUpdatedAt: string;
}

export interface StatusIncident {
  id: string;
  title: string;
  description: string;
  affectedComponentIds: string[];
  severity: IncidentSeverity;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  startedAt: string;
  resolvedAt: string | null;
  updates: { message: string; timestamp: string }[];
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface ComponentRow {
  id: string;
  name: string;
  description: string;
  status: string;
  last_updated_at: string;
}

interface IncidentRow {
  id: string;
  title: string;
  description: string;
  affected_component_ids: string[];
  severity: string;
  status: string;
  started_at: string;
  resolved_at: string | null;
  updates: Record<string, unknown>[];
}

function mapComponent(row: ComponentRow): SystemComponent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as ComponentStatus,
    lastUpdatedAt: row.last_updated_at,
  };
}

function mapIncident(row: IncidentRow): StatusIncident {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    affectedComponentIds: row.affected_component_ids,
    severity: row.severity as IncidentSeverity,
    status: row.status as any,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    updates: (row.updates || []).map((u: any) => ({
      message: u.message || '',
      timestamp: u.timestamp || '',
    })),
  };
}

/**
 * Vrátí aktuální stav všech komponent.
 */
export async function getSystemStatus(db: DbAdapter): Promise<SystemComponent[]> {
  const rows = await db.query<ComponentRow>(
    `SELECT * FROM monitoring.system_components ORDER BY name`,
    [],
  );
  return rows.map(mapComponent);
}

/**
 * Aktualizuje stav komponenty.
 */
export async function updateComponentStatus(
  componentId: string,
  status: ComponentStatus,
  db: DbAdapter,
): Promise<SystemComponent> {
  const rows = await db.query<ComponentRow>(
    `UPDATE monitoring.system_components
     SET status = $1, last_updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, componentId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Component not found');
  return mapComponent(rows[0]);
}

/**
 * Vytvoří nový incident (z monitoringu).
 */
export async function createIncident(
  title: string,
  description: string,
  affectedComponentIds: string[],
  severity: IncidentSeverity,
  db: DbAdapter,
): Promise<StatusIncident> {
  const rows = await db.query<IncidentRow>(
    `INSERT INTO monitoring.status_incidents
       (title, description, affected_component_ids, severity)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [title, description, JSON.stringify(affectedComponentIds), severity],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: incident creation failed');
  return mapIncident(rows[0]);
}

/**
 * Přidá update (status změna) k incidentu.
 */
export async function addIncidentUpdate(
  incidentId: string,
  message: string,
  db: DbAdapter,
): Promise<StatusIncident> {
  const rows = await db.query<IncidentRow>(
    `UPDATE monitoring.status_incidents
     SET updates = updates || jsonb_build_array(jsonb_build_object('message', $1, 'timestamp', NOW()))
     WHERE id = $2 AND status != 'resolved'
     RETURNING *`,
    [message, incidentId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Incident not found or already resolved');
  return mapIncident(rows[0]);
}

/**
 * Vyřeší incident (status → resolved).
 */
export async function resolveIncident(
  incidentId: string,
  message: string,
  db: DbAdapter,
): Promise<StatusIncident> {
  const rows = await db.query<IncidentRow>(
    `UPDATE monitoring.status_incidents
     SET status = 'resolved',
         resolved_at = NOW(),
         updates = updates || jsonb_build_array(jsonb_build_object('message', $1, 'timestamp', NOW()))
     WHERE id = $2 AND status != 'resolved'
     RETURNING *`,
    [message, incidentId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Incident not found or already resolved');
  return mapIncident(rows[0]);
}

/**
 * Vrátí aktivní a nedávno vyřešené incidenty (posledních 7 dní).
 */
export async function getActiveIncidents(db: DbAdapter): Promise<StatusIncident[]> {
  const rows = await db.query<IncidentRow>(
    `SELECT * FROM monitoring.status_incidents
     WHERE status != 'resolved' OR resolved_at > NOW() - INTERVAL '7 days'
     ORDER BY started_at DESC`,
    [],
  );
  return rows.map(mapIncident);
}

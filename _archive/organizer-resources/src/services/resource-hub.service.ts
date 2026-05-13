// =============================================================================
// Organizer Resource Hub — Knowledge base (Feature #167)
//
// Průvodci krok za krokem, šablony, best practices pro promotéry.
// Snižuje onboarding friction a support load.
//
// SCHEMA: resources.* (migration 121)
// =============================================================================

export type ResourceType = 'guide' | 'template' | 'best_practice' | 'checklist';
export type ResourceCategory = 'pricing' | 'marketing' | 'operations' | 'technical' | 'legal';

export interface Resource {
  id: string;
  type: ResourceType;
  category: ResourceCategory;
  title: string;
  description: string;
  contentHtml: string;          // sanitizovaný HTML obsah
  downloadUrl?: string;         // template file ke stažení
  views: number;
  helpfulCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResourceInput {
  type: ResourceType;
  category: ResourceCategory;
  title: string;
  description: string;
  contentHtml: string;
  downloadUrl?: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface ResourceRow {
  id: string;
  type: string;
  category: string;
  title: string;
  description: string;
  content_html: string;
  download_url: string | null;
  views: number;
  helpful_count: number;
  created_at: string;
  updated_at: string;
}

function mapResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    type: row.type as ResourceType,
    category: row.category as ResourceCategory,
    title: row.title,
    description: row.description,
    contentHtml: row.content_html,
    downloadUrl: row.download_url ?? undefined,
    views: row.views,
    helpfulCount: row.helpful_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Vytvoří nový resource (admin-side).
 */
export async function createResource(
  input: CreateResourceInput,
  db: DbAdapter,
): Promise<Resource> {
  const rows = await db.query<ResourceRow>(
    `INSERT INTO resources.resource_hub
       (type, category, title, description, content_html, download_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.type, input.category, input.title, input.description, input.contentHtml, input.downloadUrl ?? null],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: resource creation failed');
  return mapResource(rows[0]);
}

/**
 * Vrátí resource dle ID a inkrementuje view counter.
 */
export async function getResource(resourceId: string, db: DbAdapter): Promise<Resource | null> {
  const rows = await db.query<ResourceRow>(
    `UPDATE resources.resource_hub
     SET views = views + 1
     WHERE id = $1
     RETURNING *`,
    [resourceId],
  );
  return rows[0] ? mapResource(rows[0]) : null;
}

/**
 * Vrátí resources filtrované dle kategorie a typu (pro discovery).
 */
export async function listResources(
  category?: ResourceCategory,
  type?: ResourceType,
  db?: DbAdapter,
): Promise<Resource[]> {
  if (!db) throw new Error('DB adapter required');
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (type) {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.query<ResourceRow>(
    `SELECT * FROM resources.resource_hub
     ${where}
     ORDER BY views DESC, helpful_count DESC`,
    params,
  );
  return rows.map(mapResource);
}

/**
 * Označí resource jako helpful (user thumbs up).
 */
export async function markHelpful(resourceId: string, db: DbAdapter): Promise<Resource> {
  const rows = await db.query<ResourceRow>(
    `UPDATE resources.resource_hub
     SET helpful_count = helpful_count + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [resourceId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Resource not found');
  return mapResource(rows[0]);
}

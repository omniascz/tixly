import { PortalDB } from './profile.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType = 'service' | 'branch' | 'resource';

export interface Favorite {
  userId: string;
  promoterId: string;
  entityType: EntityType;
  entityId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface FavoriteRow {
  user_id: string;
  promoter_id: string;
  entity_type: EntityType;
  entity_id: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapFavorite(row: FavoriteRow): Favorite {
  return {
    userId: row.user_id,
    promoterId: row.promoter_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function addFavorite(
  userId: string,
  promoterId: string,
  entityType: EntityType,
  entityId: string,
  db: PortalDB,
): Promise<Favorite> {
  // Upsert — idempotent (ignore conflict)
  await db.execute(
    `INSERT INTO reservations.customer_favorites
       (user_id, promoter_id, entity_type, entity_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, promoter_id, entity_type, entity_id) DO NOTHING`,
    [userId, promoterId, entityType, entityId],
  );

  const { rows } = await db.query<FavoriteRow>(
    `SELECT * FROM reservations.customer_favorites
     WHERE user_id = $1 AND promoter_id = $2 AND entity_type = $3 AND entity_id = $4`,
    [userId, promoterId, entityType, entityId],
  );

  return rows[0]
    ? mapFavorite(rows[0])
    : { userId, promoterId, entityType, entityId, createdAt: new Date().toISOString() };
}

export async function removeFavorite(
  userId: string,
  promoterId: string,
  entityType: EntityType,
  entityId: string,
  db: PortalDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.customer_favorites
     WHERE user_id = $1 AND promoter_id = $2 AND entity_type = $3 AND entity_id = $4`,
    [userId, promoterId, entityType, entityId],
  );
}

export async function getFavorites(
  userId: string,
  promoterId: string,
  entityType: EntityType | undefined,
  db: PortalDB,
): Promise<Favorite[]> {
  let sql = `SELECT * FROM reservations.customer_favorites
             WHERE user_id = $1 AND promoter_id = $2`;
  const params: unknown[] = [userId, promoterId];

  if (entityType !== undefined) {
    sql += ` AND entity_type = $3`;
    params.push(entityType);
  }

  sql += ` ORDER BY created_at DESC`;

  const { rows } = await db.query<FavoriteRow>(sql, params);
  return rows.map(mapFavorite);
}

export async function isFavorite(
  userId: string,
  promoterId: string,
  entityType: EntityType,
  entityId: string,
  db: PortalDB,
): Promise<boolean> {
  const { rows } = await db.query<FavoriteRow>(
    `SELECT 1 FROM reservations.customer_favorites
     WHERE user_id = $1 AND promoter_id = $2 AND entity_type = $3 AND entity_id = $4`,
    [userId, promoterId, entityType, entityId],
  );

  return rows.length > 0;
}

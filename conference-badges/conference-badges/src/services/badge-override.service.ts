// =============================================================================
// Badge Override Service
// =============================================================================

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface BadgeOverrideDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SetOverrideInput {
  displayName?: string;
  displayCompany?: string;
  displayRole?: string;
  badgeColor?: string;
  notes?: string;
}

export interface BadgeOverride {
  id: string;
  activationId: string;
  displayName: string | null;
  displayCompany: string | null;
  displayRole: string | null;
  badgeColor: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface OverrideRow {
  id: string;
  activation_id: string;
  display_name: string | null;
  display_company: string | null;
  display_role: string | null;
  badge_color: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapOverride(row: OverrideRow): BadgeOverride {
  return {
    id: row.id,
    activationId: row.activation_id,
    displayName: row.display_name,
    displayCompany: row.display_company,
    displayRole: row.display_role,
    badgeColor: row.badge_color,
    notes: row.notes,
  };
}

// ---------------------------------------------------------------------------
// 1. setOverride
// ---------------------------------------------------------------------------

export async function setOverride(
  activationId: string,
  input: SetOverrideInput,
  db: BadgeOverrideDB,
): Promise<BadgeOverride> {
  const [row] = await db.query<OverrideRow>(
    `INSERT INTO conference.badge_overrides
       (activation_id, display_name, display_company, display_role, badge_color, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (activation_id) DO UPDATE SET
       display_name    = EXCLUDED.display_name,
       display_company = EXCLUDED.display_company,
       display_role    = EXCLUDED.display_role,
       badge_color     = EXCLUDED.badge_color,
       notes           = EXCLUDED.notes
     RETURNING *`,
    [
      activationId,
      input.displayName ?? null,
      input.displayCompany ?? null,
      input.displayRole ?? null,
      input.badgeColor ?? null,
      input.notes ?? null,
    ],
  );
  return mapOverride(row);
}

// ---------------------------------------------------------------------------
// 2. getOverride
// ---------------------------------------------------------------------------

export async function getOverride(
  activationId: string,
  db: BadgeOverrideDB,
): Promise<BadgeOverride | null> {
  const [row] = await db.query<OverrideRow>(
    `SELECT * FROM conference.badge_overrides WHERE activation_id = $1`,
    [activationId],
  );
  return row ? mapOverride(row) : null;
}

// ---------------------------------------------------------------------------
// 3. deleteOverride
// ---------------------------------------------------------------------------

export async function deleteOverride(
  activationId: string,
  db: BadgeOverrideDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM conference.badge_overrides WHERE activation_id = $1`,
    [activationId],
  );
}

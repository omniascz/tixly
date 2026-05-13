import { BranchError } from '../lib/branch-errors';
import type { BranchDB } from './branch.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingType = 'string' | 'integer' | 'boolean' | 'json';

export interface BranchSetting {
  branchId: string;
  settingKey: string;
  settingValue: string | null;
  settingType: SettingType;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SettingRow {
  branch_id: string;
  setting_key: string;
  setting_value: string | null;
  setting_type: SettingType;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseValue(value: string | null, type: SettingType): unknown {
  if (value === null) return null;
  switch (type) {
    case 'integer':
      return parseInt(value, 10);
    case 'boolean':
      return value === 'true' || value === '1';
    case 'json':
      return JSON.parse(value);
    case 'string':
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function setSetting(
  branchId: string,
  key: string,
  value: string,
  type: SettingType,
  db: BranchDB,
): Promise<BranchSetting> {
  const { rows } = await db.query<SettingRow>(
    `INSERT INTO reservations.branch_settings (branch_id, setting_key, setting_value, setting_type, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (branch_id, setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           setting_type = EXCLUDED.setting_type,
           updated_at = NOW()
     RETURNING *`,
    [branchId, key, value, type],
  );

  if (!rows[0]) {
    throw new BranchError('SETTING_NOT_FOUND');
  }

  return {
    branchId: rows[0].branch_id,
    settingKey: rows[0].setting_key,
    settingValue: rows[0].setting_value,
    settingType: rows[0].setting_type,
    updatedAt: rows[0].updated_at,
  };
}

export async function getSetting(
  branchId: string,
  key: string,
  db: BranchDB,
): Promise<{ key: string; value: unknown; type: SettingType }> {
  const { rows } = await db.query<SettingRow>(
    `SELECT * FROM reservations.branch_settings
     WHERE branch_id = $1 AND setting_key = $2`,
    [branchId, key],
  );

  if (!rows[0]) {
    throw new BranchError('SETTING_NOT_FOUND');
  }

  return {
    key: rows[0].setting_key,
    value: parseValue(rows[0].setting_value, rows[0].setting_type),
    type: rows[0].setting_type,
  };
}

export async function getAllSettings(
  branchId: string,
  db: BranchDB,
): Promise<Record<string, unknown>> {
  const { rows } = await db.query<SettingRow>(
    `SELECT * FROM reservations.branch_settings WHERE branch_id = $1`,
    [branchId],
  );

  return rows.reduce<Record<string, unknown>>((acc, row) => {
    acc[row.setting_key] = parseValue(row.setting_value, row.setting_type);
    return acc;
  }, {});
}

export async function deleteSetting(
  branchId: string,
  key: string,
  db: BranchDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.branch_settings WHERE branch_id = $1 AND setting_key = $2`,
    [branchId, key],
  );
}

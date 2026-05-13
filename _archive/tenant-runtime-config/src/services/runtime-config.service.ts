import type { ServiceDeps } from '../lib/service-container.js';
import { RuntimeConfigError } from '../lib/config-errors.js';
import type {
  ConfigEntry,
  ConfigValueType,
  SetConfigInput,
} from '../types/config.js';

interface ConfigRow {
  promoter_id: string;
  key: string;
  raw_value: string;
  value_type: string;
  label: string | null;
  description: string | null;
  category: string | null;
  validation: Record<string, unknown> | null;
  updated_by: string | null;
  updated_at: Date;
}

const VALID_TYPES: ConfigValueType[] = [
  'string',
  'integer',
  'float',
  'boolean',
  'json',
  'duration_hours',
];

function mapRow(row: ConfigRow): ConfigEntry {
  return {
    promoterId: row.promoter_id,
    key: row.key,
    rawValue: row.raw_value,
    valueType: row.value_type as ConfigValueType,
    label: row.label,
    description: row.description,
    category: row.category,
    validation: row.validation,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export function parseValue(rawValue: string, valueType: ConfigValueType): unknown {
  switch (valueType) {
    case 'string':
      return rawValue;
    case 'integer': {
      const n = parseInt(rawValue, 10);
      if (Number.isNaN(n)) throw new RuntimeConfigError('INVALID_TYPE');
      return n;
    }
    case 'float': {
      const n = parseFloat(rawValue);
      if (Number.isNaN(n)) throw new RuntimeConfigError('INVALID_TYPE');
      return n;
    }
    case 'boolean':
      return rawValue === 'true';
    case 'json':
      try {
        return JSON.parse(rawValue);
      } catch {
        throw new RuntimeConfigError('INVALID_TYPE');
      }
    case 'duration_hours': {
      const n = parseFloat(rawValue);
      if (Number.isNaN(n)) throw new RuntimeConfigError('INVALID_TYPE');
      return n;
    }
    default:
      throw new RuntimeConfigError('INVALID_TYPE');
  }
}

function serializeValue(value: unknown, valueType: ConfigValueType): string {
  if (!VALID_TYPES.includes(valueType)) {
    throw new RuntimeConfigError('INVALID_TYPE');
  }
  switch (valueType) {
    case 'string':
      if (typeof value !== 'string') throw new RuntimeConfigError('INVALID_TYPE');
      return value;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value))
        throw new RuntimeConfigError('INVALID_TYPE');
      return String(value);
    case 'float':
    case 'duration_hours':
      if (typeof value !== 'number' || Number.isNaN(value))
        throw new RuntimeConfigError('INVALID_TYPE');
      return String(value);
    case 'boolean':
      if (typeof value !== 'boolean') throw new RuntimeConfigError('INVALID_TYPE');
      return value ? 'true' : 'false';
    case 'json':
      try {
        return JSON.stringify(value);
      } catch {
        throw new RuntimeConfigError('INVALID_TYPE');
      }
  }
}

function runValidation(
  value: unknown,
  valueType: ConfigValueType,
  validation: Record<string, unknown> | undefined,
): void {
  if (!validation) return;
  if (
    (valueType === 'integer' ||
      valueType === 'float' ||
      valueType === 'duration_hours') &&
    typeof value === 'number'
  ) {
    if (typeof validation.min === 'number' && value < validation.min) {
      throw new RuntimeConfigError('VALIDATION_FAILED');
    }
    if (typeof validation.max === 'number' && value > validation.max) {
      throw new RuntimeConfigError('VALIDATION_FAILED');
    }
  }
  if (valueType === 'string' && typeof value === 'string') {
    if (typeof validation.regex === 'string') {
      try {
        const re = new RegExp(validation.regex);
        if (!re.test(value)) throw new RuntimeConfigError('VALIDATION_FAILED');
      } catch (err) {
        if (err instanceof RuntimeConfigError) throw err;
        throw new RuntimeConfigError('VALIDATION_FAILED');
      }
    }
    if (typeof validation.minLength === 'number' && value.length < validation.minLength) {
      throw new RuntimeConfigError('VALIDATION_FAILED');
    }
    if (typeof validation.maxLength === 'number' && value.length > validation.maxLength) {
      throw new RuntimeConfigError('VALIDATION_FAILED');
    }
  }
}

export async function getConfig<T = unknown>(
  promoterId: string,
  key: string,
  deps: ServiceDeps,
): Promise<T | null> {
  const rows = await deps.db.query<ConfigRow>(
    `SELECT * FROM config.entries WHERE promoter_id = $1 AND key = $2 LIMIT 1`,
    [promoterId, key],
  );
  if (!rows[0]) return null;
  return parseValue(rows[0].raw_value, rows[0].value_type as ConfigValueType) as T;
}

export async function getConfigOrDefault<T>(
  promoterId: string,
  key: string,
  defaultValue: T,
  deps: ServiceDeps,
): Promise<T> {
  const value = await getConfig<T>(promoterId, key, deps);
  return value === null ? defaultValue : value;
}

export async function setConfig(
  promoterId: string,
  input: SetConfigInput,
  updatedByUserId: string,
  deps: ServiceDeps,
): Promise<ConfigEntry> {
  if (!VALID_TYPES.includes(input.valueType)) {
    throw new RuntimeConfigError('INVALID_TYPE');
  }
  const raw = serializeValue(input.value, input.valueType);
  runValidation(input.value, input.valueType, input.validation);

  const rows = await deps.db.query<ConfigRow>(
    `INSERT INTO config.entries
       (promoter_id, key, raw_value, value_type, label, description, category, validation, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (promoter_id, key) DO UPDATE SET
       raw_value = EXCLUDED.raw_value,
       value_type = EXCLUDED.value_type,
       label = EXCLUDED.label,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       validation = EXCLUDED.validation,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [
      promoterId,
      input.key,
      raw,
      input.valueType,
      input.label ?? null,
      input.description ?? null,
      input.category ?? null,
      input.validation ? JSON.stringify(input.validation) : null,
      updatedByUserId,
    ],
  );
  if (!rows[0]) throw new RuntimeConfigError('CONFIG_NOT_FOUND');
  return mapRow(rows[0]);
}

export async function listConfig(
  promoterId: string,
  filters: { category?: string },
  deps: ServiceDeps,
): Promise<ConfigEntry[]> {
  const clauses: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  if (filters.category) {
    clauses.push('category = $2');
    params.push(filters.category);
  }
  const rows = await deps.db.query<ConfigRow>(
    `SELECT * FROM config.entries
     WHERE ${clauses.join(' AND ')}
     ORDER BY category NULLS LAST, key ASC`,
    params,
  );
  return rows.map(mapRow);
}

export async function deleteConfig(
  promoterId: string,
  key: string,
  deps: ServiceDeps,
): Promise<void> {
  const rows = await deps.db.query<{ key: string }>(
    `DELETE FROM config.entries
     WHERE promoter_id = $1 AND key = $2
     RETURNING key`,
    [promoterId, key],
  );
  if (rows.length === 0) {
    throw new RuntimeConfigError('CONFIG_NOT_FOUND');
  }
}

export async function getConfigBatch(
  promoterId: string,
  keys: string[],
  deps: ServiceDeps,
): Promise<Record<string, unknown>> {
  if (keys.length === 0) return {};
  const rows = await deps.db.query<ConfigRow>(
    `SELECT * FROM config.entries
     WHERE promoter_id = $1 AND key = ANY($2::text[])`,
    [promoterId, keys],
  );
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = parseValue(row.raw_value, row.value_type as ConfigValueType);
  }
  return result;
}

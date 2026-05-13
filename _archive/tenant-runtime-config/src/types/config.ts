export type ConfigValueType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'json'
  | 'duration_hours';

export interface ConfigEntry {
  promoterId: string;
  key: string;
  /** Stored as TEXT, parsed via valueType */
  rawValue: string;
  valueType: ConfigValueType;
  /** Display label for admin UI */
  label: string | null;
  /** Help text */
  description: string | null;
  /** Optional category for admin grouping */
  category: string | null;
  /** Validation: min/max for numeric, regex for string */
  validation: Record<string, unknown> | null;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface SetConfigInput {
  key: string;
  value: unknown; // parsed value matching valueType
  valueType: ConfigValueType;
  label?: string;
  description?: string;
  category?: string;
  validation?: Record<string, unknown>;
}

import { CinemaProgramError } from '../lib/cinema-program-errors';
import type { CinemaProgramDB } from './age-restriction.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WidgetConfigInput {
  daysAhead?: number;
  showSoldOut?: boolean;
  showPrices?: boolean;
  primaryColor?: string;
  accentColor?: string;
  customCss?: string | null;
}

export interface WidgetConfig {
  id: string;
  venueId: string;
  configKey: string;
  daysAhead: number;
  showSoldOut: boolean;
  showPrices: boolean;
  primaryColor: string;
  accentColor: string;
  customCss: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface WidgetConfigRow {
  id: string;
  venue_id: string;
  config_key: string;
  days_ahead: number;
  show_sold_out: boolean;
  show_prices: boolean;
  primary_color: string;
  accent_color: string;
  custom_css: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapConfig(row: WidgetConfigRow): WidgetConfig {
  return {
    id: row.id,
    venueId: row.venue_id,
    configKey: row.config_key,
    daysAhead: row.days_ahead,
    showSoldOut: row.show_sold_out,
    showPrices: row.show_prices,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    customCss: row.custom_css,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createWidgetConfig(
  venueId: string,
  configKey: string,
  input: WidgetConfigInput,
  db: CinemaProgramDB,
): Promise<WidgetConfig> {
  const { rows } = await db.query<WidgetConfigRow>(
    `INSERT INTO cinema.widget_configs
       (venue_id, config_key, days_ahead, show_sold_out, show_prices,
        primary_color, accent_color, custom_css)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      venueId,
      configKey,
      input.daysAhead ?? 7,
      input.showSoldOut ?? true,
      input.showPrices ?? true,
      input.primaryColor ?? '#1a1a2e',
      input.accentColor ?? '#e94560',
      input.customCss ?? null,
    ],
  );

  if (!rows[0]) {
    throw new CinemaProgramError('WIDGET_CONFIG_NOT_FOUND');
  }

  return mapConfig(rows[0]);
}

export async function getWidgetConfig(
  venueId: string,
  configKey: string,
  db: CinemaProgramDB,
): Promise<WidgetConfig> {
  const { rows } = await db.query<WidgetConfigRow>(
    `SELECT * FROM cinema.widget_configs
     WHERE venue_id = $1 AND config_key = $2`,
    [venueId, configKey],
  );

  if (!rows[0]) {
    throw new CinemaProgramError('WIDGET_CONFIG_NOT_FOUND');
  }

  return mapConfig(rows[0]);
}

export async function updateWidgetConfig(
  venueId: string,
  configKey: string,
  input: WidgetConfigInput,
  db: CinemaProgramDB,
): Promise<WidgetConfig> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.daysAhead !== undefined) { sets.push(`days_ahead = $${idx}`); params.push(input.daysAhead); idx++; }
  if (input.showSoldOut !== undefined) { sets.push(`show_sold_out = $${idx}`); params.push(input.showSoldOut); idx++; }
  if (input.showPrices !== undefined) { sets.push(`show_prices = $${idx}`); params.push(input.showPrices); idx++; }
  if (input.primaryColor !== undefined) { sets.push(`primary_color = $${idx}`); params.push(input.primaryColor); idx++; }
  if (input.accentColor !== undefined) { sets.push(`accent_color = $${idx}`); params.push(input.accentColor); idx++; }
  if (input.customCss !== undefined) { sets.push(`custom_css = $${idx}`); params.push(input.customCss); idx++; }

  params.push(venueId, configKey);

  const { rows } = await db.query<WidgetConfigRow>(
    `UPDATE cinema.widget_configs
     SET ${sets.join(', ')}
     WHERE venue_id = $${idx} AND config_key = $${idx + 1}
     RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new CinemaProgramError('WIDGET_CONFIG_NOT_FOUND');
  }

  return mapConfig(rows[0]);
}

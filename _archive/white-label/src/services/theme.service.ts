import { TenantTheme, DEFAULT_THEME, themeCacheKey } from '../lib/tenant-theme';
import { validateThemeForPlan, TenantThemeInput, PlanTier, WhiteLabelError } from '../lib/plan-enforcement';

export interface ThemeDeps {
  db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<void>;
  };
  redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { ex?: number }): Promise<void>;
    del(key: string): Promise<void>;
  };
}

function rowToTheme(row: Record<string, unknown>): TenantTheme {
  return {
    promoterId:      row['promoter_id'] as string,
    logoUrl:         row['logo_url'] as string | null,
    faviconUrl:      row['favicon_url'] as string | null,
    heroImageUrl:    row['hero_image_url'] as string | null,
    primaryColor:    (row['primary_color'] as string) ?? '#6366f1',
    secondaryColor:  (row['secondary_color'] as string) ?? '#4f46e5',
    accentColor:     (row['accent_color'] as string) ?? '#f59e0b',
    fontFamily:      row['font_family'] as string | null,
    footerText:      row['footer_text'] as string | null,
    poweredByHidden: Boolean(row['powered_by_hidden']),
    customCss:       row['custom_css'] as string | null,
    planTier:        (row['plan_tier'] as PlanTier) ?? 'starter',
  };
}

export async function getTenantTheme(
  promoterId: string,
  deps: ThemeDeps,
): Promise<TenantTheme> {
  // 1. Redis cache
  const cached = await deps.redis.get(themeCacheKey(promoterId));
  if (cached) return JSON.parse(cached) as TenantTheme;

  // 2. DB
  const rows = await deps.db.query<Record<string, unknown>>(
    `SELECT * FROM platform.tenant_themes WHERE promoter_id = $1`,
    [promoterId],
  );

  const theme = rows.length ? rowToTheme(rows[0]) : { ...DEFAULT_THEME, promoterId };

  // 3. Cache TTL 10 min
  await deps.redis.set(themeCacheKey(promoterId), JSON.stringify(theme), { ex: 600 });

  return theme;
}

export async function saveTenantTheme(
  promoterId: string,
  input: Partial<TenantThemeInput>,
  deps: ThemeDeps,
): Promise<TenantTheme> {
  // Zjisti plán
  const planRows = await deps.db.query<{ plan_tier: string }>(
    `SELECT COALESCE(t.plan_tier, 'starter') AS plan_tier
     FROM platform.promoters p
     LEFT JOIN platform.tenant_themes t ON t.promoter_id = p.id
     WHERE p.id = $1`,
    [promoterId],
  );
  if (!planRows.length) throw new WhiteLabelError('PROMOTER_NOT_FOUND', 'Promoter not found', 404);
  const planTier = planRows[0].plan_tier as PlanTier;

  validateThemeForPlan(input, planTier);

  await deps.db.execute(
    `INSERT INTO platform.tenant_themes
       (promoter_id, logo_url, favicon_url, hero_image_url,
        primary_color, secondary_color, accent_color, font_family,
        footer_text, powered_by_hidden, custom_css, plan_tier)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (promoter_id) DO UPDATE SET
       logo_url          = EXCLUDED.logo_url,
       favicon_url       = EXCLUDED.favicon_url,
       hero_image_url    = EXCLUDED.hero_image_url,
       primary_color     = EXCLUDED.primary_color,
       secondary_color   = EXCLUDED.secondary_color,
       accent_color      = EXCLUDED.accent_color,
       font_family       = EXCLUDED.font_family,
       footer_text       = EXCLUDED.footer_text,
       powered_by_hidden = EXCLUDED.powered_by_hidden,
       custom_css        = EXCLUDED.custom_css,
       updated_at        = NOW()`,
    [
      promoterId,
      input.logoUrl ?? null, input.faviconUrl ?? null, input.heroImageUrl ?? null,
      input.primaryColor ?? '#6366f1', input.secondaryColor ?? '#4f46e5',
      input.accentColor ?? '#f59e0b', input.fontFamily ?? null,
      input.footerText ?? null, input.poweredByHidden ?? false,
      input.customCss ?? null, planTier,
    ],
  );

  // Invalidate cache
  await deps.redis.del(themeCacheKey(promoterId));

  return getTenantTheme(promoterId, deps);
}

export type PlanTier = 'starter' | 'pro' | 'enterprise';

export interface TenantThemeInput {
  logoUrl?: string;
  faviconUrl?: string;
  heroImageUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  footerText?: string;
  poweredByHidden?: boolean;
  customCss?: string;
}

const PLAN_FEATURES: Record<PlanTier, Set<keyof TenantThemeInput>> = {
  starter: new Set(['logoUrl', 'primaryColor']),
  pro: new Set([
    'logoUrl', 'faviconUrl', 'heroImageUrl',
    'primaryColor', 'secondaryColor', 'accentColor',
    'fontFamily', 'footerText',
  ]),
  enterprise: new Set([
    'logoUrl', 'faviconUrl', 'heroImageUrl',
    'primaryColor', 'secondaryColor', 'accentColor',
    'fontFamily', 'footerText', 'customCss', 'poweredByHidden',
  ]),
};

export class WhiteLabelError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 422) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = 'WhiteLabelError';
  }

  toHttpError() {
    return { error: this.code, statusCode: this.statusCode, message: this.message };
  }
}

export function isWhiteLabelError(err: unknown): err is WhiteLabelError {
  return err instanceof WhiteLabelError;
}

export function validateThemeForPlan(
  input: Partial<TenantThemeInput>,
  planTier: PlanTier,
): void {
  const allowed = PLAN_FEATURES[planTier];
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && !allowed.has(key as keyof TenantThemeInput)) {
      throw new WhiteLabelError(
        'PLAN_FEATURE_NOT_AVAILABLE',
        `Feature '${key}' requires plan upgrade. Current plan: '${planTier}'`,
        422,
      );
    }
  }
}

export function getCustomDomainAllowed(planTier: PlanTier): boolean {
  return planTier === 'pro' || planTier === 'enterprise';
}

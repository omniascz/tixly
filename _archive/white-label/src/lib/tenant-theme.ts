import { sanitizeCss } from './css-sanitizer';

export interface TenantTheme {
  promoterId: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  heroImageUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string | null;
  footerText: string | null;
  poweredByHidden: boolean;
  customCss: string | null;
  planTier: 'starter' | 'pro' | 'enterprise';
}

export const DEFAULT_THEME: TenantTheme = {
  promoterId: 'platform',
  logoUrl: null,
  faviconUrl: null,
  heroImageUrl: null,
  primaryColor: '#6366f1',
  secondaryColor: '#4f46e5',
  accentColor: '#f59e0b',
  fontFamily: null,
  footerText: null,
  poweredByHidden: false,
  customCss: null,
  planTier: 'starter',
};

export function buildCssVars(theme: TenantTheme): string {
  // Validuj hex barvy — jen povolené formáty
  const safeColor = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#6366f1';

  // Escapuj/sanitizuj font-family (obrana před CSS injection a XSS)
  // Strategie: whitelist pouze písmena, mezery a pomlčky (typické pro Google Fonts názvy)
  const safeFontFamily = theme.fontFamily
    ? theme.fontFamily
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') // strip script tagy včetně obsahu
        .replace(/<[^>]*>/g, '')      // strip ostatní HTML tagy
        .replace(/[<>'"();{}]/g, '')  // strip nebezpečné znaky
        .replace(/javascript/gi, '')  // strip javascript keyword
        .trim()
    : null;

  const vars: Record<string, string> = {
    '--color-primary':   safeColor(theme.primaryColor),
    '--color-secondary': safeColor(theme.secondaryColor),
    '--color-accent':    safeColor(theme.accentColor),
    '--font-family': safeFontFamily
      ? `'${safeFontFamily}', sans-serif`
      : 'system-ui, sans-serif',
  };

  let css = `:root {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;

  if (theme.planTier === 'enterprise' && theme.customCss) {
    css += `\n/* tenant-custom */\n${sanitizeCss(theme.customCss)}`;
  }

  return css;
}

// Cache key
export function themeCacheKey(promoterId: string): string {
  return `theme:${promoterId}`;
}

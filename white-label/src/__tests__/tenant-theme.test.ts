import { describe, it, expect } from 'vitest';
import { buildCssVars, DEFAULT_THEME, themeCacheKey, TenantTheme } from '../lib/tenant-theme';

function makeTheme(overrides: Partial<TenantTheme> = {}): TenantTheme {
  return { ...DEFAULT_THEME, ...overrides };
}

describe('tenant-theme', () => {
  it('1. buildCssVars generuje :root s CSS variables', () => {
    const css = buildCssVars(DEFAULT_THEME);
    expect(css).toContain(':root {');
    expect(css).toContain('--color-primary');
    expect(css).toContain('--color-secondary');
    expect(css).toContain('--color-accent');
    expect(css).toContain('--font-family');
  });

  it('2. buildCssVars sanitizuje neplatnou hex barvu (fallback na default)', () => {
    const theme = makeTheme({ primaryColor: 'red', secondaryColor: 'not-valid' });
    const css = buildCssVars(theme);
    // Neplatné barvy se nahradí #6366f1
    expect(css).not.toContain('--color-primary: red');
    expect(css).toContain('--color-primary: #6366f1');
    expect(css).toContain('--color-secondary: #6366f1');
  });

  it('3. buildCssVars neobsahuje customCss pro starter plan', () => {
    const theme = makeTheme({
      planTier: 'starter',
      customCss: '.foo { color: red; }',
    });
    const css = buildCssVars(theme);
    expect(css).not.toContain('tenant-custom');
    expect(css).not.toContain('.foo');
  });

  it('4. buildCssVars přidá customCss pro enterprise plan', () => {
    const theme = makeTheme({
      planTier: 'enterprise',
      customCss: '.foo { color: red; }',
    });
    const css = buildCssVars(theme);
    expect(css).toContain('tenant-custom');
    expect(css).toContain('.foo');
  });

  it('5. buildCssVars escapuje uvozovky ve font-family', () => {
    const theme = makeTheme({ fontFamily: "Open' Sans" });
    const css = buildCssVars(theme);
    // Uvozovka je odebrána, ne vložena do výstupu
    expect(css).not.toContain("Open' Sans");
    expect(css).toContain('Open Sans');
  });

  it('6. DEFAULT_THEME má platné hex barvy', () => {
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    expect(hexRegex.test(DEFAULT_THEME.primaryColor)).toBe(true);
    expect(hexRegex.test(DEFAULT_THEME.secondaryColor)).toBe(true);
    expect(hexRegex.test(DEFAULT_THEME.accentColor)).toBe(true);
  });

  it('7. themeCacheKey vrátí správný formát', () => {
    const key = themeCacheKey('promoter-123');
    expect(key).toBe('theme:promoter-123');
  });

  it('8. buildCssVars neobsahuje XSS ve font-family', () => {
    const theme = makeTheme({ fontFamily: '<script>alert(1)</script>' });
    const css = buildCssVars(theme);
    expect(css).not.toContain('<script>');
    expect(css).not.toContain('alert');
  });

  it('9. buildCssVars pro null fontFamily použije system-ui', () => {
    const theme = makeTheme({ fontFamily: null });
    const css = buildCssVars(theme);
    expect(css).toContain('system-ui, sans-serif');
  });

  it('10. buildCssVars generuje validní CSS syntax (otvírací a zavírací závorky)', () => {
    const css = buildCssVars(DEFAULT_THEME);
    // :root { ... } musí mít odpovídající závorky
    const openBraces = (css.match(/{/g) ?? []).length;
    const closeBraces = (css.match(/}/g) ?? []).length;
    expect(openBraces).toBe(closeBraces);
    expect(openBraces).toBeGreaterThan(0);
  });
});

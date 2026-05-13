import { describe, it, expect } from 'vitest';
import { sanitizeCss } from '../lib/css-sanitizer';
import { WhiteLabelError } from '../lib/plan-enforcement';

describe('css-sanitizer', () => {
  it('1. Povolí bezpečné CSS (color, background-color)', () => {
    const input = '.btn { color: #fff; background-color: #6366f1; }';
    const result = sanitizeCss(input);
    expect(result).toContain('color: #fff');
    expect(result).toContain('background-color: #6366f1');
  });

  it('2. Blokuje @import', () => {
    const input = '@import url("https://evil.com/hack.css");';
    const result = sanitizeCss(input);
    // Výsledek nesmí obsahovat funkční @import (s mezerou za)
    expect(result).not.toMatch(/@import\s/i);
    // Musí obsahovat blokovací komentář
    expect(result).toContain('/* import-blocked */');
  });

  it('3. Blokuje javascript: v url()', () => {
    const input = '.foo { background: url("javascript:alert(1)"); }';
    const result = sanitizeCss(input);
    expect(result).not.toContain('javascript:alert');
    expect(result).toContain('/* js blocked */');
  });

  it('4. Blokuje expression()', () => {
    const input = '.foo { width: expression(alert(1)); }';
    const result = sanitizeCss(input);
    expect(result).not.toMatch(/expression\s*\(/i);
    expect(result).toContain('/* expression blocked */');
  });

  it('5. Blokuje <script> tagy', () => {
    const input = '<script>alert(1)</script>.foo { color: red; }';
    const result = sanitizeCss(input);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
  });

  it('6. Blokuje behavior:', () => {
    const input = '.foo { behavior: url(evil.htc); }';
    const result = sanitizeCss(input);
    expect(result).not.toMatch(/behavior\s*:/i);
    expect(result).toContain('/* behavior blocked */');
  });

  it('7. Povolí url() s https:// odkazem', () => {
    const input = '.hero { background-image: url("https://cdn.example.com/img.jpg"); }';
    const result = sanitizeCss(input);
    // https:// url by měla projít
    expect(result).toContain('url("https://cdn.example.com/img.jpg")');
  });

  it('8. Hodí chybu při překročení 50KB limitu', () => {
    const bigCss = 'a'.repeat(51 * 1024); // > 50KB
    expect(() => sanitizeCss(bigCss)).toThrow(WhiteLabelError);
    try {
      sanitizeCss(bigCss);
    } catch (err) {
      expect((err as WhiteLabelError).code).toBe('CSS_TOO_LARGE');
      expect((err as WhiteLabelError).statusCode).toBe(422);
    }
  });

  it('9. Zachová valid CSS po sanitizaci', () => {
    const input = '.card { border-radius: 8px; padding: 16px; margin: 0 auto; }';
    const result = sanitizeCss(input);
    expect(result).toContain('border-radius: 8px');
    expect(result).toContain('padding: 16px');
    expect(result).toContain('margin: 0 auto');
  });

  it('10. Blokuje unsafe url() bez protokolu', () => {
    const input = '.foo { background: url(evil/path); }';
    const result = sanitizeCss(input);
    expect(result).toContain('/* unsafe url blocked */');
  });
});

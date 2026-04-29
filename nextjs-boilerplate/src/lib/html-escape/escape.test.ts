import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escape';

describe('escapeHtml', () => {
  it('escapes basic XSS payload', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes both quote types (attribute injection)', () => {
    expect(escapeHtml(`"a"`)).toBe('&quot;a&quot;');
    expect(escapeHtml(`'a'`)).toBe('&#39;a&#39;');
  });

  it('escapes attribute injection vector', () => {
    expect(escapeHtml(`" onload="alert(1)`)).toBe(
      '&quot; onload=&quot;alert(1)',
    );
  });

  it('returns empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('preserves benign UTF-8 (Czech)', () => {
    expect(escapeHtml('Příliš žluťoučký kůň')).toBe('Příliš žluťoučký kůň');
  });

  it('escapes ampersand FIRST (no double-encoding bug)', () => {
    // Pokud bychom escapovali < první, mohl by &lt; obsahovat & který by se
    // pak escapoval znovu na &amp;lt;.
    expect(escapeHtml('<a&b>')).toBe('&lt;a&amp;b&gt;');
  });

  it('coerces numbers to string', () => {
    expect(escapeHtml(42 as unknown as string)).toBe('42');
  });
});

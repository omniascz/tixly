import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Testy pro widget-loader logiku (bez DOM, pure unit)
// ---------------------------------------------------------------------------

describe('widget-loader — validace eventId', () => {
  it('přijme platný UUID event ID', () => {
    expect(isValidEventId('evt_abc123')).toBe(true);
  });

  it('přijme slug s pomlčkou a podtržítkem', () => {
    expect(isValidEventId('festival-2026_praha')).toBe(true);
  });

  it('odmítne prázdný string', () => {
    expect(isValidEventId('')).toBe(false);
  });

  it('odmítne příliš dlouhé ID (> 100 znaků)', () => {
    expect(isValidEventId('a'.repeat(101))).toBe(false);
  });

  it('odmítne ID s nedovolenými znaky', () => {
    expect(isValidEventId('event<script>')).toBe(false);
    expect(isValidEventId('event/../../etc')).toBe(false);
    expect(isValidEventId('event id space')).toBe(false);
  });
});

describe('widget-loader — sanitizeColor', () => {
  it('přijme platný hex #rrggbb', () => {
    expect(sanitizeColor('#e63946')).toBe('#e63946');
  });

  it('přijme zkrácený hex #rgb', () => {
    expect(sanitizeColor('#f00')).toBe('#f00');
  });

  it('odmítne barvu bez #', () => {
    expect(sanitizeColor('red')).toBeUndefined();
    expect(sanitizeColor('e63946')).toBeUndefined();
  });

  it('odmítne XSS pokus', () => {
    expect(sanitizeColor('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeColor('#<script>')).toBeUndefined();
  });

  it('vrátí undefined pro undefined vstup', () => {
    expect(sanitizeColor(undefined)).toBeUndefined();
  });
});

describe('widget-loader — URL sestavení', () => {
  it('sestaví správnou src URL pro iframe', () => {
    const url = buildWidgetUrl('https://tixly.cz', 'evt_abc', 'cs', '#2563eb');
    expect(url).toBe('https://tixly.cz/widget/evt_abc?locale=cs&color=%232563eb');
  });

  it('vynechá color pokud není zadána', () => {
    const url = buildWidgetUrl('https://tixly.cz', 'evt_abc', 'en', undefined);
    expect(url).toBe('https://tixly.cz/widget/evt_abc?locale=en');
  });

  it('enkóduje eventId v URL', () => {
    const url = buildWidgetUrl('https://tixly.cz', 'event/hack', 'cs', undefined);
    expect(url).toContain('/widget/event%2Fhack');
  });
});

// ---------------------------------------------------------------------------
// Pomocné funkce (extrahované z widget-loader logiky pro testování)
// ---------------------------------------------------------------------------

function isValidEventId(id: string): boolean {
  return id.length > 0 && id.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function sanitizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^#[0-9a-fA-F]{3,6}$/.test(value) ? value : undefined;
}

function buildWidgetUrl(
  base: string,
  eventId: string,
  locale: string,
  color: string | undefined,
): string {
  const params = new URLSearchParams({ locale });
  if (color) params.set('color', color);
  return `${base}/widget/${encodeURIComponent(eventId)}?${params}`;
}

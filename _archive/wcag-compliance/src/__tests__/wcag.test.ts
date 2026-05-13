import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  getContrastRatio,
  meetsWcagAA,
  meetsWcagAAA,
} from '../utils/colorContrast';
import {
  generateAriaId,
  combineAriaDescribedBy,
  ariaLabel,
  ariaDescribedBy,
} from '../utils/ariaUtils';
import { createFocusTrap } from '../hooks/useFocusTrap';
import { createAnnouncer } from '../hooks/useAnnouncer';

// ---------------------------------------------------------------------------
// colorContrast
// ---------------------------------------------------------------------------
describe('hexToRgb', () => {
  it('converts #000000 to { r:0, g:0, b:0 }', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('converts #FFFFFF to { r:255, g:255, b:255 }', () => {
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('converts #FF0000 to { r:255, g:0, b:0 }', () => {
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('getContrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(getContrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('is symmetric — white on black also returns 21', () => {
    expect(getContrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
  });
});

describe('meetsWcagAA', () => {
  it('returns true for black on white (21:1 > 4.5:1)', () => {
    expect(meetsWcagAA('#000000', '#FFFFFF')).toBe(true);
  });

  it('returns false for #777777 on white (4.48:1 < 4.5:1)', () => {
    expect(meetsWcagAA('#777777', '#FFFFFF')).toBe(false);
  });

  it('returns true for #767676 on white (4.54:1 >= 4.5:1)', () => {
    expect(meetsWcagAA('#767676', '#FFFFFF')).toBe(true);
  });

  it('returns true for white on #0000AA with largeText=true (>3:1)', () => {
    expect(meetsWcagAA('#FFFFFF', '#0000AA', true)).toBe(true);
  });
});

describe('meetsWcagAAA', () => {
  it('returns true for black on white (21:1 > 7:1)', () => {
    expect(meetsWcagAAA('#000000', '#FFFFFF')).toBe(true);
  });

  it('returns false for #666666 on white (~5.7:1 < 7:1)', () => {
    expect(meetsWcagAAA('#666666', '#FFFFFF')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ariaUtils
// ---------------------------------------------------------------------------
describe('generateAriaId', () => {
  it('generated id starts with the given prefix', () => {
    expect(generateAriaId('btn')).toMatch(/^btn-/);
  });

  it('generates unique ids on each call', () => {
    expect(generateAriaId('btn')).not.toBe(generateAriaId('btn'));
  });
});

describe('combineAriaDescribedBy', () => {
  it('joins two ids with a space', () => {
    expect(combineAriaDescribedBy('a', 'b')).toBe('a b');
  });

  it('filters out undefined values', () => {
    expect(combineAriaDescribedBy('a', undefined, 'c')).toBe('a c');
  });

  it('returns undefined when all values are undefined', () => {
    expect(combineAriaDescribedBy(undefined, undefined)).toBeUndefined();
  });
});

describe('ariaLabel', () => {
  it("returns the aria-label attribute object", () => {
    expect(ariaLabel('Close')).toEqual({ 'aria-label': 'Close' });
  });
});

describe('ariaDescribedBy', () => {
  it('returns the aria-describedby attribute object', () => {
    expect(ariaDescribedBy('hint-1')).toEqual({ 'aria-describedby': 'hint-1' });
  });
});

// ---------------------------------------------------------------------------
// createFocusTrap
// ---------------------------------------------------------------------------
describe('createFocusTrap', () => {
  it('imports without error', () => {
    expect(typeof createFocusTrap).toBe('function');
  });

  it('returns an object with activate and deactivate functions', () => {
    // Minimal stub for HTMLElement in Node environment
    const container = {
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      contains: () => false,
    } as unknown as HTMLElement;

    const trap = createFocusTrap(container);
    expect(typeof trap.activate).toBe('function');
    expect(typeof trap.deactivate).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// createAnnouncer
// ---------------------------------------------------------------------------
describe('createAnnouncer', () => {
  it('imports without error', () => {
    expect(typeof createAnnouncer).toBe('function');
  });

  it('announce() exists as a function on the returned object', () => {
    // In Node environment document is undefined, so we patch minimally
    const original = globalThis.document;
    // @ts-expect-error patching for test
    globalThis.document = undefined;
    const announcer = createAnnouncer();
    expect(typeof announcer.announce).toBe('function');
    expect(typeof announcer.destroy).toBe('function');
    // @ts-expect-error restore
    globalThis.document = original;
  });
});

import { describe, it, expect } from 'vitest';
import {
  generateBarcodeCode,
  generateShortCode,
  isValidBarcodeCode,
  generateBarcodePng,
  generateBarcodeSvg,
} from './barcode-generator.js';
import {
  parseBarcodeCode,
  isBarcodeExpired,
  buildScanResult,
} from './barcode-validator.js';
import type { BarcodeTicket } from '../types/barcode.types.js';
import { InvalidBarcodeFormatError } from '../types/barcode.types.js';

// ---------------------------------------------------------------------------
// generateBarcodeCode
// ---------------------------------------------------------------------------

describe('generateBarcodeCode', () => {
  it('vrátí string ve správném formátu pro rok 2026', () => {
    const code = generateBarcodeCode(2026);
    expect(code).toMatch(/^TK-2026-\d{6}-[A-Z0-9]{2}$/);
  });

  it('vrátí string délky 16 znaků', () => {
    const code = generateBarcodeCode(2026);
    expect(code).toHaveLength(16);
  });

  it('kóduje správný rok', () => {
    expect(generateBarcodeCode(2030)).toMatch(/^TK-2030-/);
    expect(generateBarcodeCode(2099)).toMatch(/^TK-2099-/);
  });

  it('6místná číselná část je vždy číslice 0-9', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateBarcodeCode(2026);
      const parts = code.split('-');
      expect(parts[2]).toMatch(/^\d{6}$/);
    }
  });

  it('suffix je vždy 2 velká alfanumerická (A-Z0-9)', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateBarcodeCode(2026);
      const parts = code.split('-');
      expect(parts[3]).toMatch(/^[A-Z0-9]{2}$/);
    }
  });

  it('generuje unikátní kódy (1000 vzorků bez duplicit)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateBarcodeCode(2026));
    }
    expect(codes.size).toBe(1000);
  });

  it('všechny znaky jsou ASCII printable (Code 128 kompatibilní)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateBarcodeCode(2026);
      for (const char of code) {
        const cp = char.charCodeAt(0);
        expect(cp).toBeGreaterThanOrEqual(0x20);
        expect(cp).toBeLessThanOrEqual(0x7e);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// generateShortCode
// ---------------------------------------------------------------------------

describe('generateShortCode', () => {
  it('vrátí string délky přesně 8 znaků', () => {
    expect(generateShortCode()).toHaveLength(8);
  });

  it('obsahuje pouze base62 znaky (a-zA-Z0-9)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateShortCode()).toMatch(/^[a-zA-Z0-9]{8}$/);
    }
  });

  it('generuje unikátní kódy (1000 vzorků bez duplicit)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateShortCode());
    }
    expect(codes.size).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// isValidBarcodeCode
// ---------------------------------------------------------------------------

describe('isValidBarcodeCode', () => {
  it('platný kód projde', () => {
    expect(isValidBarcodeCode('TK-2026-847291-X3')).toBe(true);
    expect(isValidBarcodeCode('TK-2026-000000-AA')).toBe(true);
    expect(isValidBarcodeCode('TK-2030-999999-9Z')).toBe(true);
  });

  it('neplatný prefix selže', () => {
    expect(isValidBarcodeCode('XX-2026-847291-X3')).toBe(false);
    expect(isValidBarcodeCode('tk-2026-847291-X3')).toBe(false);
  });

  it('příliš krátký / dlouhý kód selže', () => {
    expect(isValidBarcodeCode('TK-2026-84729-X3')).toBe(false);   // 5 číslic
    expect(isValidBarcodeCode('TK-2026-8472910-X3')).toBe(false); // 7 číslic
    expect(isValidBarcodeCode('TK-2026-847291-X')).toBe(false);   // 1 suffix
    expect(isValidBarcodeCode('TK-2026-847291-X33')).toBe(false); // 3 suffix
  });

  it('lowercase suffix selže', () => {
    expect(isValidBarcodeCode('TK-2026-847291-x3')).toBe(false);
  });

  it('prázdný string selže', () => {
    expect(isValidBarcodeCode('')).toBe(false);
  });

  it('náhodný string selže', () => {
    expect(isValidBarcodeCode('hello world')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateBarcodePng
// ---------------------------------------------------------------------------

describe('generateBarcodePng', () => {
  it('vrátí neprázdný Buffer', async () => {
    const buf = await generateBarcodePng('TK-2026-847291-X3');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('PNG buffer začíná PNG magic bytes', async () => {
    const buf = await generateBarcodePng('TK-2026-847291-X3');
    // PNG magic: 89 50 4E 47
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  it('různé kódy generují různé PNG (ne cache)', async () => {
    const buf1 = await generateBarcodePng('TK-2026-111111-AA');
    const buf2 = await generateBarcodePng('TK-2026-999999-ZZ');
    expect(buf1.equals(buf2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateBarcodeSvg
// ---------------------------------------------------------------------------

describe('generateBarcodeSvg', () => {
  it('vrátí string začínající <svg', async () => {
    const svg = await generateBarcodeSvg('TK-2026-847291-X3');
    expect(typeof svg).toBe('string');
    expect(svg.trimStart()).toMatch(/^<svg/i);
  });

  it('SVG obsahuje text barcode kódu', async () => {
    const code = 'TK-2026-847291-X3';
    const svg = await generateBarcodeSvg(code);
    expect(svg).toContain(code);
  });

  it('SVG je neprázdný string', async () => {
    const svg = await generateBarcodeSvg('TK-2026-847291-X3');
    expect(svg.length).toBeGreaterThan(100);
  });

  it('SVG se uzavírá </svg>', async () => {
    const svg = await generateBarcodeSvg('TK-2026-847291-X3');
    expect(svg).toContain('</svg>');
  });
});

// ---------------------------------------------------------------------------
// parseBarcodeCode (z barcode-validator)
// ---------------------------------------------------------------------------

describe('parseBarcodeCode', () => {
  it('trim whitespace ze začátku a konce', () => {
    expect(parseBarcodeCode('  TK-2026-847291-X3  ')).toBe('TK-2026-847291-X3');
  });

  it('uppercase konverze', () => {
    expect(parseBarcodeCode('tk-2026-847291-x3')).toBe('TK-2026-847291-X3');
  });

  it('stripped non-printable znaky (\\r\\n od čtečky)', () => {
    expect(parseBarcodeCode('TK-2026-847291-X3\r\n')).toBe('TK-2026-847291-X3');
  });

  it('platný kód projde bez chyby', () => {
    expect(() => parseBarcodeCode('TK-2026-847291-X3')).not.toThrow();
  });

  it('neplatný kód vyhodí InvalidBarcodeFormatError', () => {
    expect(() => parseBarcodeCode('INVALID')).toThrow(InvalidBarcodeFormatError);
  });

  it('prázdný string vyhodí InvalidBarcodeFormatError', () => {
    expect(() => parseBarcodeCode('')).toThrow(InvalidBarcodeFormatError);
  });
});

// ---------------------------------------------------------------------------
// isBarcodeExpired (z barcode-validator)
// ---------------------------------------------------------------------------

describe('isBarcodeExpired', () => {
  const now = new Date('2026-04-15T22:00:00Z');

  it('event skončil před méně než 4 hodinami — platný', () => {
    const eventEnd = new Date('2026-04-15T20:00:00Z'); // 2h zpět
    expect(isBarcodeExpired(eventEnd, now)).toBe(false);
  });

  it('event skončil přesně 4 hodiny zpět — platný (boundary, inclusvive)', () => {
    const eventEnd = new Date('2026-04-15T18:00:00Z'); // přesně 4h
    expect(isBarcodeExpired(eventEnd, now)).toBe(false);
  });

  it('event skončil před více než 4 hodinami — expirovaný', () => {
    const eventEnd = new Date('2026-04-15T17:59:00Z'); // 4h + 1 minuta zpět
    expect(isBarcodeExpired(eventEnd, now)).toBe(true);
  });

  it('event teprve bude — platný', () => {
    const eventEnd = new Date('2026-04-16T20:00:00Z'); // zítra
    expect(isBarcodeExpired(eventEnd, now)).toBe(false);
  });

  it('event skončil den zpět — expirovaný', () => {
    const eventEnd = new Date('2026-04-14T20:00:00Z');
    expect(isBarcodeExpired(eventEnd, now)).toBe(true);
  });

  it('bez scanAt parametru — používá NOW() (implicitní test)', () => {
    const futureEventEnd = new Date(Date.now() + 86_400_000); // za 24h
    expect(isBarcodeExpired(futureEventEnd)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildScanResult (z barcode-validator)
// ---------------------------------------------------------------------------

describe('buildScanResult', () => {
  const ticket: BarcodeTicket = {
    id: 'uuid-123',
    ticketTypeId: 'tt-uuid',
    ownerId: 'user-uuid',
    holderName: 'Jan Novák',
    barcodeCode: 'TK-2026-847291-X3',
    shortCode: 'aB3xK9qR',
    barcodeScannedAt: null,
    barcodeScannedBy: null,
    status: 'valid',
    eventId: 'event-uuid',
    eventName: 'Kabát — O2 Arena Praha',
    eventDateStart: new Date('2026-04-15T19:30:00Z'),
    eventDateEnd: new Date('2026-04-15T23:00:00Z'),
    venueId: 'venue-uuid',
    venueName: 'O2 Arena',
    venueAddress: 'Českomoravská 2345/17, Praha 9',
    zone: 'VIP',
    seatInfo: 'Sektor A, řada 5, místo 12',
  };

  it('vrátí valid: true', () => {
    const result = buildScanResult(ticket, 'gate-01');
    expect(result.valid).toBe(true);
  });

  it('obsahuje holderName', () => {
    const result = buildScanResult(ticket, 'gate-01');
    expect(result.holderName).toBe('Jan Novák');
  });

  it('obsahuje eventName', () => {
    const result = buildScanResult(ticket, 'gate-01');
    expect(result.eventName).toBe('Kabát — O2 Arena Praha');
  });

  it('obsahuje seatInfo a zone', () => {
    const result = buildScanResult(ticket, 'gate-01');
    expect(result.seatInfo).toBe('Sektor A, řada 5, místo 12');
    expect(result.zone).toBe('VIP');
  });
});

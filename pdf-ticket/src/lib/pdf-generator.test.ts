// =============================================================================
// TESTY: PDF generátor vstupenek
//
// Pure funkce: jednotkové testy
// generateTicketPdf: integrační smoke test (skutečné pdf-lib + qrcode + bwip-js)
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  formatEventDate,
  generateFilename,
  truncateId,
  generateTicketPdf,
} from './pdf-generator.js';
import type { PdfTicketData } from '../types/pdf-ticket.types.js';

// ---------------------------------------------------------------------------
// Testovací fixture
// ---------------------------------------------------------------------------

function makeTestData(overrides: Partial<PdfTicketData> = {}): PdfTicketData {
  return {
    eventName: 'Kabát — O2 Arena Praha',
    eventDate: new Date('2026-08-15T17:00:00.000Z'), // 19:00 CEST (UTC+2)
    eventVenue: 'O2 Arena',
    eventAddress: 'Českomoravská 2345/17, Praha 9',
    ticketId: 'abc12345-def6-7890-abcd-ef1234567890',
    orderId: 'ord98765-abc1-2345-6789-abcdef012345',
    ticketTypeName: 'VIP',
    zone: 'Sektor A',
    seatNumber: 'řada 5, místo 12',
    holderName: 'Jan Novák',
    holderEmail: 'jan.novak@example.com',
    totpCode: '12345678',
    barcodeCode: 'TK-2026-847291-X3',
    issuedAt: new Date('2026-04-04T10:00:00.000Z'),
    language: 'cs',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatEventDate
// ---------------------------------------------------------------------------

describe('formatEventDate', () => {
  // Datum: neděle 15. srpna 2026, 19:00 CEST
  // Jako UTC: 2026-08-15T17:00:00Z
  const testDate = new Date('2026-08-15T17:00:00.000Z');

  it('cs — obsahuje rok 2026', () => {
    const result = formatEventDate(testDate, 'cs');
    expect(result).toContain('2026');
  });

  it('cs — obsahuje "srpna" (měsíc v lokativu)', () => {
    const result = formatEventDate(testDate, 'cs');
    expect(result).toContain('srp'); // "srpna" nebo varianta dle locale
  });

  it('cs — obsahuje "15"', () => {
    const result = formatEventDate(testDate, 'cs');
    expect(result).toContain('15');
  });

  it('cs — obsahuje formát HH:MM', () => {
    const result = formatEventDate(testDate, 'cs');
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it('en — obsahuje rok 2026', () => {
    const result = formatEventDate(testDate, 'en');
    expect(result).toContain('2026');
  });

  it('en — obsahuje "August"', () => {
    const result = formatEventDate(testDate, 'en');
    expect(result).toContain('August');
  });

  it('en — obsahuje "15"', () => {
    const result = formatEventDate(testDate, 'en');
    expect(result).toContain('15');
  });

  it('en — obsahuje AM nebo PM', () => {
    const result = formatEventDate(testDate, 'en');
    expect(result).toMatch(/AM|PM/);
  });

  it('cs — různé dny v týdnu (pondělí)', () => {
    const monday = new Date('2026-04-06T09:00:00.000Z'); // pondělí
    const result = formatEventDate(monday, 'cs');
    expect(result).toMatch(/pond|Pond/i);
  });

  it('en — různé dny v týdnu (Monday)', () => {
    const monday = new Date('2026-04-06T09:00:00.000Z');
    const result = formatEventDate(monday, 'en');
    expect(result).toContain('Monday');
  });

  it('cs — leden je první měsíc', () => {
    const jan = new Date('2026-01-01T12:00:00.000Z');
    const result = formatEventDate(jan, 'cs');
    expect(result).toContain('2026');
    expect(result).toContain('1.');
  });
});

// ---------------------------------------------------------------------------
// generateFilename
// ---------------------------------------------------------------------------

describe('generateFilename', () => {
  it('vrátí string končící .pdf', () => {
    const name = generateFilename('Kabát - Tour 2026', 'abc12345-xxxx');
    expect(name).toMatch(/\.pdf$/);
  });

  it('odstraní diakritiku (á, é, í, ó, ů, č, š, ž, ř, ě)', () => {
    const name = generateFilename('Šárka Říčanská — živá hudba', 'xxxxxxxx-yyyy');
    expect(name).not.toMatch(/[áéíóůčšžřěÁÉÍÓŮČŠŽŘĚ]/);
  });

  it('nahradí mezery pomlčkami', () => {
    const name = generateFilename('Rock Fest Praha', 'abc12345-xxxx');
    expect(name).not.toContain(' ');
    expect(name).toContain('-');
  });

  it('výsledek je lowercase', () => {
    const name = generateFilename('ROCK FEST PRAHA', 'abc12345-xxxx');
    expect(name).toBe(name.toLowerCase());
  });

  it('obsahuje první 8 znaků ticketId', () => {
    const ticketId = 'deadbeef-1234-5678-abcd-ef1234567890';
    const name = generateFilename('Akce', ticketId);
    expect(name).toContain('deadbeef');
  });

  it('nepřekročí 60 znaků (bez přípony .pdf)', () => {
    const longName = 'Velmi Dlouhý Název Akce Který Je Opravdu Hodně Dlouhý A Obsahuje Mnoho Slov';
    const name = generateFilename(longName, 'abc12345-xxxx');
    const nameWithoutExt = name.replace(/\.pdf$/, '');
    expect(nameWithoutExt.length).toBeLessThanOrEqual(60);
  });

  it('pomlčky se neopakují (-- → -)', () => {
    const name = generateFilename('Akce — Praha — 2026', 'abc12345-xxxx');
    expect(name).not.toContain('--');
  });

  it('funguje s prázdným názvem (edge case)', () => {
    const name = generateFilename('', 'abc12345-xxxx');
    expect(name).toMatch(/\.pdf$/);
    expect(name).toContain('abc12345');
  });
});

// ---------------------------------------------------------------------------
// truncateId
// ---------------------------------------------------------------------------

describe('truncateId', () => {
  it('vrátí původní ID pokud je kratší než limit', () => {
    expect(truncateId('abc123', 8)).toBe('abc123');
  });

  it('vrátí původní ID pokud má přesně délku limitu', () => {
    expect(truncateId('abc12345', 8)).toBe('abc12345');
  });

  it('zkrátí ID delší než limit a přidá "..."', () => {
    const result = truncateId('abc12345def6789', 8);
    expect(result).toBe('abc12345...');
  });

  it('zkrácený výsledek má správnou délku (N + 3)', () => {
    const result = truncateId('abc12345def6789xyz', 8);
    expect(result).toHaveLength(8 + 3); // "..." = 3 znaky
  });

  it('funguje s limitem 4', () => {
    expect(truncateId('abcdefgh', 4)).toBe('abcd...');
  });

  it('funguje s UUID-formát ID', () => {
    const uuid = 'abc12345-def6-7890-abcd-ef1234567890';
    const result = truncateId(uuid, 8);
    expect(result).toBe('abc12345...');
  });

  it('prázdný string vrátí prázdný string (kratší než jakýkoliv limit)', () => {
    expect(truncateId('', 8)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// generateTicketPdf — smoke test (integrační)
// ---------------------------------------------------------------------------

describe('generateTicketPdf', () => {
  it('vrátí PdfGenerationResult s neprázdnými pdfBytes (cs)', async () => {
    const data = makeTestData({ language: 'cs' });
    const result = await generateTicketPdf(data);

    expect(result).toBeDefined();
    expect(result.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(result.pdfBytes.length).toBeGreaterThan(0);
  }, 15_000);

  it('pdfBytes začínají PDF magic bytes (%PDF-)', async () => {
    const data = makeTestData();
    const result = await generateTicketPdf(data);

    // PDF header: 25 50 44 46 2D = "%PDF-"
    const header = Buffer.from(result.pdfBytes.slice(0, 5)).toString('ascii');
    expect(header).toBe('%PDF-');
  }, 15_000);

  it('sizeBytes odpovídá délce pdfBytes', async () => {
    const data = makeTestData();
    const result = await generateTicketPdf(data);

    expect(result.sizeBytes).toBe(result.pdfBytes.length);
  }, 15_000);

  it('filename je neprázdný string končící .pdf', async () => {
    const data = makeTestData();
    const result = await generateTicketPdf(data);

    expect(typeof result.filename).toBe('string');
    expect(result.filename.length).toBeGreaterThan(0);
    expect(result.filename).toMatch(/\.pdf$/);
  }, 15_000);

  it('funguje s jazykem "en"', async () => {
    const data = makeTestData({ language: 'en' });
    const result = await generateTicketPdf(data);

    expect(result.pdfBytes.length).toBeGreaterThan(0);
  }, 15_000);

  it('funguje bez zóny a sedadla (volné stání)', async () => {
    const data = makeTestData({ zone: null, seatNumber: null });
    const result = await generateTicketPdf(data);

    expect(result.pdfBytes.length).toBeGreaterThan(0);
  }, 15_000);

  it('funguje s velmi dlouhým názvem akce', async () => {
    const data = makeTestData({
      eventName: 'Velmi Dlouhý Název Akce Který Testuje Zalamování Textu Na Více Řádků V PDF',
    });
    const result = await generateTicketPdf(data);

    expect(result.pdfBytes.length).toBeGreaterThan(0);
  }, 15_000);
});

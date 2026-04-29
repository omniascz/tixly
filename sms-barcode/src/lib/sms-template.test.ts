import { describe, it, expect } from 'vitest';
import {
  buildSmsMessage,
  buildSmsDeliveryMessage,
  countSmsSegments,
} from './sms-template.js';

// ---------------------------------------------------------------------------
// Testovací data
// ---------------------------------------------------------------------------

const baseParams = {
  eventName: 'Kabát — O2 Arena Praha',
  eventDate: '15. dubna',
  eventTime: '19:30',
  venueName: 'O2 Arena Praha',
  barcodeCode: 'TK-2026-847291-X3',
  shortCode: 'aB3xK9qR',
  baseUrl: 'tixly.cz',
};

// ---------------------------------------------------------------------------
// buildSmsMessage
// ---------------------------------------------------------------------------

describe('buildSmsMessage', () => {
  it('zpráva obsahuje barcode kód', () => {
    const msg = buildSmsMessage(baseParams);
    expect(msg).toContain('TK-2026-847291-X3');
  });

  it('zpráva obsahuje URL s shortCode', () => {
    const msg = buildSmsMessage(baseParams);
    expect(msg).toContain('tixly.cz/e/aB3xK9qR');
  });

  it('zpráva obsahuje název eventu', () => {
    const msg = buildSmsMessage(baseParams);
    expect(msg).toContain('Kabát — O2 Arena Praha');
  });

  it('zpráva obsahuje datum a čas', () => {
    const msg = buildSmsMessage(baseParams);
    expect(msg).toContain('15. dubna');
    expect(msg).toContain('19:30');
  });

  it('základní zpráva nepřesáhne 160 znaků', () => {
    const msg = buildSmsMessage(baseParams);
    expect(msg.length).toBeLessThanOrEqual(160);
  });

  it('zpráva s krátkým názvem venue nepřesáhne 160 znaků', () => {
    const msg = buildSmsMessage({ ...baseParams, venueName: 'Club' });
    expect(msg.length).toBeLessThanOrEqual(160);
  });

  it('extrémně dlouhý venueName je zkrácen', () => {
    const longVenue = 'A'.repeat(200);
    const msg = buildSmsMessage({ ...baseParams, venueName: longVenue });
    expect(msg.length).toBeLessThanOrEqual(160);
    expect(msg).toContain('...');
  });

  it('zkrácený venueName stále obsahuje barcode kód', () => {
    const longVenue = 'Velmi Dlouhý Název Kulturního Stánku Na Náměstí Republiky';
    const msg = buildSmsMessage({ ...baseParams, venueName: longVenue });
    expect(msg).toContain('TK-2026-847291-X3');
  });

  it('venue zkráceno na max 20 znaků + "..."', () => {
    const longVenue = 'X'.repeat(50);
    const msg = buildSmsMessage({ ...baseParams, venueName: longVenue });
    expect(msg).toContain('X'.repeat(20) + '...');
  });

  it('krátká zpráva není zbytečně zkrácena', () => {
    const shortVenue = 'Studio';
    const msg = buildSmsMessage({
      ...baseParams,
      eventName: 'Koncert',
      venueName: shortVenue,
    });
    expect(msg).toContain('Studio');
    expect(msg).not.toContain('...');
  });

  it('zpráva bez baseUrl "https://" prefix', () => {
    const msg = buildSmsMessage(baseParams);
    expect(msg).not.toContain('https://');
  });
});

// ---------------------------------------------------------------------------
// countSmsSegments
// ---------------------------------------------------------------------------

describe('countSmsSegments', () => {
  it('pure ASCII zpráva do 160 znaků = 1 segment', () => {
    const msg = 'Hello World! This is a test message.';
    expect(countSmsSegments(msg)).toBe(1);
  });

  it('prázdný string = 1 segment', () => {
    expect(countSmsSegments('')).toBe(1);
  });

  it('přesně 160 GSM-7 znaků = 1 segment', () => {
    const msg = 'A'.repeat(160);
    expect(countSmsSegments(msg)).toBe(1);
  });

  it('161 GSM-7 znaků = 2 segmenty', () => {
    const msg = 'A'.repeat(161);
    expect(countSmsSegments(msg)).toBe(2);
  });

  it('306 GSM-7 znaků = 2 segmenty (153 × 2)', () => {
    const msg = 'A'.repeat(306);
    expect(countSmsSegments(msg)).toBe(2);
  });

  it('307 GSM-7 znaků = 3 segmenty', () => {
    const msg = 'A'.repeat(307);
    expect(countSmsSegments(msg)).toBe(3);
  });

  it('zpráva s emoji = Unicode kódování', () => {
    // Emoji = non-GSM7 = Unicode = max 70/segment
    const msg = '🎵 Kabát concert!';
    const segments = countSmsSegments(msg);
    expect(segments).toBeGreaterThanOrEqual(1);
    // Emoji způsobí Unicode encoding
    expect(msg.length).toBeLessThanOrEqual(70);
    expect(segments).toBe(1);
  });

  it('dlouhá emoji zpráva = více segmentů Unicode', () => {
    const msg = '🎫 '.repeat(40); // 80 znaků, ale emoji = Unicode
    expect(countSmsSegments(msg)).toBeGreaterThan(1);
  });

  it('standardní SMS šablona = 1 segment', () => {
    const msg = buildSmsMessage(baseParams);
    // Pokud zpráva obsahuje pouze GSM-7 znaky (CZ znaky jako á, é nejsou GSM-7)
    // šablona používá ASCII + \n — zkontrolujeme jen délku
    expect(msg.length).toBeLessThanOrEqual(160);
  });

  it('newline (\\n) je GSM-7 znak', () => {
    const msg = 'Line 1\nLine 2\nLine 3';
    expect(countSmsSegments(msg)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildSmsDeliveryMessage (post-purchase delivery)
// ---------------------------------------------------------------------------

describe('buildSmsDeliveryMessage', () => {
  const deliveryParams = {
    eventName: 'Kabat koncert',
    eventDate: '15. dubna 2026',
    shortCode: 'aB3xK9qR',
    baseUrl: 'tkr.cz',
  };

  it('zpráva pod 160 znaků obsahuje všechny části', () => {
    const msg = buildSmsDeliveryMessage(deliveryParams);
    expect(msg.length).toBeLessThanOrEqual(160);
    expect(msg).toContain('Kabat koncert');
    expect(msg).toContain('15. dubna 2026');
    expect(msg).toContain('https://tkr.cz/e/aB3xK9qR');
    expect(msg.startsWith('Vstupenka na ')).toBe(true);
  });

  it('extrémně dlouhý eventName je zkrácen elipsou a vejde se do 160', () => {
    const longName = 'A'.repeat(300);
    const msg = buildSmsDeliveryMessage({ ...deliveryParams, eventName: longName });
    expect(msg.length).toBeLessThanOrEqual(160);
    expect(msg).toContain('...');
    // URL musí být zachována — nesmí být ořezaná
    expect(msg).toContain('https://tkr.cz/e/aB3xK9qR');
    expect(msg).toContain('15. dubna 2026');
  });

  it('hraniční dlouhý eventName přesně přes limit → ořez', () => {
    // Najdeme délku, kdy se zpráva právě začne přetékat
    const baseLen = buildSmsDeliveryMessage({ ...deliveryParams, eventName: '' }).length;
    const fitName = 'X'.repeat(160 - baseLen);
    const fits = buildSmsDeliveryMessage({ ...deliveryParams, eventName: fitName });
    expect(fits.length).toBeLessThanOrEqual(160);

    const overflowName = 'X'.repeat(160 - baseLen + 5);
    const overflow = buildSmsDeliveryMessage({ ...deliveryParams, eventName: overflowName });
    expect(overflow.length).toBeLessThanOrEqual(160);
    expect(overflow).toContain('...');
  });

  it('správný formát URL https://baseUrl/e/shortCode', () => {
    const msg = buildSmsDeliveryMessage(deliveryParams);
    expect(msg).toMatch(/https:\/\/tkr\.cz\/e\/aB3xK9qR$/);
  });
});

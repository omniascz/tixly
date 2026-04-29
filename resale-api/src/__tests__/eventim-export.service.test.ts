import { describe, it, expect, vi } from 'vitest';
import {
  generateEventimXml,
  createExportJob,
  generateExport,
  getExportJob,
  markSubmitted,
} from '../services/eventim-export.service.js';
import type { DbAdapter, EventData } from '../services/eventim-export.service.js';

function makeEventData(overrides: Partial<EventData> = {}): EventData {
  return {
    id: 'event-001',
    name: 'Letní Slavnosti 2026',
    description: 'Největší letní festival v CZ',
    dateStart: '2026-07-15T18:00:00',
    dateEnd: '2026-07-15T23:00:00',
    venueId: 'venue-001',
    venueName: 'O2 Arena',
    venueCity: 'Praha',
    venueCountry: 'CZ',
    promoterName: 'Live Nation CZ',
    currency: 'CZK',
    ticketTypes: [
      { id: 'tt-001', name: 'Standard', priceHellers: 99000, capacity: 10000, available: 8500 },
      { id: 'tt-002', name: 'VIP', priceHellers: 299000, capacity: 500, available: 120 },
    ],
    ...overrides,
  };
}

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-001',
    event_id: 'event-001',
    promoter_id: 'promoter-001',
    status: 'pending',
    xml_payload: null,
    eventim_event_id: null,
    error_message: null,
    last_exported_at: null,
    submitted_at: null,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

describe('generateEventimXml', () => {
  it('generuje validní Eventim XML s hlavičkou', () => {
    const xml = generateEventimXml(makeEventData());

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<EventimFeed version="2.0"');
  });

  it('obsahuje data akce v XML', () => {
    const xml = generateEventimXml(makeEventData());

    expect(xml).toContain('Letní Slavnosti 2026');
    expect(xml).toContain('event-001');
    expect(xml).toContain('O2 Arena');
    expect(xml).toContain('Praha');
    expect(xml).toContain('CZ');
  });

  it('obsahuje typy vstupenek s cenami v hlavní jednotce', () => {
    const xml = generateEventimXml(makeEventData());

    expect(xml).toContain('Standard');
    expect(xml).toContain('990.00');   // 99000 hellers = 990 CZK
    expect(xml).toContain('VIP');
    expect(xml).toContain('2990.00');  // 299000 hellers = 2990 CZK
    expect(xml).toContain('currency="CZK"');
  });

  it('escapuje HTML znaky v názvech', () => {
    const xml = generateEventimXml(makeEventData({ name: 'Akce & Fest <2026>' }));

    expect(xml).toContain('Akce &amp; Fest &lt;2026&gt;');
    expect(xml).not.toContain('<2026>');
  });

  it('uvede dostupnost a kapacitu pro každý typ vstupenky', () => {
    const xml = generateEventimXml(makeEventData());

    expect(xml).toContain('<Capacity>10000</Capacity>');
    expect(xml).toContain('<Available>8500</Available>');
  });
});

describe('createExportJob', () => {
  it('vytvoří nový export job ve stavu pending', async () => {
    const db = makeDb([[makeJobRow()]]);

    const result = await createExportJob('event-001', 'promoter-001', db);

    expect(result.eventId).toBe('event-001');
    expect(result.status).toBe('pending');
    expect(result.xmlPayload).toBeNull();
  });
});

describe('generateExport', () => {
  it('vygeneruje XML a aktualizuje job na done', async () => {
    const db = makeDb([
      [makeJobRow({ status: 'done', xml_payload: '<EventimFeed/>', last_exported_at: '2026-04-14T10:05:00Z' })],
    ], vi.fn());

    const result = await generateExport('job-001', makeEventData(), db);

    expect(result.status).toBe('done');
    expect(result.xmlPayload).toBeTruthy();
    expect(result.lastExportedAt).toBeTruthy();
  });

  it('vyhodí VALIDATION_ERROR bez typů vstupenek', async () => {
    const db = makeDb([]);

    await expect(generateExport('job-001', makeEventData({ ticketTypes: [] }), db))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getExportJob', () => {
  it('vrátí existující job pro akci', async () => {
    const db = makeDb([[makeJobRow({ status: 'done' })]]);

    const result = await getExportJob('event-001', db);

    expect(result).not.toBeNull();
    expect(result?.status).toBe('done');
  });

  it('vrátí null pokud job neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getExportJob('nonexistent', db);

    expect(result).toBeNull();
  });
});

describe('markSubmitted', () => {
  it('označí job jako odeslaný do Eventim', async () => {
    const db = makeDb([
      [makeJobRow({ status: 'submitted', eventim_event_id: 'EVT-123456', submitted_at: '2026-04-14T11:00:00Z' })],
    ], vi.fn());

    const result = await markSubmitted('job-001', 'EVT-123456', db);

    expect(result.status).toBe('submitted');
    expect(result.eventimEventId).toBe('EVT-123456');
    expect(result.submittedAt).toBeTruthy();
  });
});

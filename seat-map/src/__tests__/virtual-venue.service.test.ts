import { describe, it, expect, vi } from 'vitest';
import {
  upsertSectionPanorama,
  getSectionPanorama,
  listSectionPanoramas,
  upsertSeatPreview,
  getSeatPreview,
  getSeatOrSectionPreview,
} from '../services/virtual-venue.service.js';
import type { DbAdapter } from '../services/virtual-venue.service.js';

function makePanoramaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pan-001',
    venue_id: 'venue-001',
    section_id: 'sec-A',
    panorama_url: 'https://cdn.example.com/panoramas/sec-a.jpg',
    thumbnail_url: 'https://cdn.example.com/panoramas/sec-a-thumb.jpg',
    fov_degrees: 90,
    pitch_degrees: '0.00',
    yaw_degrees: '180.00',
    label: 'Sekce A — Pohled na pódium',
    uploaded_by: 'staff-001',
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makePreviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prev-001',
    venue_id: 'venue-001',
    seat_id: 'seat-A1',
    preview_url: 'https://cdn.example.com/seats/a1.jpg',
    thumbnail_url: 'https://cdn.example.com/seats/a1-thumb.jpg',
    view_description: 'Přímý výhled na pódium, žádná překážka',
    view_quality: 'excellent',
    uploaded_by: 'staff-001',
    created_at: '2026-04-14T10:00:00Z',
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

describe('upsertSectionPanorama', () => {
  it('vloží nebo aktualizuje panorama sekce', async () => {
    const db = makeDb([[makePanoramaRow()]]);

    const result = await upsertSectionPanorama('venue-001', 'sec-A', {
      panoramaUrl: 'https://cdn.example.com/panoramas/sec-a.jpg',
      label: 'Sekce A — Pohled na pódium',
      yawDegrees: 180,
      uploadedBy: 'staff-001',
    }, db);

    expect(result.sectionId).toBe('sec-A');
    expect(result.panoramaUrl).toBe('https://cdn.example.com/panoramas/sec-a.jpg');
    expect(result.yawDegrees).toBe(180);
  });

  it('vyhodí VALIDATION_ERROR pro non-HTTPS URL', async () => {
    const db = makeDb([]);

    await expect(upsertSectionPanorama('venue-001', 'sec-A', {
      panoramaUrl: 'http://insecure.example.com/panorama.jpg',
      uploadedBy: 'staff-001',
    }, db)).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getSectionPanorama', () => {
  it('vrátí panorama sekce', async () => {
    const db = makeDb([[makePanoramaRow()]]);

    const result = await getSectionPanorama('venue-001', 'sec-A', db);

    expect(result).not.toBeNull();
    expect(result?.label).toBe('Sekce A — Pohled na pódium');
    expect(result?.pitchDegrees).toBe(0);
  });

  it('vrátí null pro sekci bez panorama', async () => {
    const db = makeDb([[]]); // empty

    const result = await getSectionPanorama('venue-001', 'sec-unknown', db);

    expect(result).toBeNull();
  });
});

describe('listSectionPanoramas', () => {
  it('vrátí všechna panoramata pro venue', async () => {
    const db = makeDb([[
      makePanoramaRow({ id: 'pan-001', section_id: 'sec-A' }),
      makePanoramaRow({ id: 'pan-002', section_id: 'sec-B', label: 'Sekce B' }),
    ]]);

    const result = await listSectionPanoramas('venue-001', db);

    expect(result).toHaveLength(2);
    expect(result[1].sectionId).toBe('sec-B');
  });
});

describe('upsertSeatPreview', () => {
  it('vloží nebo aktualizuje náhled sedadla', async () => {
    const db = makeDb([[makePreviewRow()]]);

    const result = await upsertSeatPreview('venue-001', 'seat-A1', {
      previewUrl: 'https://cdn.example.com/seats/a1.jpg',
      viewDescription: 'Přímý výhled na pódium',
      viewQuality: 'excellent',
      uploadedBy: 'staff-001',
    }, db);

    expect(result.seatId).toBe('seat-A1');
    expect(result.viewQuality).toBe('excellent');
  });

  it('vyhodí VALIDATION_ERROR pro non-HTTPS URL', async () => {
    const db = makeDb([]);

    await expect(upsertSeatPreview('venue-001', 'seat-A1', {
      previewUrl: 'ftp://example.com/seat.jpg',
      uploadedBy: 'staff-001',
    }, db)).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getSeatPreview', () => {
  it('vrátí náhled sedadla', async () => {
    const db = makeDb([[makePreviewRow()]]);

    const result = await getSeatPreview('venue-001', 'seat-A1', db);

    expect(result).not.toBeNull();
    expect(result?.viewQuality).toBe('excellent');
  });

  it('vrátí null pro sedadlo bez náhledu', async () => {
    const db = makeDb([[]]); // empty

    const result = await getSeatPreview('venue-001', 'seat-Z99', db);

    expect(result).toBeNull();
  });
});

describe('getSeatOrSectionPreview', () => {
  it('vrátí per-seat preview pokud existuje', async () => {
    const db = makeDb([
      [makePreviewRow()],    // seat preview found
    ]);

    const result = await getSeatOrSectionPreview('venue-001', 'seat-A1', 'sec-A', db);

    expect(result?.type).toBe('seat');
  });

  it('fallback na panorama sekce pokud seat preview chybí', async () => {
    const db = makeDb([
      [],                    // no seat preview
      [makePanoramaRow()],   // section panorama found
    ]);

    const result = await getSeatOrSectionPreview('venue-001', 'seat-Z99', 'sec-A', db);

    expect(result?.type).toBe('section');
  });

  it('vrátí null pokud chybí oboje', async () => {
    const db = makeDb([[], []]); // both empty

    const result = await getSeatOrSectionPreview('venue-001', 'seat-Z99', 'sec-X', db);

    expect(result).toBeNull();
  });
});

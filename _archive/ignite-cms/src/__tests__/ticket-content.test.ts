// =============================================================================
// Ignite CMS — unit testy (Feature #48)
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  getTicketContent,
  upsertTicketContent,
  publishTicketContent,
  deleteTicketContent,
} from '../services/ticket-content.service.js';
import type { DbAdapter } from '../services/ticket-content.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'content-001',
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    venue_info: { address: 'Václavské náměstí 1, Praha' },
    map_config: { lat: 50.0806, lng: 14.4283, zoom: 15, markerLabel: 'Venue' },
    upsell_blocks: [],
    sponsor_blocks: [],
    custom_message: null,
    weather_enabled: false,
    is_published: false,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResult: unknown[] = [], executeMock = vi.fn()): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue(queryResult),
    execute: executeMock,
  };
}

// ---------------------------------------------------------------------------
// getTicketContent
// ---------------------------------------------------------------------------

describe('getTicketContent', () => {
  it('vrátí obsah vstupenky pokud existuje', async () => {
    const db = makeDb([makeRow()]);
    const result = await getTicketContent(EVENT_ID, PROMOTER_ID, db);

    expect(result).not.toBeNull();
    expect(result!.eventId).toBe(EVENT_ID);
    expect(result!.promoterId).toBe(PROMOTER_ID);
    expect(result!.venueInfo).toEqual({ address: 'Václavské náměstí 1, Praha' });
  });

  it('vrátí null pokud obsah neexistuje', async () => {
    const db = makeDb([]);
    const result = await getTicketContent(EVENT_ID, PROMOTER_ID, db);
    expect(result).toBeNull();
  });

  it('SQL dotaz je tenant-scoped (obsahuje event_id I promoter_id)', async () => {
    const db = makeDb([]);
    await getTicketContent(EVENT_ID, PROMOTER_ID, db);

    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('event_id = $1');
    expect(sql).toContain('promoter_id = $2');
  });
});

// ---------------------------------------------------------------------------
// upsertTicketContent
// ---------------------------------------------------------------------------

describe('upsertTicketContent', () => {
  it('vytvoří nebo aktualizuje obsah a vrátí mapovaný objekt', async () => {
    const db = makeDb([makeRow({ weather_enabled: true })]);

    const result = await upsertTicketContent(EVENT_ID, PROMOTER_ID, {
      venueInfo: { address: 'Václavské náměstí 1, Praha' },
      weatherEnabled: true,
    }, db);

    expect(result.weatherEnabled).toBe(true);
    expect(result.isPublished).toBe(false);
  });

  it('odmítne customMessage delší než 500 znaků', async () => {
    const db = makeDb([]);

    await expect(
      upsertTicketContent(EVENT_ID, PROMOTER_ID, {
        customMessage: 'A'.repeat(501),
      }, db),
    ).rejects.toThrow('customMessage exceeds 500 characters');
  });

  it('odmítne více než 10 upsell bloků', async () => {
    const db = makeDb([]);
    const tooMany = Array.from({ length: 11 }, (_, i) => ({
      title: `Block ${i}`,
      ctaUrl: 'https://example.com',
      ctaLabel: 'Koupit',
    }));

    await expect(
      upsertTicketContent(EVENT_ID, PROMOTER_ID, { upsellBlocks: tooMany }, db),
    ).rejects.toThrow('maximum 10 upsell blocks allowed');
  });

  it('odmítne více než 5 sponzorských bloků', async () => {
    const db = makeDb([]);
    const tooMany = Array.from({ length: 6 }, (_, i) => ({
      name: `Sponsor ${i}`,
      logoUrl: 'https://example.com/logo.png',
      displayOrder: i,
    }));

    await expect(
      upsertTicketContent(EVENT_ID, PROMOTER_ID, { sponsorBlocks: tooMany }, db),
    ).rejects.toThrow('maximum 5 sponsor blocks allowed');
  });

  it('SQL dotaz obsahuje ON CONFLICT pro upsert', async () => {
    const db = makeDb([makeRow()]);

    await upsertTicketContent(EVENT_ID, PROMOTER_ID, {}, db);

    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE');
  });
});

// ---------------------------------------------------------------------------
// publishTicketContent
// ---------------------------------------------------------------------------

describe('publishTicketContent', () => {
  it('nastaví is_published = true a vrátí aktualizovaný obsah', async () => {
    const db = makeDb([makeRow({ is_published: true })]);

    const result = await publishTicketContent(EVENT_ID, PROMOTER_ID, db);

    expect(result.isPublished).toBe(true);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('is_published = true');
    expect(sql).toContain('promoter_id = $2'); // tenant-scoped
  });

  it('vyhodí NOT_FOUND pokud obsah pro akci neexistuje', async () => {
    const db = makeDb([]);

    await expect(
      publishTicketContent(EVENT_ID, PROMOTER_ID, db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// deleteTicketContent
// ---------------------------------------------------------------------------

describe('deleteTicketContent', () => {
  it('volá DELETE s event_id a promoter_id (tenant-scoped)', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await deleteTicketContent(EVENT_ID, PROMOTER_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('event_id = $1');
    expect(sql).toContain('promoter_id = $2');
  });
});

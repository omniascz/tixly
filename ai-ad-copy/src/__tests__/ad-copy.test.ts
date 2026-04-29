import { describe, it, expect, vi } from 'vitest';
import { generateAdCopy, listGeneratedCopies } from '../services/ad-copy.service.js';
import type { DbAdapter } from '../services/ad-copy.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';

function makeCopyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'copy-001',
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    platform: 'facebook',
    headlines: ['Headline 1', 'Headline 2', 'Headline 3'],
    body_copy: ['Body 1', 'Body 2'],
    call_to_actions: ['Get Tickets', 'Learn More', 'Reserve Now'],
    generated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('generateAdCopy', () => {
  it('volá AI s prompt a uloží vygenerovaný copy', async () => {
    const callAi = vi.fn().mockResolvedValue(JSON.stringify({
      headlines: ['Headline 1', 'Headline 2'],
      bodyCopy: ['Body 1'],
      callToActions: ['Get Tickets'],
    }));
    const db = makeDb([[makeCopyRow()]]);

    const result = await generateAdCopy(EVENT_ID, PROMOTER_ID, {
      eventTitle: 'Rock Concert',
      eventDescription: 'Amazing live rock music',
      eventDate: '2026-04-20',
      venueAddress: 'O2 Arena, Praha',
      targetAudience: 'professionals',
      eventCategory: 'Concert',
      lang: 'cs',
    }, callAi, db);

    expect(result.headlines).toHaveLength(3);
    expect(result.platform).toBe('facebook');
    expect(callAi).toHaveBeenCalledWith(
      expect.stringContaining('Rock Concert'),
      expect.objectContaining({ model: 'haiku' }),
    );
  });

  it('parsuje JSON z markdown fences', async () => {
    const callAi = vi.fn().mockResolvedValue(`\`\`\`json
{
  "headlines": ["H1", "H2"],
  "bodyCopy": ["B1"],
  "callToActions": ["CTA1"]
}
\`\`\``);
    const db = makeDb([[makeCopyRow()]]);

    const result = await generateAdCopy(EVENT_ID, PROMOTER_ID, {
      eventTitle: 'Event',
      eventDescription: 'Desc',
      eventDate: '2026-04-20',
      venueAddress: 'Venue',
      targetAudience: 'general',
      eventCategory: 'Music',
      lang: 'en',
    }, callAi, db);

    expect(result.headlines).toEqual(['H1', 'H2']);
  });

  it('vyhodí AI_ERROR pokud AI selže', async () => {
    const callAi = vi.fn().mockRejectedValue(new Error('Rate limit'));
    const db = makeDb([]);

    await expect(
      generateAdCopy(EVENT_ID, PROMOTER_ID, {
        eventTitle: 'Event',
        eventDescription: 'Desc',
        eventDate: '2026-04-20',
        venueAddress: 'Venue',
        targetAudience: 'general',
        eventCategory: 'Music',
        lang: 'cs',
      }, callAi, db),
    ).rejects.toThrow('AI_ERROR');
  });
});

describe('listGeneratedCopies', () => {
  it('vrátí všechny vygenerované copies pro event (tenant-scoped)', async () => {
    const db = makeDb([[
      makeCopyRow({ id: 'copy-1' }),
      makeCopyRow({ id: 'copy-2', generated_at: '2026-04-14T11:00:00Z' }),
    ]]);

    const result = await listGeneratedCopies(EVENT_ID, PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('promoter_id = $2');
  });
});

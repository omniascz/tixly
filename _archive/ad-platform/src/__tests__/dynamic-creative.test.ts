import { describe, it, expect, vi } from 'vitest';
import {
  createTemplate,
  listTemplates,
  renderCreative,
  activateTemplate,
} from '../services/dynamic-creative.service.js';
import type { DbAdapter } from '../services/dynamic-creative.service.js';

const PROMOTER_ID = 'promoter-001';
const TEMPLATE_ID = 'template-001';
const EVENT_ID = 'event-001';

function makeTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    promoter_id: PROMOTER_ID,
    title: 'Concert Ad',
    template_text: '{{eventTitle}} — {{eventDate}} at {{eventTime}} in {{venueName}}. Just {{price}} CZK!',
    image_url: 'https://assets.example.com/concert-bg.jpg',
    cta_text: 'Get Tickets',
    status: 'draft',
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
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

describe('createTemplate', () => {
  it('vytvoří template v draft statusu', async () => {
    const db = makeDb([[makeTemplateRow()]]);

    const result = await createTemplate(PROMOTER_ID, {
      title: 'Concert Ad',
      templateText: '{{eventTitle}} at {{eventTime}}',
      imageUrl: 'https://...',
      ctaText: 'Get Tickets',
    }, db);

    expect(result.status).toBe('draft');
    expect(result.templateText).toContain('{{eventTitle}}');
  });
});

describe('listTemplates', () => {
  it('vrátí aktivní templates pro promotéra', async () => {
    const db = makeDb([[
      makeTemplateRow({ id: 'tpl-1', status: 'active' }),
      makeTemplateRow({ id: 'tpl-2', status: 'active' }),
    ]]);

    const result = await listTemplates(PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    expect(result.every(t => t.status === 'active')).toBe(true);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("status = 'active'");
  });
});

describe('renderCreative', () => {
  it('nahradí placeholders za konkrétní hodnoty', async () => {
    const db = makeDb([[makeTemplateRow({ status: 'active' })]]);

    const result = await renderCreative(TEMPLATE_ID, EVENT_ID, {
      eventTitle: 'Rolling Stones Live',
      eventDate: '2026-04-20',
      eventTime: '19:00',
      priceHalire: 99900,  // 999 CZK
      venueName: 'O2 Arena',
    }, db);

    expect(result.renderedText).toContain('Rolling Stones Live');
    expect(result.renderedText).toContain('2026-04-20');
    expect(result.renderedText).toContain('19:00');
    expect(result.renderedText).toContain('O2 Arena');
    expect(result.renderedText).toContain('999.00');
  });

  it('vygeneruje previewUrl pro image rendering API', async () => {
    const db = makeDb([[makeTemplateRow({ status: 'active' })]]);

    const result = await renderCreative(TEMPLATE_ID, EVENT_ID, {
      eventTitle: 'Concert',
      eventDate: '2026-04-20',
      eventTime: '19:00',
      priceHalire: 50000,
      venueName: 'Venue',
    }, db);

    expect(result.previewUrl).toContain('creative-preview.internal');
    expect(result.previewUrl).toContain('Concert');
  });

  it('vyhodí NOT_FOUND pokud template není active', async () => {
    const db = makeDb([[]]);

    await expect(
      renderCreative(TEMPLATE_ID, EVENT_ID, {
        eventTitle: '', eventDate: '', eventTime: '', priceHalire: 0, venueName: '',
      }, db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

describe('activateTemplate', () => {
  it('změní status z draft na active', async () => {
    const db = makeDb([[makeTemplateRow({ status: 'active' })]]);

    const result = await activateTemplate(TEMPLATE_ID, PROMOTER_ID, db);

    expect(result.status).toBe('active');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("status = 'active'");
  });

  it('je tenant-scoped na promoter_id', async () => {
    const db = makeDb([[]]);

    await expect(
      activateTemplate(TEMPLATE_ID, 'wrong-promoter', db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

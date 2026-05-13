import { describe, it, expect, vi } from 'vitest';
import {
  createResource,
  getResource,
  listResources,
  markHelpful,
} from '../services/resource-hub.service.js';
import type { DbAdapter } from '../services/resource-hub.service.js';

const RESOURCE_ID = 'resource-001';

function makeResourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESOURCE_ID,
    type: 'guide',
    category: 'pricing',
    title: 'How to Price Your Event',
    description: 'Step-by-step guide to pricing',
    content_html: '<h1>Pricing Guide</h1><p>...</p>',
    download_url: null,
    views: 100,
    helpful_count: 25,
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

describe('createResource', () => {
  it('vytvoří nový resource s inicializací views=0, helpful_count=0', async () => {
    const db = makeDb([[makeResourceRow({ views: 0, helpful_count: 0 })]]);

    const result = await createResource({
      type: 'guide',
      category: 'pricing',
      title: 'How to Price Your Event',
      description: 'Guide',
      contentHtml: '<h1>Content</h1>',
    }, db);

    expect(result.type).toBe('guide');
    expect(result.views).toBe(0);
    expect(result.helpfulCount).toBe(0);
  });

  it('přijme downloadUrl pro template soubory', async () => {
    const db = makeDb([[makeResourceRow({ download_url: 'https://s3.../template.xlsx' })]]);

    const result = await createResource({
      type: 'template',
      category: 'operations',
      title: 'Budget Template',
      description: 'Desc',
      contentHtml: 'Content',
      downloadUrl: 'https://s3.../template.xlsx',
    }, db);

    expect(result.downloadUrl).toBe('https://s3.../template.xlsx');
  });
});

describe('getResource', () => {
  it('vrátí resource a inkrementuje views counter', async () => {
    const db = makeDb([[makeResourceRow({ views: 101 })]]);

    const result = await getResource(RESOURCE_ID, db);

    expect(result).not.toBeNull();
    expect(result?.views).toBe(101);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('views = views + 1');
  });

  it('vrátí null pokud resource neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getResource(RESOURCE_ID, db);

    expect(result).toBeNull();
  });
});

describe('listResources', () => {
  it('vrátí resources seřazené dle views a helpful_count (desc)', async () => {
    const db = makeDb([[
      makeResourceRow({ id: 'r1', views: 500, helpful_count: 50 }),
      makeResourceRow({ id: 'r2', views: 200, helpful_count: 20 }),
    ]]);

    const result = await listResources(undefined, undefined, db);

    expect(result).toHaveLength(2);
    expect(result[0].views).toBeGreaterThanOrEqual(result[1].views);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY views DESC');
  });

  it('filtruje dle kategorie a typu', async () => {
    const db = makeDb([[makeResourceRow({ category: 'pricing', type: 'guide' })]]);

    const result = await listResources('pricing', 'guide', db);

    expect(result).toHaveLength(1);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('category = $1');
    expect(sql).toContain('type = $2');
  });
});

describe('markHelpful', () => {
  it('inkrementuje helpful_count', async () => {
    const db = makeDb([[makeResourceRow({ helpful_count: 26 })]]);

    const result = await markHelpful(RESOURCE_ID, db);

    expect(result.helpfulCount).toBe(26);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('helpful_count = helpful_count + 1');
  });

  it('vyhodí NOT_FOUND pokud resource neexistuje', async () => {
    const db = makeDb([[]]);

    await expect(markHelpful(RESOURCE_ID, db)).rejects.toThrow('NOT_FOUND');
  });
});

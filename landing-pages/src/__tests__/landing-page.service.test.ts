import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceDeps } from '../lib/service-container.js';
import { LandingPageError } from '../lib/landing-errors.js';
import {
  createPage,
  getPageById,
  getPageBySlug,
  getSitemapEntries,
  publishPage,
  setPageBlocks,
} from '../services/landing-page.service.js';

function makeDeps() {
  const query = vi.fn();
  const execute = vi.fn();
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ query, execute }),
  );
  const deps: ServiceDeps = {
    db: { query, execute, transaction } as unknown as ServiceDeps['db'],
  };
  return { deps, query, execute, transaction };
}

const PROMOTER = 'promoter-1';

const fakePageRow = {
  id: 'page-1',
  promoter_id: PROMOTER,
  slug: 'ems-zada-pater',
  title: 'EMS záda',
  meta_title: 'T',
  meta_description: 'D',
  meta_keywords: null,
  og_title: null,
  og_description: null,
  og_image: null,
  canonical_url: null,
  hreflang: null,
  status: 'draft',
  static_html_path: null,
  published_at: null,
  created_at: new Date('2026-04-01'),
  updated_at: new Date('2026-04-01'),
};

describe('createPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates page happy path', async () => {
    const { deps, query } = makeDeps();
    query
      .mockResolvedValueOnce([]) // slug check
      .mockResolvedValueOnce([fakePageRow]); // insert

    const page = await createPage(
      PROMOTER,
      { slug: 'ems-zada-pater', title: 'X', metaTitle: 'T', metaDescription: 'D' },
      deps,
    );
    expect(page.id).toBe('page-1');
    expect(page.promoterId).toBe(PROMOTER);
  });

  it('throws SLUG_DUPLICATE on existing slug', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([{ id: 'existing' }]);
    await expect(
      createPage(
        PROMOTER,
        { slug: 'ems-zada-pater', title: 'X', metaTitle: 'T', metaDescription: 'D' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'SLUG_DUPLICATE' });
  });
});

describe('getPageBySlug', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for unpublished page (public consumer)', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]); // nothing matches status='published'
    const result = await getPageBySlug(PROMOTER, 'ems-zada-pater', deps);
    expect(result).toBeNull();
  });

  it('returns page with blocks when published', async () => {
    const { deps, query } = makeDeps();
    query
      .mockResolvedValueOnce([{ ...fakePageRow, status: 'published' }])
      .mockResolvedValueOnce([]);
    const result = await getPageBySlug(PROMOTER, 'ems-zada-pater', deps);
    expect(result?.id).toBe('page-1');
    expect(result?.blocks).toEqual([]);
  });
});

describe('getPageById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws PAGE_NOT_FOUND for cross-tenant access', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]); // scoped by promoter_id returns empty
    await expect(
      getPageById('page-1', 'other-promoter', deps),
    ).rejects.toBeInstanceOf(LandingPageError);
  });
});

describe('setPageBlocks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces all blocks atomically in transaction', async () => {
    const { deps, query, execute, transaction } = makeDeps();
    query
      .mockResolvedValueOnce([{ id: 'page-1' }]) // ownership
      .mockResolvedValueOnce([
        {
          id: 'b1',
          page_id: 'page-1',
          type: 'hero',
          position: 0,
          data: {},
          variant: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

    const blocks = await setPageBlocks(
      'page-1',
      PROMOTER,
      [{ type: 'hero', position: 0, data: { title: 'Hi' } }],
      deps,
    );

    expect(transaction).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM cms.content_blocks'),
      ['page-1'],
    );
    expect(blocks).toHaveLength(1);
  });
});

describe('publishPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets status published and published_at', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([
      { ...fakePageRow, status: 'published', published_at: new Date() },
    ]);
    const page = await publishPage('page-1', PROMOTER, deps);
    expect(page.status).toBe('published');
    expect(query.mock.calls[0]?.[0]).toContain("status = 'published'");
  });
});

describe('getSitemapEntries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only published pages', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([
      { slug: '/', updated_at: new Date('2026-04-01') },
      { slug: 'ems-zada-pater', updated_at: new Date('2026-04-02') },
    ]);
    const entries = await getSitemapEntries(PROMOTER, deps);
    expect(entries).toHaveLength(2);
    expect(query.mock.calls[0]?.[0]).toContain("status = 'published'");
  });
});

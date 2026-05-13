import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceDeps } from '../lib/service-container.js';
import { SnippetError } from '../lib/snippet-errors.js';
import {
  deleteSnippet,
  getSnippet,
  getSnippetsByKeys,
  upsertSnippet,
} from '../services/snippet.service.js';

function makeDeps() {
  const query = vi.fn();
  const execute = vi.fn();
  const transaction = vi.fn();
  const deps: ServiceDeps = {
    db: { query, execute, transaction } as unknown as ServiceDeps['db'],
  };
  return { deps, query };
}

const PROMOTER = 'promoter-1';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'snip-1',
  promoter_id: PROMOTER,
  key: 'homepage.hero',
  label: 'Hero',
  format: 'plain',
  content: 'Ahoj světe',
  locale: 'cs',
  category: null,
  updated_by: 'user-1',
  updated_at: new Date('2026-04-08'),
  created_at: new Date('2026-04-01'),
  ...over,
});

describe('upsertSnippet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates or updates existing', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([row()]);
    const s = await upsertSnippet(
      PROMOTER,
      { key: 'homepage.hero', label: 'Hero', format: 'plain', content: 'Ahoj světe' },
      'user-1',
      deps,
    );
    expect(s.key).toBe('homepage.hero');
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT');
  });

  it('rejects content over 64KB', async () => {
    const { deps } = makeDeps();
    const big = 'a'.repeat(64 * 1024 + 1);
    await expect(
      upsertSnippet(
        PROMOTER,
        { key: 'k', label: 'L', format: 'plain', content: big },
        'u',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'CONTENT_TOO_LARGE' });
  });

  it('rejects missing key', async () => {
    const { deps } = makeDeps();
    await expect(
      upsertSnippet(
        PROMOTER,
        { key: '', label: 'L', format: 'plain', content: 'x' },
        'u',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'KEY_REQUIRED' });
  });

  it('rejects invalid format', async () => {
    const { deps } = makeDeps();
    await expect(
      upsertSnippet(
        PROMOTER,
        { key: 'k', label: 'L', format: 'xml' as never, content: 'x' },
        'u',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' });
  });
});

describe('getSnippetsByKeys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns map keyed by snippet key', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([
      row({ key: 'a' }),
      row({ id: 'snip-2', key: 'b' }),
    ]);
    const result = await getSnippetsByKeys(PROMOTER, ['a', 'b'], 'cs', deps);
    expect(Object.keys(result).sort()).toEqual(['a', 'b']);
  });

  it('returns empty map for empty keys (no query)', async () => {
    const { deps, query } = makeDeps();
    const result = await getSnippetsByKeys(PROMOTER, [], 'cs', deps);
    expect(result).toEqual({});
    expect(query).not.toHaveBeenCalled();
  });
});

describe('getSnippet cross-tenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when scoped query finds nothing', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]);
    const r = await getSnippet('other-promoter', 'homepage.hero', 'cs', deps);
    expect(r).toBeNull();
  });
});

describe('deleteSnippet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 404 when nothing deleted', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]);
    await expect(
      deleteSnippet(PROMOTER, 'missing', 'cs', deps),
    ).rejects.toBeInstanceOf(SnippetError);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceDeps } from '../lib/service-container.js';
import {
  deleteConfig,
  getConfig,
  getConfigOrDefault,
  parseValue,
  setConfig,
} from '../services/runtime-config.service.js';

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
  promoter_id: PROMOTER,
  key: 'presun_limit_hodin',
  raw_value: '0.5',
  value_type: 'duration_hours',
  label: null,
  description: null,
  category: null,
  validation: null,
  updated_by: 'user-1',
  updated_at: new Date('2026-04-08'),
  ...over,
});

describe('parseValue', () => {
  it('parses integer', () => {
    expect(parseValue('42', 'integer')).toBe(42);
  });
  it('parses float', () => {
    expect(parseValue('3.14', 'float')).toBeCloseTo(3.14);
  });
  it('parses boolean true/false', () => {
    expect(parseValue('true', 'boolean')).toBe(true);
    expect(parseValue('false', 'boolean')).toBe(false);
  });
  it('parses json', () => {
    expect(parseValue('{"a":1}', 'json')).toEqual({ a: 1 });
  });
  it('parses duration_hours', () => {
    expect(parseValue('0.5', 'duration_hours')).toBe(0.5);
  });
  it('parses string as-is', () => {
    expect(parseValue('hello', 'string')).toBe('hello');
  });
  it('throws on bad integer', () => {
    expect(() => parseValue('abc', 'integer')).toThrow();
  });
  it('throws on bad json', () => {
    expect(() => parseValue('{bad', 'json')).toThrow();
  });
});

describe('getConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns parsed value', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([row()]);
    const value = await getConfig<number>(PROMOTER, 'presun_limit_hodin', deps);
    expect(value).toBe(0.5);
  });

  it('cross-promoter returns null', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]);
    const value = await getConfig('other', 'presun_limit_hodin', deps);
    expect(value).toBeNull();
  });
});

describe('getConfigOrDefault', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns default when missing', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]);
    const value = await getConfigOrDefault(PROMOTER, 'missing', 24, deps);
    expect(value).toBe(24);
  });

  it('returns stored value when present', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([row({ raw_value: '12', value_type: 'integer' })]);
    const value = await getConfigOrDefault(PROMOTER, 'storno_limit_hodin', 24, deps);
    expect(value).toBe(12);
  });
});

describe('setConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts and returns entry', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([row({ raw_value: '24', value_type: 'integer' })]);
    const entry = await setConfig(
      PROMOTER,
      { key: 'storno_limit_hodin', value: 24, valueType: 'integer' },
      'user-1',
      deps,
    );
    expect(entry.rawValue).toBe('24');
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT');
  });

  it('rejects wrong type (string for integer)', async () => {
    const { deps } = makeDeps();
    await expect(
      setConfig(
        PROMOTER,
        { key: 'k', value: 'oops', valueType: 'integer' },
        'u',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TYPE' });
  });

  it('rejects validation min', async () => {
    const { deps } = makeDeps();
    await expect(
      setConfig(
        PROMOTER,
        {
          key: 'k',
          value: 1,
          valueType: 'integer',
          validation: { min: 10 },
        },
        'u',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects regex mismatch', async () => {
    const { deps } = makeDeps();
    await expect(
      setConfig(
        PROMOTER,
        {
          key: 'k',
          value: 'abc',
          valueType: 'string',
          validation: { regex: '^\\d+$' },
        },
        'u',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('deleteConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 404 when nothing deleted (cross-tenant)', async () => {
    const { deps, query } = makeDeps();
    query.mockResolvedValueOnce([]);
    await expect(
      deleteConfig('other-promoter', 'presun_limit_hodin', deps),
    ).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAiClient,
  calculateCost,
  cacheKey,
  resolveModel,
  parseJsonSafe,
} from './client.js';
import type { AiCacheAdapter, AiProviderConfig } from './types.js';

// ---------------------------------------------------------------------------
// calculateCost
// ---------------------------------------------------------------------------

describe('calculateCost', () => {
  it('calculates Sonnet costs correctly', () => {
    // 1000 input tokens, 500 output tokens
    // Sonnet: $3/MTok input, $15/MTok output
    const cost = calculateCost('claude-sonnet-4-6', 1000, 500);
    expect(cost).toBeCloseTo(0.003 + 0.0075, 6); // 0.0105
  });

  it('calculates Haiku costs correctly', () => {
    const cost = calculateCost('claude-haiku-4-5-20251001', 10_000, 5_000);
    expect(cost).toBeCloseTo(0.01 + 0.025, 6); // 0.035
  });

  it('calculates Opus costs correctly', () => {
    const cost = calculateCost('claude-opus-4-6', 1000, 500);
    expect(cost).toBeCloseTo(0.015 + 0.0375, 6); // 0.0525
  });

  it('resolves aliases before calculation', () => {
    const costAlias = calculateCost('sonnet', 1000, 500);
    const costFull = calculateCost('claude-sonnet-4-6', 1000, 500);
    expect(costAlias).toBe(costFull);
  });

  it('falls back to Sonnet pricing for unknown models', () => {
    const costUnknown = calculateCost('unknown-model', 1000, 500);
    const costSonnet = calculateCost('claude-sonnet-4-6', 1000, 500);
    expect(costUnknown).toBe(costSonnet);
  });

  it('returns 0 for zero tokens', () => {
    expect(calculateCost('claude-sonnet-4-6', 0, 0)).toBe(0);
  });

  it('handles large token counts', () => {
    // 1M input + 1M output on Sonnet: $3 + $15 = $18
    const cost = calculateCost('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(18.0, 4);
  });
});

// ---------------------------------------------------------------------------
// cacheKey
// ---------------------------------------------------------------------------

describe('cacheKey', () => {
  it('produces ai:{feature}:{hash} format', () => {
    const key = cacheKey('generate_email', 'system prompt', 'user message');
    expect(key).toMatch(/^ai:generate_email:[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const a = cacheKey('f', 'system', 'user');
    const b = cacheKey('f', 'system', 'user');
    expect(a).toBe(b);
  });

  it('differs for different inputs', () => {
    const a = cacheKey('f', 'system-a', 'user');
    const b = cacheKey('f', 'system-b', 'user');
    expect(a).not.toBe(b);
  });

  it('differs for different features', () => {
    const a = cacheKey('feature-a', 'system', 'user');
    const b = cacheKey('feature-b', 'system', 'user');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

describe('resolveModel', () => {
  it('resolves sonnet alias', () => {
    expect(resolveModel('sonnet')).toBe('claude-sonnet-4-6');
  });

  it('resolves haiku alias', () => {
    expect(resolveModel('haiku')).toBe('claude-haiku-4-5-20251001');
  });

  it('resolves opus alias', () => {
    expect(resolveModel('opus')).toBe('claude-opus-4-6');
  });

  it('passes through full model ID unchanged', () => {
    expect(resolveModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('passes through unknown ID unchanged', () => {
    expect(resolveModel('gpt-4')).toBe('gpt-4');
  });
});

// ---------------------------------------------------------------------------
// parseJsonSafe
// ---------------------------------------------------------------------------

describe('parseJsonSafe', () => {
  it('parses plain JSON', () => {
    expect(parseJsonSafe('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('strips markdown json fences', () => {
    expect(parseJsonSafe('```json\n{"key":"value"}\n```')).toEqual({ key: 'value' });
  });

  it('strips plain markdown fences', () => {
    expect(parseJsonSafe('```\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonSafe('not json')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createAiClient — callClaude
// ---------------------------------------------------------------------------

describe('createAiClient', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    }
  });

  function mockFetchSuccess(text = 'Hello', inputTokens = 100, outputTokens = 50) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'msg_001',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text }],
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }),
    }) as unknown as typeof fetch;
  }

  it('calls Claude API and returns result', async () => {
    mockFetchSuccess('Test response', 200, 100);
    const { callClaude } = createAiClient();

    const result = await callClaude({
      model: 'sonnet',
      system: 'You are helpful.',
      user: 'Say hello',
    });

    expect(result.text).toBe('Test response');
    expect(result.cached).toBe(false);
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(100);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.rawResponse).toBeDefined();
  });

  it('sends correct headers and body', async () => {
    mockFetchSuccess();
    const { callClaude } = createAiClient({ apiKey: 'my-api-key' });

    await callClaude({ model: 'haiku', system: 'sys', user: 'usr', maxTokens: 512 });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.anthropic.com/v1/messages');

    const init = fetchCall[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('my-api-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.max_tokens).toBe(512);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'usr' }]);
  });

  it('returns cached result when available', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const mockCache: AiCacheAdapter = {
      get: vi.fn().mockResolvedValue('cached text'),
      setex: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(1),
      decr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
    };

    const { callClaude } = createAiClient({ cache: mockCache });

    const result = await callClaude({ model: 'sonnet', system: 'sys', user: 'usr' });

    expect(result.text).toBe('cached text');
    expect(result.cached).toBe(true);
    expect(result.inputTokens).toBe(0);
    expect(result.costUsd).toBe(0);
    // fetch should NOT have been called
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('skips cache when noCache is true', async () => {
    mockFetchSuccess('fresh');
    const mockCache: AiCacheAdapter = {
      get: vi.fn().mockResolvedValue('cached text'),
      setex: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(1),
      decr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
    };

    const { callClaude } = createAiClient({ cache: mockCache });

    const result = await callClaude({ model: 'sonnet', system: 'sys', user: 'usr', noCache: true });

    expect(result.text).toBe('fresh');
    expect(result.cached).toBe(false);
    expect(mockCache.get).not.toHaveBeenCalled();
  });

  it('stores result in cache after API call', async () => {
    mockFetchSuccess('new result');
    const mockCache: AiCacheAdapter = {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(1),
      decr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
    };

    const { callClaude } = createAiClient({ cache: mockCache, cacheTtlSec: 3600 });

    await callClaude({ model: 'sonnet', system: 'sys', user: 'usr' });

    expect(mockCache.setex).toHaveBeenCalledWith(
      expect.stringMatching(/^ai:other:/),
      3600,
      'new result',
    );
  });

  it('calls usage tracker on API response', async () => {
    mockFetchSuccess('hello', 150, 75);
    const tracker = vi.fn();

    const { callClaude } = createAiClient({ usageTracker: tracker });

    await callClaude({
      model: 'sonnet',
      system: 'sys',
      user: 'usr',
      feature: 'generate_email',
      tenantId: 'org-1',
    });

    // fire-and-forget, but tracker should be called
    await vi.waitFor(() => expect(tracker).toHaveBeenCalled());

    expect(tracker).toHaveBeenCalledWith({
      tenantId: 'org-1',
      model: 'claude-sonnet-4-6',
      feature: 'generate_email',
      inputTokens: 150,
      outputTokens: 75,
      costUsd: expect.any(Number),
      cached: false,
    });
  });

  it('calls rate limiter before API call', async () => {
    mockFetchSuccess();
    const rateLimiter = vi.fn();

    const { callClaude } = createAiClient({ rateLimiter });

    await callClaude({
      model: 'sonnet',
      system: 'sys',
      user: 'usr',
      tenantId: 'org-1',
      feature: 'translate',
    });

    expect(rateLimiter).toHaveBeenCalledWith('org-1', 'translate');
  });

  it('throws when rate limiter rejects', async () => {
    const rateLimiter = vi.fn().mockRejectedValue(new Error('Rate limit exceeded'));

    const { callClaude } = createAiClient({ rateLimiter });

    await expect(
      callClaude({ model: 'sonnet', system: 'sys', user: 'usr', tenantId: 'org-1' }),
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('throws when no API key is available', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { callClaude } = createAiClient();

    await expect(
      callClaude({ model: 'sonnet', system: 'sys', user: 'usr' }),
    ).rejects.toThrow('ANTHROPIC_API_KEY');
  });

  it('throws on non-retryable API error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad request'),
    }) as unknown as typeof fetch;

    const { callClaude } = createAiClient();

    await expect(
      callClaude({ model: 'sonnet', system: 'sys', user: 'usr' }),
    ).rejects.toThrow('Claude API error 400');
  });

  it('passes extra params to API body', async () => {
    mockFetchSuccess();
    const { callClaude } = createAiClient();

    await callClaude({
      model: 'sonnet',
      system: 'sys',
      user: 'usr',
      extra: { temperature: 0.5 },
    });

    const body = JSON.parse(
      ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.temperature).toBe(0.5);
  });
});

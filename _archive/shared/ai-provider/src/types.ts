/**
 * Shared AI provider types — used across all projects.
 */

// ─── Model registry ──────────────────────────────────────────────────────────

/** Cost per million tokens in USD. */
export interface ModelCost {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Supported Claude model IDs with pricing. */
export const MODEL_COSTS: Record<string, ModelCost> = {
  'claude-sonnet-4-6': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-opus-4-6': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  // Aliases
  'claude-sonnet-4-20250514': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-haiku-4-5': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
};

/** Shorthand model aliases for convenience. */
export const MODEL_ALIASES = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

export type ModelAlias = keyof typeof MODEL_ALIASES;

// ─── Call options & results ──────────────────────────────────────────────────

export interface CallClaudeOptions {
  /** Model ID or alias ('sonnet', 'haiku', 'opus'). */
  model: string;
  /** System prompt. */
  system: string;
  /** User message. */
  user: string;
  /** Max output tokens. Default: 2048. */
  maxTokens?: number;
  /** Feature name for usage tracking and rate limiting. */
  feature?: string;
  /** Tenant/org ID for usage tracking and rate limiting. */
  tenantId?: string;
  /** Skip cache lookup (force fresh call). */
  noCache?: boolean;
  /** Additional API parameters (tools, tool_choice, etc.). */
  extra?: Record<string, unknown>;
}

export interface CallClaudeResult {
  /** Extracted text response. */
  text: string;
  /** Whether the response was served from cache. */
  cached: boolean;
  /** Input tokens consumed (0 if cached). */
  inputTokens: number;
  /** Output tokens consumed (0 if cached). */
  outputTokens: number;
  /** Estimated cost in USD (0 if cached). */
  costUsd: number;
  /** Raw API response (only when not cached). */
  rawResponse?: ClaudeApiResponse;
}

// ─── Claude API types (minimal, no SDK dependency) ───────────────────────────

export interface ClaudeApiResponse {
  id: string;
  type: string;
  role: string;
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

// ─── Adapter interfaces (project-specific implementations) ───────────────────

/**
 * Redis-like cache interface. Projects inject their own Redis client.
 * Only requires get/set/incr/decr/expire/del — compatible with ioredis.
 */
export interface AiCacheAdapter {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<unknown>;
  expire(key: string, ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Usage tracking callback. Projects implement their own DB persistence.
 * Called fire-and-forget after each API call.
 */
export interface AiUsageRecord {
  tenantId: string;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cached: boolean;
}

export type AiUsageTracker = (record: AiUsageRecord) => Promise<void> | void;

/**
 * Rate limit checker. Projects implement their own plan-based logic.
 * Should throw an error if the limit is exceeded.
 */
export type AiRateLimiter = (tenantId: string, feature: string) => Promise<void>;

// ─── Client configuration ────────────────────────────────────────────────────

export interface AiProviderConfig {
  /** Anthropic API key. If not provided, reads from ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Anthropic API base URL. Default: https://api.anthropic.com */
  apiBaseUrl?: string;
  /** API version header. Default: 2023-06-01 */
  apiVersion?: string;
  /** Default max tokens for responses. Default: 2048 */
  defaultMaxTokens?: number;
  /** Default cache TTL in seconds. Default: 86400 (24h) */
  cacheTtlSec?: number;
  /** Redis-like cache adapter. If not provided, caching is disabled. */
  cache?: AiCacheAdapter;
  /** Usage tracking callback. If not provided, tracking is disabled. */
  usageTracker?: AiUsageTracker;
  /** Rate limiter. If not provided, rate limiting is disabled. */
  rateLimiter?: AiRateLimiter;
  /** Max retries on transient errors (429, 500, 529). Default: 3 */
  maxRetries?: number;
}

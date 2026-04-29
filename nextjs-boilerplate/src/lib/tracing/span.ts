/**
 * Minimal in-process tracing — pro demo a developmentní introspection.
 *
 * Pro produkci přepojit na @opentelemetry/sdk-node + Jaeger/Honeycomb exporter.
 * Tady jen log + měření latence + parent-child span hierarchie přes
 * AsyncLocalStorage (request-scoped context).
 *
 * Use:
 *   import { traceSpan } from '@/lib/tracing/span';
 *   const result = await traceSpan('checkout.resolvePrice', async (span) => {
 *     span.setAttr('eventId', eventId);
 *     return resolveCurrentPrice(...);
 *   });
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';

interface SpanData {
  name: string;
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  startMs: number;
  endMs?: number;
  attributes: Record<string, string | number | boolean>;
  status: 'ok' | 'error';
  errorMessage?: string;
}

const als = new AsyncLocalStorage<SpanData>();

export interface SpanHandle {
  setAttr: (key: string, value: string | number | boolean) => void;
  spanId: string;
  traceId: string;
}

function genId(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

const TRACE_ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.TRACE_LOG === '1';

export async function traceSpan<T>(
  name: string,
  fn: (span: SpanHandle) => Promise<T> | T,
): Promise<T> {
  if (!TRACE_ENABLED) {
    return fn({
      setAttr: () => {},
      spanId: '',
      traceId: '',
    });
  }
  const parent = als.getStore();
  const span: SpanData = {
    name,
    spanId: genId(8),
    parentSpanId: parent?.spanId ?? null,
    traceId: parent?.traceId ?? genId(16),
    startMs: Date.now(),
    attributes: {},
    status: 'ok',
  };

  const handle: SpanHandle = {
    spanId: span.spanId,
    traceId: span.traceId,
    setAttr: (k, v) => {
      span.attributes[k] = v;
    },
  };

  return als.run(span, async () => {
    try {
      const result = await fn(handle);
      span.endMs = Date.now();
      logSpan(span);
      return result;
    } catch (err) {
      span.endMs = Date.now();
      span.status = 'error';
      span.errorMessage = err instanceof Error ? err.message : String(err);
      logSpan(span);
      throw err;
    }
  });
}

/** Vrátí current span (pokud existuje request kontext). */
export function currentSpan(): { spanId: string; traceId: string } | null {
  const s = als.getStore();
  if (!s) return null;
  return { spanId: s.spanId, traceId: s.traceId };
}

function logSpan(span: SpanData) {
  const duration = (span.endMs ?? span.startMs) - span.startMs;
  const status = span.status === 'error' ? '✗' : '✓';
  const parent = span.parentSpanId ? ` parent=${span.parentSpanId}` : '';
  const attrs = Object.entries(span.attributes)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  // eslint-disable-next-line no-console
  console.log(
    `[trace] ${status} ${span.name} ${duration}ms trace=${span.traceId} span=${span.spanId}${parent} ${attrs}${span.errorMessage ? ' err=' + span.errorMessage : ''}`,
  );
}

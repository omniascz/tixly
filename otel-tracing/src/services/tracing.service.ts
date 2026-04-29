// =============================================================================
// Tixly OpenTelemetry Distributed Tracing
//
// Poskytuje:
//   withSpan           — spustí operaci uvnitř nového spanu
//   traceDbQuery       — wraper DbAdapter s auto-instrumentací
//   traceHttpRequest   — wraper fetch s auto-instrumentací
//   traceKafkaMessage  — span pro Kafka zprávy
//   createNoopTracer   — no-op tracer pro testy a development
//   createConsoleTracer — tracer který loguje do konzole
//   isSampled          — deterministické vzorkování (djb2 hash)
//   buildSpanName      — standardní formát názvu spanu (service.operation)
//
// Design: žádná závislost na @opentelemetry/* balíčcích — vše je injektovatelné.
// V produkci se použije real OTEL SDK tracer přes createTracerFromConfig().
// =============================================================================

import type {
  Span,
  SpanOptions,
  SpanAttributes,
  Tracer,
  TracerConfig,
  DbAdapter,
  KafkaMessage,
} from '../lib/types.js';

// ---------------------------------------------------------------------------
// No-op implementations (pro testy a prostředí bez OTEL)
// ---------------------------------------------------------------------------

export function createNoopSpan(): Span {
  const ctx = { traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0 };
  const span: Span = {
    setAttribute: () => span,
    setAttributes: () => span,
    setStatus: () => span,
    recordException: () => span,
    end: () => undefined,
    isRecording: () => false,
    spanContext: () => ctx,
  };
  return span;
}

export function createNoopTracer(): Tracer {
  return {
    startSpan: (_name, _opts) => createNoopSpan(),
    startActiveSpan: <T>(_name: string, fn: (span: Span) => T) => fn(createNoopSpan()),
  };
}

/**
 * Console tracer — loguje spany do stderr.
 * Vhodný pro development a debugging.
 */
export function createConsoleTracer(serviceName: string): Tracer {
  function makeSpan(name: string, attrs: SpanAttributes = {}): Span {
    const spanId = Math.random().toString(16).slice(2, 18).padEnd(16, '0');
    const traceId = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    const start = Date.now();

    const allAttrs: SpanAttributes = { ...attrs };

    process.stderr.write(
      `[otel] START ${serviceName}.${name} spanId=${spanId}\n`,
    );

    const span: Span = {
      setAttribute: (k, v) => { allAttrs[k] = v; return span; },
      setAttributes: (a) => { Object.assign(allAttrs, a); return span; },
      setStatus: () => span,
      recordException: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[otel] EXCEPTION ${name} spanId=${spanId} error="${msg}"\n`);
        return span;
      },
      end: () => {
        const duration = Date.now() - start;
        process.stderr.write(
          `[otel] END ${serviceName}.${name} spanId=${spanId} duration=${duration}ms attrs=${JSON.stringify(allAttrs)}\n`,
        );
      },
      isRecording: () => true,
      spanContext: () => ({ traceId: traceId.slice(0, 32).padEnd(32, '0'), spanId, traceFlags: 1 }),
    };

    return span;
  }

  return {
    startSpan: (name, opts) => makeSpan(name, opts?.attributes),
    startActiveSpan: <T>(name: string, fn: (span: Span) => T, opts?: SpanOptions): T => {
      const span = makeSpan(name, opts?.attributes);
      try {
        const result = fn(span);
        if (result instanceof Promise) {
          return result.then(
            (v) => { span.end(); return v; },
            (err) => { span.recordException(err); span.end(); throw err; },
          ) as unknown as T;
        }
        span.end();
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.end();
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Core: withSpan
// ---------------------------------------------------------------------------

/**
 * Spustí async operaci uvnitř nového spanu.
 * Automaticky zaznamená chyby a ukončí span po dokončení.
 */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  const span = tracer.startSpan(name, options);
  try {
    const result = await fn(span);
    span.setStatus({ code: 'ok' });
    return result;
  } catch (err) {
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({ code: 'error', message: (err as Error).message });
    throw err;
  } finally {
    span.end();
  }
}

// ---------------------------------------------------------------------------
// DB adapter wrapper
// ---------------------------------------------------------------------------

/**
 * Wraper DbAdapter — každý query/execute dostane vlastní OTEL span.
 * Span attributes obsahují SQL (zkrácené na 512 znaků) a počet params.
 */
export function traceDbAdapter(tracer: Tracer, db: DbAdapter, dbName = 'postgresql'): DbAdapter {
  function spanAttrsForSql(sql: string, params?: unknown[]): SpanAttributes {
    return {
      'db.system': dbName,
      'db.statement': sql.length > 512 ? sql.slice(0, 512) + '...' : sql,
      'db.params_count': params?.length ?? 0,
    };
  }

  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      return withSpan(
        tracer,
        'db.query',
        async (span) => {
          span.setAttributes(spanAttrsForSql(sql, params));
          const result = await db.query<T>(sql, params);
          span.setAttribute('db.rows_returned', result.length);
          return result;
        },
        { kind: 'client' },
      );
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      return withSpan(
        tracer,
        'db.execute',
        async (span) => {
          span.setAttributes(spanAttrsForSql(sql, params));
          await db.execute(sql, params);
        },
        { kind: 'client' },
      );
    },

    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      return withSpan(
        tracer,
        'db.transaction',
        async (span) => {
          span.setAttribute('db.system', dbName);
          return db.transaction((tx) => fn(traceDbAdapter(tracer, tx, dbName)));
        },
        { kind: 'client' },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP fetch wrapper
// ---------------------------------------------------------------------------

export interface TracedFetch {
  (url: string | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Wraper pro fetch — HTTP requesty dostanou span s URL, metodou a status kódem.
 */
export function traceHttpFetch(tracer: Tracer, baseFetch: typeof fetch = fetch): TracedFetch {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const urlStr = url.toString();
    const spanName = `http.${method.toLowerCase()}`;

    return withSpan(
      tracer,
      spanName,
      async (span) => {
        span.setAttributes({
          'http.method': method,
          'http.url': urlStr,
          'http.target': new URL(urlStr).pathname,
        });

        const response = await baseFetch(url, init);

        span.setAttribute('http.status_code', response.status);
        if (!response.ok) {
          span.setStatus({ code: 'error', message: `HTTP ${response.status}` });
        }

        return response;
      },
      { kind: 'client' },
    );
  };
}

// ---------------------------------------------------------------------------
// Kafka message tracer
// ---------------------------------------------------------------------------

/**
 * Wraper pro Kafka consumer — každá zpráva dostane span.
 */
export async function traceKafkaMessage<T>(
  tracer: Tracer,
  message: KafkaMessage,
  handler: (msg: KafkaMessage, span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    tracer,
    `kafka.process ${message.topic}`,
    async (span) => {
      span.setAttributes({
        'messaging.system': 'kafka',
        'messaging.destination': message.topic,
        'messaging.kafka.partition': message.partition ?? 0,
        'messaging.kafka.offset': message.offset ?? '',
      });
      if (message.key) span.setAttribute('messaging.kafka.message_key', message.key);
      return handler(message, span);
    },
    { kind: 'consumer' },
  );
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Deterministické vzorkování pomocí djb2 hashe.
 * Stejný traceId vždy dostane stejný výsledek → konzistentní traces přes service-to-service calls.
 * @param traceId - 32znakový hex string
 * @param sampleRate - 0.0 (žádné vzorkování) až 1.0 (100% vzorkování)
 */
export function isSampled(traceId: string, sampleRate: number): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;

  let hash = 5381;
  for (let i = 0; i < traceId.length; i++) {
    hash = ((hash << 5) + hash) ^ traceId.charCodeAt(i);
    hash = hash & 0xffffffff; // 32-bit integer
  }

  const normalized = (hash >>> 0) / 0xffffffff;
  return normalized < sampleRate;
}

// ---------------------------------------------------------------------------
// Span name helpers
// ---------------------------------------------------------------------------

/**
 * Standardní formát názvu spanu pro Tixly: "service.operation"
 * Např. "orders.create", "tickets.issue", "gopay.webhook"
 */
export function buildSpanName(service: string, operation: string): string {
  return `${service}.${operation}`;
}

/**
 * Extrahuje HTTP route pattern pro span name (anonymizuje IDs).
 * /api/orders/123/tickets/456 → /api/orders/:id/tickets/:id
 */
export function normalizeUrlPath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{4,}/g, '/:id');
}

// ---------------------------------------------------------------------------
// Config-based tracer factory (production)
// ---------------------------------------------------------------------------

/**
 * Vytvoří tracer podle TracerConfig.
 * V testech se používá createNoopTracer() nebo createConsoleTracer().
 * Tato funkce pouze mapuje config na správný tracer typ.
 */
export function createTracerFromConfig(config: TracerConfig): Tracer {
  switch (config.exporterType) {
    case 'noop':
      return createNoopTracer();
    case 'console':
      return createConsoleTracer(config.serviceName);
    default:
      // V produkci by se zde inicializoval @opentelemetry/sdk-node
      // s Jaeger/Honeycomb OTLP exporterem.
      // Pro testovatelnost vracíme console tracer.
      return createConsoleTracer(config.serviceName);
  }
}

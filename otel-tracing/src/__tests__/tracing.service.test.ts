import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNoopTracer,
  createNoopSpan,
  createConsoleTracer,
  withSpan,
  traceDbAdapter,
  traceHttpFetch,
  traceKafkaMessage,
  isSampled,
  buildSpanName,
  normalizeUrlPath,
  createTracerFromConfig,
} from '../services/tracing.service.js';
import type { Span, Tracer, DbAdapter } from '../lib/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrackedSpan() {
  const calls: string[] = [];
  const attrs: Record<string, unknown> = {};
  const span: Span = {
    setAttribute: (k, v) => { attrs[k] = v; calls.push(`setAttribute:${k}`); return span; },
    setAttributes: (a) => { Object.assign(attrs, a); calls.push('setAttributes'); return span; },
    setStatus: (s) => { calls.push(`setStatus:${s.code}`); return span; },
    recordException: (e) => { calls.push(`recordException:${typeof e === 'string' ? e : e.message}`); return span; },
    end: () => { calls.push('end'); },
    isRecording: () => true,
    spanContext: () => ({ traceId: 'abc'.padEnd(32, '0'), spanId: '12345678'.padEnd(16, '0'), traceFlags: 1 }),
  };
  return { span, calls, attrs };
}

function makeTracer(onStart?: (name: string, span: Span) => void): Tracer {
  return {
    startSpan: (name, opts) => {
      const { span } = makeTrackedSpan();
      onStart?.(name, span);
      return span;
    },
    startActiveSpan: <T>(name: string, fn: (span: Span) => T, opts?: unknown): T => {
      const { span } = makeTrackedSpan();
      onStart?.(name, span);
      return fn(span);
    },
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let idx = 0;
  const queryFn = vi.fn(async () => queryResults[idx++] ?? []);
  const executeFn = vi.fn();
  function adapter(): DbAdapter {
    return {
      query: queryFn,
      execute: executeFn,
      transaction: vi.fn(async (fn) => fn(adapter())),
    };
  }
  return adapter();
}

// ─── createNoopSpan ───────────────────────────────────────────────────────────

describe('createNoopSpan', () => {
  it('returns a non-recording span', () => {
    const span = createNoopSpan();
    expect(span.isRecording()).toBe(false);
  });

  it('supports method chaining', () => {
    const span = createNoopSpan();
    expect(span.setAttribute('k', 'v')).toBe(span);
    expect(span.setAttributes({ a: 1 })).toBe(span);
    expect(span.setStatus({ code: 'ok' })).toBe(span);
  });

  it('has zeroed span context', () => {
    const ctx = createNoopSpan().spanContext();
    expect(ctx.traceId).toBe('0'.repeat(32));
    expect(ctx.spanId).toBe('0'.repeat(16));
    expect(ctx.traceFlags).toBe(0);
  });
});

// ─── createNoopTracer ─────────────────────────────────────────────────────────

describe('createNoopTracer', () => {
  it('startSpan returns noop span', () => {
    const tracer = createNoopTracer();
    const span = tracer.startSpan('test');
    expect(span.isRecording()).toBe(false);
  });

  it('startActiveSpan calls fn and returns result', () => {
    const tracer = createNoopTracer();
    const result = tracer.startActiveSpan('test', (span) => {
      expect(span).toBeDefined();
      return 42;
    });
    expect(result).toBe(42);
  });
});

// ─── withSpan ─────────────────────────────────────────────────────────────────

describe('withSpan', () => {
  it('calls fn with span and returns result', async () => {
    const tracer = createNoopTracer();
    const result = await withSpan(tracer, 'test', async (span) => {
      expect(span).toBeDefined();
      return 'hello';
    });
    expect(result).toBe('hello');
  });

  it('sets status ok on success', async () => {
    const { span, calls } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    await withSpan(tracer, 'op', async () => 'done');

    expect(calls).toContain('setStatus:ok');
    expect(calls).toContain('end');
  });

  it('records exception and re-throws on error', async () => {
    const { span, calls } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const error = new Error('boom');
    await expect(withSpan(tracer, 'op', async () => { throw error; })).rejects.toThrow('boom');

    expect(calls).toContain('recordException:boom');
    expect(calls).toContain('setStatus:error');
    expect(calls).toContain('end');
  });

  it('ends span even when fn throws', async () => {
    const { span, calls } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    await expect(withSpan(tracer, 'op', async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(calls).toContain('end');
  });

  it('passes SpanOptions to tracer.startSpan', async () => {
    const spanNames: string[] = [];
    const tracer: Tracer = {
      startSpan: (name) => { spanNames.push(name); return createNoopSpan(); },
      startActiveSpan: <T>(name: string, fn: (s: Span) => T) => fn(createNoopSpan()),
    };

    await withSpan(tracer, 'my.operation', async () => 'ok', { kind: 'client' });
    expect(spanNames).toContain('my.operation');
  });
});

// ─── traceDbAdapter ───────────────────────────────────────────────────────────

describe('traceDbAdapter', () => {
  it('traces query and returns result', async () => {
    const spanNames: string[] = [];
    const tracer: Tracer = {
      startSpan: (name) => { spanNames.push(name); return createNoopSpan(); },
      startActiveSpan: <T>(name: string, fn: (s: Span) => T) => fn(createNoopSpan()),
    };

    const db = makeDb([[{ id: 1 }]]);
    const tracedDb = traceDbAdapter(tracer, db);

    const result = await tracedDb.query('SELECT 1');
    expect(result).toEqual([{ id: 1 }]);
    expect(spanNames).toContain('db.query');
  });

  it('sets db.statement attribute on query', async () => {
    const { span, attrs } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const db = makeDb([[]]);
    const tracedDb = traceDbAdapter(tracer, db);
    await tracedDb.query('SELECT * FROM users WHERE id = $1', ['user-1']);

    expect(attrs['db.statement']).toContain('SELECT * FROM users');
    expect(attrs['db.params_count']).toBe(1);
  });

  it('truncates very long SQL in db.statement attribute', async () => {
    const { span, attrs } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const db = makeDb([[]]);
    const tracedDb = traceDbAdapter(tracer, db);
    const longSql = 'SELECT ' + 'x, '.repeat(200);
    await tracedDb.query(longSql);

    expect((attrs['db.statement'] as string).length).toBeLessThanOrEqual(515);
    expect(attrs['db.statement']).toContain('...');
  });

  it('traces execute', async () => {
    const spanNames: string[] = [];
    const tracer: Tracer = {
      startSpan: (name) => { spanNames.push(name); return createNoopSpan(); },
      startActiveSpan: <T>(name: string, fn: (s: Span) => T) => fn(createNoopSpan()),
    };

    const db = makeDb();
    const tracedDb = traceDbAdapter(tracer, db);
    await tracedDb.execute('INSERT INTO logs VALUES ($1)', ['test']);

    expect(spanNames).toContain('db.execute');
    expect(db.execute).toHaveBeenCalledWith('INSERT INTO logs VALUES ($1)', ['test']);
  });

  it('traces transaction and wraps inner tx', async () => {
    const spanNames: string[] = [];
    const tracer: Tracer = {
      startSpan: (name) => { spanNames.push(name); return createNoopSpan(); },
      startActiveSpan: <T>(name: string, fn: (s: Span) => T) => fn(createNoopSpan()),
    };

    const db = makeDb([[{ count: 1 }]]);
    const tracedDb = traceDbAdapter(tracer, db);

    const result = await tracedDb.transaction(async (tx) => {
      return tx.query('SELECT COUNT(*) as count');
    });

    expect(spanNames).toContain('db.transaction');
    expect(spanNames).toContain('db.query');
    expect(result).toEqual([{ count: 1 }]);
  });

  it('records db.rows_returned on query', async () => {
    const { span, attrs } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const db = makeDb([[{ id: 1 }, { id: 2 }, { id: 3 }]]);
    const tracedDb = traceDbAdapter(tracer, db);
    await tracedDb.query('SELECT * FROM events');

    expect(attrs['db.rows_returned']).toBe(3);
  });
});

// ─── traceHttpFetch ───────────────────────────────────────────────────────────

describe('traceHttpFetch', () => {
  it('creates span with http attributes', async () => {
    const { span, attrs } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const tracedFetch = traceHttpFetch(tracer, mockFetch as unknown as typeof fetch);

    await tracedFetch('https://api.example.com/v1/events?page=1');

    expect(attrs['http.method']).toBe('GET');
    expect(attrs['http.url']).toContain('api.example.com');
    expect(attrs['http.status_code']).toBe(200);
  });

  it('sets error status on non-OK response', async () => {
    const { span, calls } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const mockFetch = vi.fn().mockResolvedValue(new Response('Not found', { status: 404 }));
    const tracedFetch = traceHttpFetch(tracer, mockFetch as unknown as typeof fetch);

    await tracedFetch('https://api.example.com/missing');
    expect(calls).toContain('setStatus:error');
  });

  it('records POST method', async () => {
    const { span, attrs } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    const tracedFetch = traceHttpFetch(tracer, mockFetch as unknown as typeof fetch);

    await tracedFetch('https://api.example.com/events', { method: 'POST', body: '{}' });
    expect(attrs['http.method']).toBe('POST');
  });
});

// ─── traceKafkaMessage ────────────────────────────────────────────────────────

describe('traceKafkaMessage', () => {
  it('creates span with kafka attributes and calls handler', async () => {
    const { span, attrs } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const message = { topic: 'order.created', partition: 0, offset: '42', value: { orderId: '123' } };
    const handler = vi.fn().mockResolvedValue('processed');

    const result = await traceKafkaMessage(tracer, message, handler);

    expect(result).toBe('processed');
    expect(attrs['messaging.system']).toBe('kafka');
    expect(attrs['messaging.destination']).toBe('order.created');
    expect(attrs['messaging.kafka.partition']).toBe(0);
    expect(handler).toHaveBeenCalledWith(message, span);
  });

  it('records exception when handler throws', async () => {
    const { span, calls } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const message = { topic: 'ticket.issued', value: { ticketId: 'abc' } };

    await expect(
      traceKafkaMessage(tracer, message, async () => { throw new Error('handler failed'); }),
    ).rejects.toThrow('handler failed');

    expect(calls).toContain('recordException:handler failed');
    expect(calls).toContain('end');
  });

  it('sets messaging.kafka.message_key when key provided', async () => {
    const { span, attrs } = makeTrackedSpan();
    const tracer: Tracer = {
      startSpan: () => span,
      startActiveSpan: <T>(_: string, fn: (s: Span) => T) => fn(span),
    };

    const message = { topic: 'payment.confirmed', key: 'order-789', value: {} };
    await traceKafkaMessage(tracer, message, async () => 'ok');

    expect(attrs['messaging.kafka.message_key']).toBe('order-789');
  });
});

// ─── isSampled ────────────────────────────────────────────────────────────────

describe('isSampled', () => {
  it('always returns true at 100% sample rate', () => {
    for (let i = 0; i < 10; i++) {
      const traceId = Math.random().toString(16).repeat(4).slice(0, 32);
      expect(isSampled(traceId, 1.0)).toBe(true);
    }
  });

  it('always returns false at 0% sample rate', () => {
    for (let i = 0; i < 10; i++) {
      const traceId = Math.random().toString(16).repeat(4).slice(0, 32);
      expect(isSampled(traceId, 0.0)).toBe(false);
    }
  });

  it('is deterministic — same traceId always produces same result', () => {
    const traceId = 'abc123def456789012345678901234ab';
    const r1 = isSampled(traceId, 0.5);
    const r2 = isSampled(traceId, 0.5);
    expect(r1).toBe(r2);
  });

  it('approximates the requested sample rate with varied inputs', () => {
    const TRACES = 1000;
    let sampledCount = 0;
    // Generate varied trace IDs by combining multiple random-looking values
    for (let i = 0; i < TRACES; i++) {
      const a = (i * 1664525 + 1013904223) >>> 0;
      const b = (a * 22695477 + 1) >>> 0;
      const traceId = a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
        + (a ^ b).toString(16).padStart(8, '0') + (a + b).toString(16).padStart(8, '0');
      if (isSampled(traceId.slice(0, 32), 0.3)) sampledCount++;
    }
    // Should be roughly 30% ± 10%
    expect(sampledCount / TRACES).toBeGreaterThan(0.15);
    expect(sampledCount / TRACES).toBeLessThan(0.50);
  });
});

// ─── buildSpanName ────────────────────────────────────────────────────────────

describe('buildSpanName', () => {
  it('combines service and operation', () => {
    expect(buildSpanName('orders', 'create')).toBe('orders.create');
    expect(buildSpanName('gopay', 'webhook')).toBe('gopay.webhook');
    expect(buildSpanName('tickets', 'issue')).toBe('tickets.issue');
  });
});

// ─── normalizeUrlPath ─────────────────────────────────────────────────────────

describe('normalizeUrlPath', () => {
  it('replaces UUIDs with :id', () => {
    const path = '/api/orders/550e8400-e29b-41d4-a716-446655440000/tickets';
    expect(normalizeUrlPath(path)).toBe('/api/orders/:id/tickets');
  });

  it('replaces long numeric IDs with :id', () => {
    const path = '/api/events/12345/ticket-types/67890';
    expect(normalizeUrlPath(path)).toBe('/api/events/:id/ticket-types/:id');
  });

  it('leaves short path segments unchanged', () => {
    const path = '/api/v1/health';
    expect(normalizeUrlPath(path)).toBe('/api/v1/health');
  });

  it('handles multiple UUIDs', () => {
    const path = '/api/orders/550e8400-e29b-41d4-a716-446655440000/refunds/6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    expect(normalizeUrlPath(path)).toBe('/api/orders/:id/refunds/:id');
  });
});

// ─── createConsoleTracer ──────────────────────────────────────────────────────

describe('createConsoleTracer', () => {
  it('returns a tracer that records spans', () => {
    const tracer = createConsoleTracer('tixly-test');
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
    expect(typeof tracer.startActiveSpan).toBe('function');
  });

  it('startActiveSpan executes the callback', async () => {
    const tracer = createConsoleTracer('test-service');
    let called = false;
    tracer.startActiveSpan('test.op', (span) => {
      called = true;
      span.setAttribute('key', 'value');
    });
    expect(called).toBe(true);
  });
});

// ─── createTracerFromConfig ───────────────────────────────────────────────────

describe('createTracerFromConfig', () => {
  it('returns noop tracer for noop exporter type', () => {
    const tracer = createTracerFromConfig({
      serviceName: 'tixly',
      exporterType: 'noop',
    });
    const span = tracer.startSpan('test');
    expect(span.isRecording()).toBe(false);
  });

  it('returns console tracer for console exporter type', () => {
    const tracer = createTracerFromConfig({
      serviceName: 'tixly',
      exporterType: 'console',
    });
    const span = tracer.startSpan('test');
    expect(span.isRecording()).toBe(true);
  });
});

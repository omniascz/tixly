import { describe, it, expect, vi, afterEach } from 'vitest';
import { traceSpan, currentSpan } from './span';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('traceSpan', () => {
  it('returns function result', async () => {
    const r = await traceSpan('test.foo', () => 42);
    expect(r).toBe(42);
  });

  it('propagates async result', async () => {
    const r = await traceSpan('test.async', async () => {
      await new Promise((res) => setTimeout(res, 5));
      return 'ok';
    });
    expect(r).toBe('ok');
  });

  it('propagates errors', async () => {
    await expect(
      traceSpan('test.err', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('nested spans share traceId, child has different spanId', async () => {
    let parentTrace = '';
    let childTrace = '';
    let parentSpan = '';
    let childSpan = '';

    await traceSpan('parent', async (p) => {
      parentTrace = p.traceId;
      parentSpan = p.spanId;
      await traceSpan('child', (c) => {
        childTrace = c.traceId;
        childSpan = c.spanId;
      });
    });

    expect(parentTrace).toBe(childTrace);
    expect(parentSpan).not.toBe(childSpan);
    expect(parentTrace.length).toBe(32); // 16 bytes hex
    expect(parentSpan.length).toBe(16); // 8 bytes hex
  });

  it('currentSpan returns null outside trace', () => {
    expect(currentSpan()).toBe(null);
  });

  it('currentSpan returns span inside trace', async () => {
    let inside: { spanId: string; traceId: string } | null = null;
    await traceSpan('outer', async () => {
      inside = currentSpan();
    });
    expect(inside).not.toBeNull();
    expect(typeof (inside as unknown as { spanId: string }).spanId).toBe('string');
  });

  it('setAttr accumulates attributes (logged on completion)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await traceSpan('test.attr', (span) => {
      span.setAttr('userId', 'u-1');
      span.setAttr('count', 42);
      span.setAttr('flag', true);
    });
    const output = log.mock.calls.flat().join(' ');
    expect(output).toContain('userId=u-1');
    expect(output).toContain('count=42');
    expect(output).toContain('flag=true');
  });
});

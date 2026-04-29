import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onWidgetMessage } from '../src/lib/postmessage';
import type { WidgetMessage } from '../src/types/widget.types';

describe('onWidgetMessage', () => {
  const TRUSTED_ORIGIN = 'https://tixly.cz';

  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('zaregistruje message listener', () => {
    const handler = vi.fn();
    onWidgetMessage(handler, TRUSTED_ORIGIN);
    expect(window.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('vrátí cleanup funkci která odregistruje listener', () => {
    const handler = vi.fn();
    const cleanup = onWidgetMessage(handler, TRUSTED_ORIGIN);
    cleanup();
    expect(window.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('zavolá handler pro správný origin a typ zprávy', () => {
    const handler = vi.fn();
    let capturedListener: ((event: MessageEvent) => void) | null = null;

    vi.stubGlobal('window', {
      addEventListener: vi.fn((_, listener) => { capturedListener = listener; }),
      removeEventListener: vi.fn(),
    });

    onWidgetMessage(handler, TRUSTED_ORIGIN);

    const msg: WidgetMessage = { type: 'TIXLY_RESIZE', height: 400 };
    capturedListener!({ origin: TRUSTED_ORIGIN, data: msg } as MessageEvent);

    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('ignoruje zprávy z jiného originu', () => {
    const handler = vi.fn();
    let capturedListener: ((event: MessageEvent) => void) | null = null;

    vi.stubGlobal('window', {
      addEventListener: vi.fn((_, listener) => { capturedListener = listener; }),
      removeEventListener: vi.fn(),
    });

    onWidgetMessage(handler, TRUSTED_ORIGIN);
    capturedListener!({ origin: 'https://evil.com', data: { type: 'TIXLY_RESIZE', height: 400 } } as MessageEvent);

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignoruje zprávy bez TIXLY_ prefixu', () => {
    const handler = vi.fn();
    let capturedListener: ((event: MessageEvent) => void) | null = null;

    vi.stubGlobal('window', {
      addEventListener: vi.fn((_, listener) => { capturedListener = listener; }),
      removeEventListener: vi.fn(),
    });

    onWidgetMessage(handler, TRUSTED_ORIGIN);
    capturedListener!({ origin: TRUSTED_ORIGIN, data: { type: 'SOME_OTHER_MESSAGE' } } as MessageEvent);

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignoruje non-object zprávy', () => {
    const handler = vi.fn();
    let capturedListener: ((event: MessageEvent) => void) | null = null;

    vi.stubGlobal('window', {
      addEventListener: vi.fn((_, listener) => { capturedListener = listener; }),
      removeEventListener: vi.fn(),
    });

    onWidgetMessage(handler, TRUSTED_ORIGIN);
    capturedListener!({ origin: TRUSTED_ORIGIN, data: 'hello' } as MessageEvent);

    expect(handler).not.toHaveBeenCalled();
  });
});

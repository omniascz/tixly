import { describe, it, expect } from 'vitest';
import {
  MockModerationProvider,
  runAiGate,
  type ModerationProvider,
} from './ai-gate';

describe('MockModerationProvider', () => {
  const p = new MockModerationProvider();

  it('rejects investment-scam wording', async () => {
    const r = await p.moderate({
      title: 'Investiční příležitost — 100% návratnost',
      ticketTypeNames: ['Std'],
    });
    expect(r.decision).toBe('reject');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('rejects crypto giveaway scam', async () => {
    const r = await p.moderate({
      title: 'Free crypto airdrop',
      ticketTypeNames: ['VIP'],
    });
    expect(r.decision).toBe('reject');
  });

  it('flags ALL CAPS spam', async () => {
    const r = await p.moderate({
      title: 'AMAZINGCONCERTOFTHEDECADENOWLIVEHEREEEEE',
      ticketTypeNames: ['Std'],
    });
    expect(r.decision).toBe('flag');
  });

  it('allows benign event', async () => {
    const r = await p.moderate({
      title: 'Klasický koncert v Rudolfinu',
      description: 'Mahler, Beethoven, Dvořák.',
      ticketTypeNames: ['Parket', 'Balkón'],
    });
    expect(r.decision).toBe('allow');
  });
});

describe('runAiGate', () => {
  function makeProvider(
    decision: 'allow' | 'flag' | 'reject',
    confidence: number,
  ): ModerationProvider {
    return {
      moderate: async () => ({
        decision,
        categories: [],
        confidence,
        reasoning: 'test',
      }),
    };
  }

  it('rejects high-confidence reject', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('reject', 0.9),
    );
    expect(r.action).toBe('reject');
    expect(r.status).toBe('rejected');
  });

  it('queues low-confidence reject (sends to human)', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('reject', 0.5),
    );
    expect(r.action).toBe('queue');
  });

  it('publishes high-confidence allow for trusted promoter', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('allow', 0.95),
    );
    expect(r.action).toBe('publish');
    expect(r.status).toBe('published');
  });

  it('queues high-confidence allow for untrusted promoter', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      false,
      makeProvider('allow', 0.95),
    );
    expect(r.action).toBe('queue');
    expect(r.status).toBe('pending_review');
  });

  it('queues flag regardless of trust', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('flag', 0.7),
    );
    expect(r.action).toBe('queue');
  });
});

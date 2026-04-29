/**
 * Integration testy pro AI gate — focus na boundary cases a interakci
 * mezi trust signal a AI rozhodnutím + env override.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MockModerationProvider,
  runAiGate,
  type ModerationProvider,
  type ModerationDecision,
} from './ai-gate';

const origEnv = process.env.MODERATION_AUTO_PUBLISH_DISABLED;

beforeEach(() => {
  delete process.env.MODERATION_AUTO_PUBLISH_DISABLED;
});

afterEach(() => {
  if (origEnv !== undefined) {
    process.env.MODERATION_AUTO_PUBLISH_DISABLED = origEnv;
  } else {
    delete process.env.MODERATION_AUTO_PUBLISH_DISABLED;
  }
});

function makeProvider(decision: ModerationDecision, confidence: number, categories: string[] = []): ModerationProvider {
  return {
    moderate: async () => ({
      decision,
      confidence,
      categories,
      reasoning: `mock ${decision} ${confidence}`,
    }),
  };
}

describe('runAiGate — boundary tests at confidence=0.8', () => {
  it('reject at exactly 0.8 confidence is rejected', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('reject', 0.8),
    );
    expect(r.action).toBe('reject');
  });

  it('reject at 0.79 falls through to queue', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('reject', 0.79),
    );
    expect(r.action).toBe('queue');
  });

  it('allow at exactly 0.8 + trusted publishes', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('allow', 0.8),
    );
    expect(r.action).toBe('publish');
  });

  it('allow at 0.79 + trusted goes to queue', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('allow', 0.79),
    );
    expect(r.action).toBe('queue');
  });
});

describe('runAiGate — env override', () => {
  it('MODERATION_AUTO_PUBLISH_DISABLED=1 forces queue even for trusted+allow', async () => {
    process.env.MODERATION_AUTO_PUBLISH_DISABLED = '1';
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('allow', 0.95),
    );
    expect(r.action).toBe('queue');
    expect(r.status).toBe('pending_review');
  });

  it('env override does NOT block reject path', async () => {
    process.env.MODERATION_AUTO_PUBLISH_DISABLED = '1';
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      true,
      makeProvider('reject', 0.95),
    );
    expect(r.action).toBe('reject');
  });
});

describe('MockModerationProvider — Czech-specific patterns', () => {
  const p = new MockModerationProvider();

  it('catches Czech "investiční příležitost"', async () => {
    const r = await p.moderate({
      title: 'Investiční příležitost — 100 % zaručený return',
      ticketTypeNames: [],
    });
    expect(r.decision).toBe('reject');
  });

  it('catches English "100% guarantee"', async () => {
    const r = await p.moderate({
      title: 'Special event — 100% return guarantee',
      ticketTypeNames: [],
    });
    expect(r.decision).toBe('reject');
  });

  it('flags "controversial" for review (English variant)', async () => {
    const r = await p.moderate({
      title: 'A controversial debate on economics',
      ticketTypeNames: [],
    });
    expect(r.decision).toBe('flag');
  });

  it('checks ticketTypeNames not just title', async () => {
    const r = await p.moderate({
      title: 'Standard event',
      description: 'Free crypto airdrop included',
      ticketTypeNames: ['VIP'],
    });
    expect(r.decision).toBe('reject');
  });

  it('benign event passes with high confidence', async () => {
    const r = await p.moderate({
      title: 'Vánoční koncert',
      description: 'Klasická hudba v kostele.',
      ticketTypeNames: ['Parket', 'Balkón'],
    });
    expect(r.decision).toBe('allow');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('runAiGate — categories propagation', () => {
  it('preserves categories from provider in result', async () => {
    const r = await runAiGate(
      { title: 'x', ticketTypeNames: [] },
      false,
      makeProvider('flag', 0.7, ['adult_content', 'controversial']),
    );
    expect(r.ai.categories).toEqual(['adult_content', 'controversial']);
  });
});

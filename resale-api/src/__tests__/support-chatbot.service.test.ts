import { describe, it, expect, vi } from 'vitest';
import {
  startChatSession,
  sendMessage,
  escalateSession,
  resolveSession,
  getChatHistory,
  recordFeedback,
} from '../services/support-chatbot.service.js';
import type { DbAdapter, CallAiFn, ChatContext } from '../services/support-chatbot.service.js';

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-001',
    user_id: 'user-001',
    session_token: 'tok_abc123',
    order_id: 'order-001',
    ticket_id: null,
    event_id: null,
    status: 'open',
    escalated_to: null,
    resolution_summary: null,
    created_at: '2026-04-14T10:00:00Z',
    last_message_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeMessageRow(role: string, content: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg-${Date.now()}`,
    session_id: 'session-001',
    role,
    content,
    tokens_used: null,
    latency_ms: null,
    created_at: '2026-04-14T10:01:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

function makeCallAi(response: string): CallAiFn {
  return vi.fn().mockResolvedValue({
    text: response,
    tokensUsed: 50,
    latencyMs: 200,
  });
}

const sampleContext: ChatContext = {
  orderStatus: 'PAID',
  orderTotal: 50000,
  eventName: 'Letní Slavnosti 2026',
  eventDate: '2026-07-15',
  venueName: 'O2 Arena',
  ticketStatus: 'active',
};

describe('startChatSession', () => {
  it('vytvoří novou chat session', async () => {
    const db = makeDb([[makeSessionRow()]]);

    const result = await startChatSession('user-001', { orderId: 'order-001' }, db);

    expect(result.userId).toBe('user-001');
    expect(result.orderId).toBe('order-001');
    expect(result.status).toBe('open');
  });

  it('vytvoří session pro anonymního uživatele', async () => {
    const db = makeDb([[makeSessionRow({ user_id: null })]]);

    const result = await startChatSession(null, {}, db);

    expect(result.userId).toBeNull();
  });
});

describe('sendMessage', () => {
  it('odešle zprávu a vrátí AI odpověď', async () => {
    const callAi = makeCallAi('Vaše vstupenka je aktivní a platná na Letní Slavnosti 2026.');

    const db = makeDb([
      [makeSessionRow()],                                                    // session check
      [],                                                                    // history (empty)
      [makeMessageRow('user', 'Kde je moje vstupenka?')],                  // user msg INSERT
      [makeMessageRow('assistant', 'Vaše vstupenka je aktivní...', {       // AI msg INSERT
        tokens_used: 50,
        latency_ms: 200,
      })],
    ], vi.fn());

    const result = await sendMessage('session-001', 'Kde je moje vstupenka?', sampleContext, callAi, db);

    expect(result.userMsg.role).toBe('user');
    expect(result.assistantMsg.role).toBe('assistant');
    expect(result.shouldEscalate).toBe(false);
    expect(callAi).toHaveBeenCalledOnce();
  });

  it('detekuje eskalaci v AI odpovědi', async () => {
    const callAi = makeCallAi('Potřebuji to předat kolegovi z podpory, protože jde o složitý případ.');

    const db = makeDb([
      [makeSessionRow()],
      [],
      [makeMessageRow('user', 'Problém s platbou')],
      [makeMessageRow('assistant', 'Potřebuji to předat kolegovi...')],
    ], vi.fn());

    const result = await sendMessage('session-001', 'Problém s platbou', sampleContext, callAi, db);

    expect(result.shouldEscalate).toBe(true);
  });

  it('vyhodí VALIDATION_ERROR pro prázdnou zprávu', async () => {
    const db = makeDb([]);
    const callAi = makeCallAi('');

    await expect(sendMessage('session-001', '   ', sampleContext, callAi, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí SESSION_NOT_FOUND pro uzavřenou session', async () => {
    const db = makeDb([[]]); // empty = session not open
    const callAi = makeCallAi('');

    await expect(sendMessage('session-001', 'Dotaz', sampleContext, callAi, db))
      .rejects.toThrow('SESSION_NOT_FOUND');
  });
});

describe('escalateSession', () => {
  it('eskaluje session na lidského agenta', async () => {
    const db = makeDb([[makeSessionRow({ status: 'escalated', escalated_to: 'support@tixly.cz' })]]);

    const result = await escalateSession('session-001', 'support@tixly.cz', db);

    expect(result.status).toBe('escalated');
    expect(result.escalatedTo).toBe('support@tixly.cz');
  });
});

describe('resolveSession', () => {
  it('uzavře session s resolution summary', async () => {
    const db = makeDb([[makeSessionRow({ status: 'resolved', resolution_summary: 'Vstupenka nalezena a potvrzena.' })]]);

    const result = await resolveSession('session-001', 'Vstupenka nalezena a potvrzena.', db);

    expect(result.status).toBe('resolved');
    expect(result.resolutionSummary).toBe('Vstupenka nalezena a potvrzena.');
  });
});

describe('getChatHistory', () => {
  it('vrátí historii zpráv v chronologickém pořadí', async () => {
    const db = makeDb([[
      makeMessageRow('user', 'Kde je moje vstupenka?'),
      makeMessageRow('assistant', 'Vaše vstupenka je platná.'),
    ]]);

    const result = await getChatHistory('session-001', db);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });
});

describe('recordFeedback', () => {
  it('zaznamená zpětnou vazbu pro session', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await recordFeedback('session-001', true, 5, 'Skvělá pomoc!', db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('session_feedback');
  });

  it('vyhodí VALIDATION_ERROR pro hodnocení mimo rozsah 1-5', async () => {
    const db = makeDb([], vi.fn());

    await expect(recordFeedback('session-001', true, 6, null, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  createQuestion,
  listQuestionsForEvent,
  saveResponse,
  getResponsesForQuestion,
  getResponsesForOrder,
} from '../services/custom-questions.service.js';
import type { DbAdapter } from '../services/custom-questions.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const QUESTION_ID = 'question-001';
const ORDER_ID = 'order-001';
const BUYER_ID = 'buyer-001';

function makeQuestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: QUESTION_ID,
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    label: 'Jakou barvu si přeješ trička?',
    type: 'choice',
    required: true,
    choices: ['S', 'M', 'L', 'XL'],
    position: 0,
    enabled: true,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeResponseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'response-001',
    question_id: QUESTION_ID,
    order_id: ORDER_ID,
    buyer_id: BUYER_ID,
    answer: '"M"',  // JSON stringified
    responded_at: '2026-04-14T10:30:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createQuestion', () => {
  it('vytvoří custom otázku pro checkout', async () => {
    const db = makeDb([[makeQuestionRow()]]);

    const result = await createQuestion(EVENT_ID, PROMOTER_ID, {
      label: 'Jakou barvu si přeješ trička?',
      type: 'choice',
      required: true,
      choices: ['S', 'M', 'L', 'XL'],
    }, db);

    expect(result.label).toBe('Jakou barvu si přeješ trička?');
    expect(result.type).toBe('choice');
    expect(result.choices).toEqual(['S', 'M', 'L', 'XL']);
    expect(result.enabled).toBe(true);
  });

  it('vyhodí VALIDATION_ERROR pokud chybí label', async () => {
    const db = makeDb([]);

    await expect(
      createQuestion(EVENT_ID, PROMOTER_ID, {
        label: '',
        type: 'text',
        required: false,
      }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí VALIDATION_ERROR pokud choice/checkbox bez choices', async () => {
    const db = makeDb([]);

    await expect(
      createQuestion(EVENT_ID, PROMOTER_ID, {
        label: 'Select one',
        type: 'choice',
        required: true,
        choices: undefined,
      }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('listQuestionsForEvent', () => {
  it('vrátí všechny enabled otázky pro event (tenant-scoped, ordered by position)', async () => {
    const db = makeDb([[
      makeQuestionRow({ id: 'q1', position: 0, enabled: true }),
      makeQuestionRow({ id: 'q2', position: 1, enabled: true }),
    ]]);

    const result = await listQuestionsForEvent(EVENT_ID, PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].position).toBeLessThanOrEqual(result[1].position);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('enabled = true');
    expect(sql).toContain('ORDER BY position');
  });
});

describe('saveResponse', () => {
  it('uloží odpověď na otázku s JSON serialization', async () => {
    const db = makeDb([[makeResponseRow({ answer: '"M"' })]]);

    const result = await saveResponse(QUESTION_ID, ORDER_ID, BUYER_ID, 'M', db);

    expect(result.answer).toBe('M');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('jsonb');
  });

  it('příjme array odpovědi (checkbox)', async () => {
    const db = makeDb([[makeResponseRow({ answer: '["option1","option2"]' })]]);

    const result = await saveResponse(QUESTION_ID, ORDER_ID, BUYER_ID, ['option1', 'option2'], db);

    expect(result.answer).toEqual(['option1', 'option2']);
  });
});

describe('getResponsesForQuestion', () => {
  it('vrátí všechny odpovědi na otázku pro export', async () => {
    const db = makeDb([[
      makeResponseRow({ id: 'r1', answer: '"M"' }),
      makeResponseRow({ id: 'r2', answer: '"L"' }),
    ]]);

    const result = await getResponsesForQuestion(QUESTION_ID, db);

    expect(result).toHaveLength(2);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY responded_at DESC');
  });
});

describe('getResponsesForOrder', () => {
  it('vrátí všechny odpovědi na všechny otázky pro danou objednávku', async () => {
    const db = makeDb([[
      makeResponseRow({ question_id: 'q1', answer: '"option1"' }),
      makeResponseRow({ question_id: 'q2', answer: '"option2"' }),
    ]]);

    const result = await getResponsesForOrder(ORDER_ID, db);

    expect(result).toHaveLength(2);
  });
});

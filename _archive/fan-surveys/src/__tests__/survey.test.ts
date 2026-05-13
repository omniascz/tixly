import { describe, it, expect, vi } from 'vitest';
import {
  createSurvey,
  activateSurvey,
  submitResponse,
  getSurveyMetrics,
} from '../services/survey.service.js';
import type { DbAdapter } from '../services/survey.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const SURVEY_ID = 'survey-001';
const BUYER_ID = 'buyer-001';

function makeSurveyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SURVEY_ID,
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    type: 'post_event',
    title: 'Concert Feedback',
    description: 'How was your experience?',
    questions: [
      { id: 'q1', question: 'How likely to recommend?', type: 'nps', required: true },
      { id: 'q2', question: 'Overall rating', type: 'rating', required: true },
    ],
    status: 'draft',
    respondent_count: 0,
    response_rate: 0,
    created_at: '2026-04-14T10:00:00Z',
    closed_at: null,
    ...overrides,
  };
}

function makeResponseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'response-001',
    survey_id: SURVEY_ID,
    buyer_id: BUYER_ID,
    responses: { q1: 9, q2: 4 },
    status: 'completed',
    nps_score: 9,
    completed_at: '2026-04-21T10:00:00Z',
    created_at: '2026-04-21T10:00:00Z',
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
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createSurvey', () => {
  it('vytvoří nový survey v draft statusu s otázkami', async () => {
    const db = makeDb([[makeSurveyRow()]]);

    const result = await createSurvey(EVENT_ID, PROMOTER_ID, {
      type: 'post_event',
      title: 'Concert Feedback',
      description: 'How was your experience?',
      questions: [
        { id: 'q1', question: 'How likely to recommend?', type: 'nps', required: true },
      ],
    }, db);

    expect(result.status).toBe('draft');
    expect(result.type).toBe('post_event');
    expect(result.questions).toHaveLength(2);
  });
});

describe('activateSurvey', () => {
  it('změní status z draft na active', async () => {
    const db = makeDb([[makeSurveyRow({ status: 'active' })]]);

    const result = await activateSurvey(SURVEY_ID, PROMOTER_ID, db);

    expect(result.status).toBe('active');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("status = 'active'");
  });

  it('je tenant-scoped na promoter_id', async () => {
    const db = makeDb([[]]);

    await expect(
      activateSurvey(SURVEY_ID, 'wrong-promoter', db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

describe('submitResponse', () => {
  it('uloží odpověď a inkrementuje respondent_count', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([[makeResponseRow()]], executeMock);

    const result = await submitResponse(SURVEY_ID, BUYER_ID, {
      responses: { q1: 9, q2: 4 },
      npsScore: 9,
    }, db);

    expect(result.status).toBe('completed');
    expect(result.npsScore).toBe(9);
    // Check that execute was called for increment
    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('respondent_count = respondent_count + 1');
  });
});

describe('getSurveyMetrics', () => {
  it('vrátí NPS metriky: avgNps, promoters, passives, detractors', async () => {
    const db = makeDb([[{ avg_nps: 8, promoters: 45, passives: 30, detractors: 25 }]]);

    const result = await getSurveyMetrics(SURVEY_ID, db);

    expect(result.avgNps).toBe(8);
    expect(result.promoters).toBe(45);
    expect(result.passives).toBe(30);
    expect(result.detractors).toBe(25);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('BETWEEN 7 AND 8');  // passives range
  });

  it('vrátí 0 pro všechny metriky pokud nejsou NPS skóry', async () => {
    const db = makeDb([[{ avg_nps: null, promoters: 0, passives: 0, detractors: 0 }]]);

    const result = await getSurveyMetrics(SURVEY_ID, db);

    expect(result.avgNps).toBeNull();
    expect(result.promoters).toBe(0);
  });
});

// =============================================================================
// Fan surveys — Post-event & pre-event research (Feature #193)
//
// Průzkumy fanoušků: NPS spokojenosti, preferences, feedback.
// Propojení s CRM segmentací — nespokojení fanoušci dostanou jinou komunikaci.
//
// SCHEMA: surveys.* (migration 125)
// =============================================================================

export type SurveyType = 'pre_event' | 'post_event' | 'nps';
export type SurveyStatus = 'draft' | 'active' | 'closed';
export type ResponseStatus = 'started' | 'completed' | 'skipped';

export interface Survey {
  id: string;
  eventId: string;
  promoterId: string;
  type: SurveyType;
  title: string;
  description?: string;
  questions: SurveyQuestion[];
  status: SurveyStatus;
  respondentCount: number;
  responseRate: number;
  createdAt: string;
  closedAt: string | null;
}

export interface SurveyQuestion {
  id: string;
  question: string;
  type: 'nps' | 'rating' | 'text' | 'choice';
  required: boolean;
  choices?: string[];
}

export interface SurveyResponse {
  id: string;
  surveyId: string;
  buyerId: string;
  responses: Record<string, unknown>;  // { questionId: answer }
  status: ResponseStatus;
  npsScore?: number;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateSurveyInput {
  type: SurveyType;
  title: string;
  description?: string;
  questions: SurveyQuestion[];
}

export interface SubmitResponseInput {
  responses: Record<string, unknown>;
  npsScore?: number;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface SurveyRow {
  id: string;
  event_id: string;
  promoter_id: string;
  type: string;
  title: string;
  description: string | null;
  questions: Record<string, unknown>[];
  status: string;
  respondent_count: number;
  response_rate: number;
  created_at: string;
  closed_at: string | null;
}

interface ResponseRow {
  id: string;
  survey_id: string;
  buyer_id: string;
  responses: Record<string, unknown>;
  status: string;
  nps_score: number | null;
  completed_at: string | null;
  created_at: string;
}

function mapSurvey(row: SurveyRow): Survey {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    type: row.type as SurveyType,
    title: row.title,
    description: row.description || undefined,
    questions: (row.questions as SurveyQuestion[]) || [],
    status: row.status as SurveyStatus,
    respondentCount: row.respondent_count,
    responseRate: row.response_rate,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

function mapResponse(row: ResponseRow): SurveyResponse {
  return {
    id: row.id,
    surveyId: row.survey_id,
    buyerId: row.buyer_id,
    responses: row.responses,
    status: row.status as ResponseStatus,
    npsScore: row.nps_score ?? undefined,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

/**
 * Vytvoří nový survey (draft status).
 */
export async function createSurvey(
  eventId: string,
  promoterId: string,
  input: CreateSurveyInput,
  db: DbAdapter,
): Promise<Survey> {
  const rows = await db.query<SurveyRow>(
    `INSERT INTO surveys.surveys
       (event_id, promoter_id, type, title, description, questions)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [
      eventId,
      promoterId,
      input.type,
      input.title,
      input.description ?? null,
      JSON.stringify(input.questions),
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: survey creation failed');
  return mapSurvey(rows[0]);
}

/**
 * Aktivuje survey (draft → active).
 */
export async function activateSurvey(
  surveyId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<Survey> {
  const rows = await db.query<SurveyRow>(
    `UPDATE surveys.surveys
     SET status = 'active'
     WHERE id = $1 AND promoter_id = $2
     RETURNING *`,
    [surveyId, promoterId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Survey not found');
  return mapSurvey(rows[0]);
}

/**
 * Odešle odpověď na survey a inkrementuje respondent_count.
 */
export async function submitResponse(
  surveyId: string,
  buyerId: string,
  input: SubmitResponseInput,
  db: DbAdapter,
): Promise<SurveyResponse> {
  const rows = await db.query<ResponseRow>(
    `INSERT INTO surveys.survey_responses
       (survey_id, buyer_id, responses, status, nps_score, completed_at)
     VALUES ($1, $2, $3::jsonb, 'completed', $4, NOW())
     RETURNING *`,
    [surveyId, buyerId, JSON.stringify(input.responses), input.npsScore ?? null],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: response insert failed');

  // Inkrementuj respondent_count
  await db.execute(
    `UPDATE surveys.surveys SET respondent_count = respondent_count + 1 WHERE id = $1`,
    [surveyId],
  );

  return mapResponse(rows[0]);
}

/**
 * Vrátí agregované NPS metriky pro survey.
 */
export async function getSurveyMetrics(
  surveyId: string,
  db: DbAdapter,
): Promise<{ avgNps: number | null; promoters: number; passives: number; detractors: number }> {
  const rows = await db.query<{ avg_nps: number | null; promoters: number; passives: number; detractors: number }>(
    `SELECT
       ROUND(AVG(nps_score)) as avg_nps,
       SUM(CASE WHEN nps_score >= 9 THEN 1 ELSE 0 END) as promoters,
       SUM(CASE WHEN nps_score BETWEEN 7 AND 8 THEN 1 ELSE 0 END) as passives,
       SUM(CASE WHEN nps_score <= 6 THEN 1 ELSE 0 END) as detractors
     FROM surveys.survey_responses
     WHERE survey_id = $1 AND nps_score IS NOT NULL`,
    [surveyId],
  );
  if (!rows[0]) {
    return { avgNps: null, promoters: 0, passives: 0, detractors: 0 };
  }
  return {
    avgNps: rows[0].avg_nps,
    promoters: rows[0].promoters || 0,
    passives: rows[0].passives || 0,
    detractors: rows[0].detractors || 0,
  };
}

// =============================================================================
// Checkout custom questions — Feature #64
//
// Pořadatel přidá vlastní pole v checkoutu: menu preferences, t-shirt size,
// jak se o akci dozvěděli. Data dostupná v exportu.
//
// SCHEMA: checkout.* (migration 126)
// =============================================================================

export type QuestionType = 'text' | 'choice' | 'checkbox' | 'rating' | 'date';

export interface CustomQuestion {
  id: string;
  eventId: string;
  promoterId: string;
  label: string;
  type: QuestionType;
  required: boolean;
  choices?: string[];           // pro choice/checkbox typy
  position: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionResponse {
  id: string;
  questionId: string;
  orderId: string;
  buyerId: string;
  answer: string | string[] | boolean | number;
  respondedAt: string;
}

export interface CreateQuestionInput {
  label: string;
  type: QuestionType;
  required: boolean;
  choices?: string[];
  position?: number;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface QuestionRow {
  id: string;
  event_id: string;
  promoter_id: string;
  label: string;
  type: string;
  required: boolean;
  choices: string[] | null;
  position: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface ResponseRow {
  id: string;
  question_id: string;
  order_id: string;
  buyer_id: string;
  answer: string;  // JSON stringified
  responded_at: string;
}

function mapQuestion(row: QuestionRow): CustomQuestion {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    label: row.label,
    type: row.type as QuestionType,
    required: row.required,
    choices: row.choices || undefined,
    position: row.position,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapResponse(row: ResponseRow): QuestionResponse {
  return {
    id: row.id,
    questionId: row.question_id,
    orderId: row.order_id,
    buyerId: row.buyer_id,
    answer: JSON.parse(row.answer),
    respondedAt: row.responded_at,
  };
}

/**
 * Vytvoří novou custom otázku v checkoutu.
 */
export async function createQuestion(
  eventId: string,
  promoterId: string,
  input: CreateQuestionInput,
  db: DbAdapter,
): Promise<CustomQuestion> {
  if (!input.label) {
    throw new Error('VALIDATION_ERROR: label required');
  }
  if (input.type === 'choice' || input.type === 'checkbox') {
    if (!input.choices || input.choices.length < 2) {
      throw new Error('VALIDATION_ERROR: choices required for choice/checkbox types');
    }
  }

  const position = input.position ?? 0;
  const rows = await db.query<QuestionRow>(
    `INSERT INTO checkout.custom_questions
       (event_id, promoter_id, label, type, required, choices, position)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7)
     RETURNING *`,
    [eventId, promoterId, input.label, input.type, input.required, JSON.stringify(input.choices || []), position],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: question creation failed');
  return mapQuestion(rows[0]);
}

/**
 * Vrátí všechny otázky pro event (tenant-scoped, enabled=true).
 */
export async function listQuestionsForEvent(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<CustomQuestion[]> {
  const rows = await db.query<QuestionRow>(
    `SELECT * FROM checkout.custom_questions
     WHERE event_id = $1 AND promoter_id = $2 AND enabled = true
     ORDER BY position`,
    [eventId, promoterId],
  );
  return rows.map(mapQuestion);
}

/**
 * Uloží odpověď na otázku.
 */
export async function saveResponse(
  questionId: string,
  orderId: string,
  buyerId: string,
  answer: string | string[] | boolean | number,
  db: DbAdapter,
): Promise<QuestionResponse> {
  const rows = await db.query<ResponseRow>(
    `INSERT INTO checkout.question_responses
       (question_id, order_id, buyer_id, answer)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING *`,
    [questionId, orderId, buyerId, JSON.stringify(answer)],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: response insert failed');
  return mapResponse(rows[0]);
}

/**
 * Vrátí všechny odpovědi na otázku (pro export).
 */
export async function getResponsesForQuestion(
  questionId: string,
  db: DbAdapter,
): Promise<QuestionResponse[]> {
  const rows = await db.query<ResponseRow>(
    `SELECT * FROM checkout.question_responses
     WHERE question_id = $1
     ORDER BY responded_at DESC`,
    [questionId],
  );
  return rows.map(mapResponse);
}

/**
 * Vrátí všechny odpovědi pro objednávku.
 */
export async function getResponsesForOrder(
  orderId: string,
  db: DbAdapter,
): Promise<QuestionResponse[]> {
  const rows = await db.query<ResponseRow>(
    `SELECT * FROM checkout.question_responses WHERE order_id = $1`,
    [orderId],
  );
  return rows.map(mapResponse);
}

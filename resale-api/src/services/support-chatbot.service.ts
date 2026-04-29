// =============================================================================
// Support Chatbot Service — AI Fan Support
// Feature #46: Self-service chatbot for refund status, entry info, lost ticket
//              Automates 60–80% of support queries via Claude AI
//
// Architecture:
//   - Claude claude-haiku-4-5 for fast, cheap responses
//   - Context injection: order/ticket/event data loaded from DB and injected into system prompt
//   - Escalation: if AI can't resolve, escalate to human agent
//   - Session log persisted to DB for audit and quality monitoring
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface CallAiFn {
  (options: {
    model: string;
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens: number;
  }): Promise<{ text: string; tokensUsed: number; latencyMs: number }>;
}

export interface ChatSession {
  id: string;
  userId: string | null;
  sessionToken: string;
  orderId: string | null;
  ticketId: string | null;
  eventId: string | null;
  status: 'open' | 'resolved' | 'escalated';
  escalatedTo: string | null;
  resolutionSummary: string | null;
  createdAt: string;
  lastMessageAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokensUsed: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface ChatContext {
  orderStatus?: string;
  orderTotal?: number;
  eventName?: string;
  eventDate?: string;
  venueName?: string;
  ticketStatus?: string;
  seatInfo?: string;
  refundPolicy?: string;
}

interface SessionRow {
  id: string;
  user_id: string | null;
  session_token: string;
  order_id: string | null;
  ticket_id: string | null;
  event_id: string | null;
  status: string;
  escalated_to: string | null;
  resolution_summary: string | null;
  created_at: string;
  last_message_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tokens_used: number | null;
  latency_ms: number | null;
  created_at: string;
}

function mapSession(r: SessionRow): ChatSession {
  return {
    id: r.id,
    userId: r.user_id,
    sessionToken: r.session_token,
    orderId: r.order_id,
    ticketId: r.ticket_id,
    eventId: r.event_id,
    status: r.status as ChatSession['status'],
    escalatedTo: r.escalated_to,
    resolutionSummary: r.resolution_summary,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
  };
}

function mapMessage(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role as ChatMessage['role'],
    content: r.content,
    tokensUsed: r.tokens_used,
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
  };
}

function buildSystemPrompt(context: ChatContext): string {
  const lines = [
    'Jsi virtuální asistent zákaznické podpory pro ticketingovou platformu Tixly.',
    'Tvým úkolem je pomoci návštěvníkovi s jeho dotazem rychle a přátelsky.',
    '',
    'Co umíš řešit:',
    '- Status objednávky a vstupenky',
    '- Informace o vstupu na akci (čas, místo, podmínky)',
    '- Ztracená nebo nezobrazená vstupenka',
    '- Refundace a storno podmínky',
    '- Technické problémy s přístupem k vstupence',
    '',
    'Pravidla:',
    '- Vždy buď zdvořilý a empatický',
    '- Pokud nevíš, přiznej to a nabídni eskalaci na lidského agenta',
    '- Neposkytuj informace, které nemáš potvrzené z kontextu',
    '- Eskalaci doporuč větou: "Potřebuji to předat kolegovi z podpory."',
    '',
  ];

  if (Object.keys(context).length > 0) {
    lines.push('Kontext zákazníka:');
    if (context.orderStatus) lines.push(`- Status objednávky: ${context.orderStatus}`);
    if (context.orderTotal) lines.push(`- Celková částka: ${(context.orderTotal / 100).toFixed(2)} Kč`);
    if (context.eventName) lines.push(`- Akce: ${context.eventName}`);
    if (context.eventDate) lines.push(`- Datum: ${context.eventDate}`);
    if (context.venueName) lines.push(`- Místo: ${context.venueName}`);
    if (context.ticketStatus) lines.push(`- Status vstupenky: ${context.ticketStatus}`);
    if (context.seatInfo) lines.push(`- Sedadlo: ${context.seatInfo}`);
    if (context.refundPolicy) lines.push(`- Podmínky vrácení: ${context.refundPolicy}`);
  }

  return lines.join('\n');
}

/**
 * Start a new support chat session.
 */
export async function startChatSession(
  userId: string | null,
  context: {
    orderId?: string;
    ticketId?: string;
    eventId?: string;
  },
  db: DbAdapter,
): Promise<ChatSession> {
  const rows = await db.query<SessionRow>(
    `INSERT INTO support_chat.chat_sessions (user_id, order_id, ticket_id, event_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, context.orderId ?? null, context.ticketId ?? null, context.eventId ?? null],
  );

  return mapSession(rows[0]);
}

/**
 * Send a user message and get an AI response.
 */
export async function sendMessage(
  sessionId: string,
  userMessage: string,
  chatContext: ChatContext,
  callAi: CallAiFn,
  db: DbAdapter,
): Promise<{ userMsg: ChatMessage; assistantMsg: ChatMessage; shouldEscalate: boolean }> {
  if (!userMessage.trim()) {
    throw new Error('VALIDATION_ERROR: message cannot be empty');
  }

  // Verify session exists
  const sessions = await db.query<SessionRow>(
    `SELECT * FROM support_chat.chat_sessions WHERE id = $1 AND status = 'open'`,
    [sessionId],
  );

  if (!sessions[0]) throw new Error('SESSION_NOT_FOUND or SESSION_CLOSED');

  // Get conversation history (last 10 messages for context window)
  const history = await db.query<MessageRow>(
    `SELECT * FROM support_chat.chat_messages
     WHERE session_id = $1 AND role IN ('user', 'assistant')
     ORDER BY created_at DESC LIMIT 10`,
    [sessionId],
  );

  const messages = history
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  messages.push({ role: 'user', content: userMessage });

  // Persist user message
  const userMsgRows = await db.query<MessageRow>(
    `INSERT INTO support_chat.chat_messages (session_id, role, content)
     VALUES ($1, 'user', $2)
     RETURNING *`,
    [sessionId, userMessage],
  );

  const systemPrompt = buildSystemPrompt(chatContext);

  // Call AI
  const aiResult = await callAi({
    model: 'claude-haiku-4-5-20251001',
    system: systemPrompt,
    messages,
    maxTokens: 512,
  });

  // Detect escalation signal in AI response
  const shouldEscalate = aiResult.text.toLowerCase().includes('předat kolegovi') ||
    aiResult.text.toLowerCase().includes('lidskému agentovi') ||
    aiResult.text.toLowerCase().includes('eskalac');

  // Persist AI response
  const assistantMsgRows = await db.query<MessageRow>(
    `INSERT INTO support_chat.chat_messages (session_id, role, content, tokens_used, latency_ms)
     VALUES ($1, 'assistant', $2, $3, $4)
     RETURNING *`,
    [sessionId, aiResult.text, aiResult.tokensUsed, aiResult.latencyMs],
  );

  // Update session last_message_at
  await db.execute(
    `UPDATE support_chat.chat_sessions SET last_message_at = NOW() WHERE id = $1`,
    [sessionId],
  );

  return {
    userMsg: mapMessage(userMsgRows[0]),
    assistantMsg: mapMessage(assistantMsgRows[0]),
    shouldEscalate,
  };
}

/**
 * Escalate a session to a human agent.
 */
export async function escalateSession(
  sessionId: string,
  agentEmail: string,
  db: DbAdapter,
): Promise<ChatSession> {
  const rows = await db.query<SessionRow>(
    `UPDATE support_chat.chat_sessions
     SET status = 'escalated', escalated_to = $2
     WHERE id = $1 AND status = 'open'
     RETURNING *`,
    [sessionId, agentEmail],
  );

  if (!rows[0]) throw new Error('SESSION_NOT_FOUND');
  return mapSession(rows[0]);
}

/**
 * Resolve a session (user satisfied, no agent needed).
 */
export async function resolveSession(
  sessionId: string,
  resolutionSummary: string,
  db: DbAdapter,
): Promise<ChatSession> {
  const rows = await db.query<SessionRow>(
    `UPDATE support_chat.chat_sessions
     SET status = 'resolved', resolution_summary = $2
     WHERE id = $1 AND status = 'open'
     RETURNING *`,
    [sessionId, resolutionSummary],
  );

  if (!rows[0]) throw new Error('SESSION_NOT_FOUND');
  return mapSession(rows[0]);
}

/**
 * Get full chat history for a session.
 */
export async function getChatHistory(sessionId: string, db: DbAdapter): Promise<ChatMessage[]> {
  const rows = await db.query<MessageRow>(
    `SELECT * FROM support_chat.chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map(mapMessage);
}

/**
 * Record user feedback for a session.
 */
export async function recordFeedback(
  sessionId: string,
  resolvedWithoutAgent: boolean,
  rating: number | null,
  feedbackText: string | null,
  db: DbAdapter,
): Promise<void> {
  if (rating !== null && (rating < 1 || rating > 5)) {
    throw new Error('VALIDATION_ERROR: rating must be between 1 and 5');
  }

  await db.execute(
    `INSERT INTO support_chat.session_feedback (session_id, resolved_without_agent, rating, feedback_text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id) DO UPDATE SET
       resolved_without_agent = EXCLUDED.resolved_without_agent,
       rating = EXCLUDED.rating,
       feedback_text = EXCLUDED.feedback_text`,
    [sessionId, resolvedWithoutAgent, rating, feedbackText],
  );
}

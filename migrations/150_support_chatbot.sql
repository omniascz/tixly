-- =============================================================================
-- Migration 150: AI Chatbot for Fan Support
-- Feature #46: Self-service chatbot — refund status, entry info, lost ticket
--              Automates 60–80% of support queries via Claude AI
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS support_chat;

-- Chat session: one per support conversation
CREATE TABLE IF NOT EXISTS support_chat.chat_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID,                   -- NULL = anonymous (pre-login)
  session_token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  order_id            UUID,                   -- optional context: linked order
  ticket_id           UUID,                   -- optional context: linked ticket
  event_id            UUID,                   -- optional context: linked event
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'escalated')),
  escalated_to        TEXT,                   -- support agent email if escalated
  resolution_summary  TEXT,                  -- AI-generated summary on close
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chat messages: user ↔ AI conversation log
CREATE TABLE IF NOT EXISTS support_chat.chat_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES support_chat.chat_sessions(id),
  role                TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content             TEXT NOT NULL,
  tokens_used         INT,                    -- AI token tracking
  latency_ms          INT,                    -- AI response time
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Metrics for monitoring chatbot effectiveness
CREATE TABLE IF NOT EXISTS support_chat.session_feedback (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL UNIQUE REFERENCES support_chat.chat_sessions(id),
  resolved_without_agent BOOLEAN NOT NULL,
  rating              INT CHECK (rating BETWEEN 1 AND 5),
  feedback_text       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_sessions_user ON support_chat.chat_sessions(user_id);
CREATE INDEX idx_chat_messages_session ON support_chat.chat_messages(session_id);

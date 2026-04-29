CREATE TABLE IF NOT EXISTS bot_proof_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  fingerprint_hash TEXT,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','challenge_required','verified','admitted','rejected','expired')),
  challenge_token TEXT,
  challenge_expires_at TIMESTAMPTZ,
  admitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  UNIQUE (event_id, session_id)
);
CREATE INDEX idx_bpq_event_status ON bot_proof_queue(event_id, status);
CREATE INDEX idx_bpq_position ON bot_proof_queue(event_id, position) WHERE status IN ('waiting','verified');
CREATE INDEX idx_bpq_expires ON bot_proof_queue(expires_at) WHERE status NOT IN ('admitted','rejected','expired');

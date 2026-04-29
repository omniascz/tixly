-- =============================================================================
-- Migration 137: Virtual Waiting Room — High-Demand Event Queue
-- Feature #24: Redis-backed queue with anti-bot and fair access
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS waiting_room;

-- Waiting room configuration per event
CREATE TABLE waiting_room.queues (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id) UNIQUE,
  promoter_id         UUID NOT NULL,
  is_active           BOOL NOT NULL DEFAULT false,
  max_concurrent_users INT NOT NULL DEFAULT 500,   -- Users buying at same time
  entry_rate_per_min  INT NOT NULL DEFAULT 100,    -- How many enter per minute
  session_ttl_seconds INT NOT NULL DEFAULT 600,   -- 10 min buying window
  randomize_entry     BOOL NOT NULL DEFAULT true,  -- Anti-bot: randomize entry order
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queue entries — one row per user per event
CREATE TABLE waiting_room.queue_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  user_id             TEXT NOT NULL,              -- Can be anonymous fingerprint
  session_token       TEXT UNIQUE,               -- Issued when user enters active session
  queue_position      INT,                       -- Randomized position, set on join
  status              TEXT NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting', 'active', 'expired', 'completed')),
  priority_score      DECIMAL(10,4) NOT NULL DEFAULT 0,  -- For randomized sorting
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at        TIMESTAMPTZ,               -- When buying window started
  expires_at          TIMESTAMPTZ,               -- When buying window closes
  completed_at        TIMESTAMPTZ,               -- When order confirmed
  UNIQUE(event_id, user_id)
);

-- Queue position snapshots (for analytics)
CREATE TABLE waiting_room.position_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  waiting_count       INT NOT NULL,
  active_count        INT NOT NULL,
  snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_queue_entries_event ON waiting_room.queue_entries(event_id);
CREATE INDEX idx_queue_entries_status ON waiting_room.queue_entries(event_id, status);
CREATE INDEX idx_queue_entries_priority ON waiting_room.queue_entries(event_id, priority_score)
  WHERE status = 'waiting';
CREATE INDEX idx_position_snapshots_event ON waiting_room.position_snapshots(event_id, snapshot_at);

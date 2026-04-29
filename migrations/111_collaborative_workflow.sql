-- Migration 111: Collaborative event workflow (Feature #49)
-- Pozvání týmu do správy akce, role-based access, schvalování změn.

CREATE SCHEMA IF NOT EXISTS collab;

-- Spolupracovníci na akci
CREATE TABLE collab.event_collaborators (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,               -- ref: catalog.events(id)
  owner_promoter_id UUID NOT NULL,             -- vlastník akce
  invitee_user_id UUID NOT NULL,               -- pozvaný uživatel
  role            TEXT NOT NULL CHECK (role IN ('agent', 'box_office', 'co_promoter', 'viewer')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  invited_by      UUID NOT NULL,               -- kdo pozval
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at    TIMESTAMPTZ,
  CONSTRAINT collaborator_event_user_unique UNIQUE (event_id, invitee_user_id)
);

-- Požadavky na změnu (cena, kapacita — musí schválit vlastník nebo co_promoter)
CREATE TABLE collab.change_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,
  owner_promoter_id UUID NOT NULL,
  requested_by    UUID NOT NULL,               -- collaborator user_id
  field           TEXT NOT NULL,               -- 'price_halire' | 'capacity' | 'title' atd.
  ticket_type_id  UUID,                        -- vyplněno pokud se týká ticket_type
  old_value       JSONB NOT NULL,
  new_value       JSONB NOT NULL,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ,
  rejection_note  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log změn provedených přes collaborative workflow
CREATE TABLE collab.change_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,
  actor_user_id   UUID NOT NULL,
  change_request_id UUID REFERENCES collab.change_requests(id),
  field           TEXT NOT NULL,
  old_value       JSONB,
  new_value       JSONB,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexy
CREATE INDEX idx_collaborators_event ON collab.event_collaborators (event_id);
CREATE INDEX idx_collaborators_invitee ON collab.event_collaborators (invitee_user_id);
CREATE INDEX idx_change_requests_event ON collab.change_requests (event_id);
CREATE INDEX idx_change_requests_status ON collab.change_requests (status) WHERE status = 'pending';
CREATE INDEX idx_change_log_event ON collab.change_log (event_id);

-- Migration 113: AXS Invite — Friend reservations (Feature #50)
-- Kupující si vybere volná místa vedle sebe a pošle link přátelům.

CREATE SCHEMA IF NOT EXISTS invites;

CREATE TABLE invites.friend_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,              -- ref: catalog.events(id)
  buyer_id        UUID NOT NULL,              -- originální kupující
  invite_token    TEXT NOT NULL UNIQUE,       -- bezpečný token v URL
  invitee_email   TEXT NOT NULL,
  seat_hold_qty   INTEGER NOT NULL CHECK (seat_hold_qty BETWEEN 1 AND 10),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at      TIMESTAMPTZ NOT NULL,       -- 7 dní od vytvoření
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_friend_invites_event   ON invites.friend_invites (event_id);
CREATE INDEX idx_friend_invites_buyer   ON invites.friend_invites (buyer_id);
CREATE INDEX idx_friend_invites_token   ON invites.friend_invites (invite_token);

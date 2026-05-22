-- 322_group_invitations.sql
-- CZ priority #5 (ROI 6/10): Group bookings light — invite link pattern.
--
-- Organizer pošle linkový invite "Koupit 4 vstupenky na koncert se mnou".
-- Friend klikne, vidí event detail + group context ("X z 4 lidí už koupilo"),
-- koupí svůj ticket přes existující checkout. Group_id v order linkuje
-- tickety. Žádné payment splitting v MVP — každý platí sám.
--
-- Full payment splitting (parent order + N children s share_halire) je
-- větší architektonický refactor, mimo MVP scope.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS orders.group_invitations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id   uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  event_id            uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  ticket_type_id      uuid REFERENCES catalog.ticket_types(id) ON DELETE SET NULL,
  target_seats        integer NOT NULL,           -- kolik lidí má dohromady přijít
  invite_token        text NOT NULL UNIQUE,
  message             text,
  status              text NOT NULL DEFAULT 'open',
  expires_at          timestamptz NOT NULL DEFAULT now() + INTERVAL '14 days',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_invitations_status_check
    CHECK (status IN ('open', 'completed', 'expired', 'cancelled')),
  CONSTRAINT group_invitations_target_seats_check
    CHECK (target_seats >= 2 AND target_seats <= 50)
);

CREATE INDEX IF NOT EXISTS idx_group_invitations_organizer
  ON orders.group_invitations(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_group_invitations_event
  ON orders.group_invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_group_invitations_open
  ON orders.group_invitations(invite_token) WHERE status = 'open';

-- Linkage table: order ↔ group_invitation (každý buyer's order může být
-- součástí group). Pomáhá s "X z N lidí už zaplatilo" aggregation.
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS group_invitation_id uuid REFERENCES orders.group_invitations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_group_invitation
  ON orders.orders(group_invitation_id) WHERE group_invitation_id IS NOT NULL;

COMMENT ON TABLE orders.group_invitations IS
  'Group booking invite link. Organizer share-uje URL, friends koupí přes '
  'existing checkout s group_invitation_id query param. Žádné payment '
  'splitting v MVP — každý buyer platí sám svůj ticket.';

COMMIT;

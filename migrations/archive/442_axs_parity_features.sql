-- 442 — AXS parity features: random waiting room, crypto pay, adjacent-seat invite

-- ── Feature 1: random-selection waiting room (AXS "Fair AXS") ────────────────
-- queue_mode='random' → pořadí ve frontě losováno (čas příchodu nerozhoduje),
-- 'fifo' = původní first-come. draw_seed je náhodné per token.
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS queue_mode text NOT NULL DEFAULT 'fifo';
ALTER TABLE catalog.events DROP CONSTRAINT IF EXISTS events_queue_mode_check;
ALTER TABLE catalog.events ADD CONSTRAINT events_queue_mode_check CHECK (queue_mode IN ('fifo','random'));
ALTER TABLE platform.queue_tokens ADD COLUMN IF NOT EXISTS draw_seed double precision NOT NULL DEFAULT random();

-- ── Feature 2: crypto payment provider (Bitcoin/Ethereum via Triple-A) ───────
ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_payment_provider_check CHECK (payment_provider IN ('mock','gopay','comgate','stripe','wero','przelewy24','bank_transfer','twisto','skippay','pluxee','sodexo','benefit_plus','edenred','multisport','voucher','charity','free','crypto'));

-- ── Feature 3: adjacent-seat invite (AXS Invite) ────────────────────────────
-- Organizátor drží N sousedních sedadel, přátelé mají 48 h na claim/zaplacení.
ALTER TABLE orders.group_invitations ADD COLUMN IF NOT EXISTS adjacent_reserve boolean NOT NULL DEFAULT false;
ALTER TABLE orders.group_invitations ADD COLUMN IF NOT EXISTS held_seat_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE orders.group_invitations ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;
ALTER TABLE orders.group_invitations ADD COLUMN IF NOT EXISTS seats_claimed int NOT NULL DEFAULT 0;
-- povol hold_kind='group_invite' pro AXS Invite držená sedadla
ALTER TABLE catalog.event_seats DROP CONSTRAINT IF EXISTS event_seats_hold_kind_check;
ALTER TABLE catalog.event_seats ADD CONSTRAINT event_seats_hold_kind_check CHECK (hold_kind IS NULL OR hold_kind IN ('artist','promoter','comp','production','customer','group_invite'));

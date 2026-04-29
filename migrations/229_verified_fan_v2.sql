CREATE TABLE IF NOT EXISTS presale_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  registration_open TIMESTAMPTZ NOT NULL,
  registration_close TIMESTAMPTZ NOT NULL,
  selection_date TIMESTAMPTZ NOT NULL,
  max_select_count INTEGER NOT NULL CHECK (max_select_count > 0),
  max_tickets_per_fan INTEGER NOT NULL DEFAULT 2 CHECK (max_tickets_per_fan > 0),
  status TEXT NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fan_registrations_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  selected_at TIMESTAMPTZ,
  purchase_window_expires_at TIMESTAMPTZ,
  purchased_at TIMESTAMPTZ,
  UNIQUE (event_id, user_id)
);
CREATE INDEX idx_fan_reg_event ON fan_registrations_v2(event_id);
CREATE INDEX idx_fan_reg_user ON fan_registrations_v2(user_id);
CREATE INDEX idx_fan_reg_status ON fan_registrations_v2(status) WHERE status IN ('selected','purchase_window_open');

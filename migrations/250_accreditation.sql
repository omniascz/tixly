-- Accreditation — žádosti o akreditaci (media, VIP, staff, sponzor, performer).
-- Po schválení promotérem se vystaví comp ticket (price 0, ticket_type.kind='accreditation').

BEGIN;

CREATE TABLE marketing.accreditation_requests (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID         NOT NULL,
  applicant_email TEXT         NOT NULL,
  applicant_name  TEXT         NOT NULL,
  organization    TEXT,
  category        TEXT         NOT NULL
    CHECK (category IN ('media', 'vip', 'staff', 'sponsor', 'performer', 'guest')),
  role_detail     TEXT,                  -- e.g. 'photographer', 'production', 'NGO partner'
  message         TEXT,
  status          TEXT         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewer_user_id UUID,
  reviewed_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  issued_ticket_id UUID,                  -- pokud approved a vystavený, ref na tickets.tickets
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_accr_email_lowercase CHECK (applicant_email = LOWER(applicant_email)),
  CONSTRAINT uq_accr_event_email_category UNIQUE (event_id, applicant_email, category)
);

CREATE INDEX idx_accr_event_status
  ON marketing.accreditation_requests (event_id, status, created_at DESC);

CREATE INDEX idx_accr_email
  ON marketing.accreditation_requests (applicant_email);

COMMENT ON TABLE marketing.accreditation_requests IS
  'Žádosti o akreditaci na akci. Schvaluje promotér; po approve může vystavit comp ticket.';
COMMENT ON COLUMN marketing.accreditation_requests.issued_ticket_id IS
  'Pokud approved a comp ticket vystavený, reference na tickets.tickets pro audit.';

COMMIT;

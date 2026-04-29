-- =============================================================================
-- Migration 032: Conference Badge Printing
-- =============================================================================

-- Badge templates: define layout and visual style for badges
CREATE TABLE conference.badge_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id    UUID NOT NULL REFERENCES conference.conferences(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  width_mm         INT NOT NULL DEFAULT 85,
  height_mm        INT NOT NULL DEFAULT 54,
  background_color CHAR(7) NOT NULL DEFAULT '#ffffff',
  accent_color     CHAR(7) NOT NULL DEFAULT '#6366f1',
  logo_url         TEXT,
  show_photo       BOOL NOT NULL DEFAULT true,
  show_company     BOOL NOT NULL DEFAULT true,
  show_qr          BOOL NOT NULL DEFAULT true,
  show_role        BOOL NOT NULL DEFAULT true,
  font_size_name   INT NOT NULL DEFAULT 20,
  font_size_company INT NOT NULL DEFAULT 14,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conference_id, name)
);

-- Print jobs: batch PDF generation requests
CREATE TABLE conference.badge_print_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id   UUID NOT NULL REFERENCES conference.conferences(id) ON DELETE CASCADE,
  template_id     UUID NOT NULL REFERENCES conference.badge_templates(id) ON DELETE RESTRICT,
  requested_by    UUID NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','failed')),
  total_count     INT NOT NULL DEFAULT 0,
  processed_count INT NOT NULL DEFAULT 0,
  error_message   TEXT,
  pdf_url         TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- Per-activation badge overrides (custom name, company, role, color)
CREATE TABLE conference.badge_overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id    UUID NOT NULL REFERENCES conference.pass_activations(id) ON DELETE CASCADE,
  display_name     TEXT,
  display_company  TEXT,
  display_role     TEXT,
  badge_color      CHAR(7),
  notes            TEXT,
  UNIQUE (activation_id)
);

-- Indexes
CREATE INDEX idx_badge_print_jobs_conf_status
  ON conference.badge_print_jobs (conference_id, status);

CREATE INDEX idx_badge_print_jobs_requested_by
  ON conference.badge_print_jobs (requested_by);

CREATE INDEX idx_badge_overrides_activation
  ON conference.badge_overrides (activation_id);

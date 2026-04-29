-- Migration 129: Ticket layout editor (Feature #70)

CREATE SCHEMA IF NOT EXISTS pdf_templates;

CREATE TABLE pdf_templates.ticket_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL,              -- ref: catalog.events(id)
  promoter_id           UUID NOT NULL,              -- tenant
  name                  TEXT NOT NULL,              -- "Standard", "Premium", "VIP"
  logo_url              TEXT NOT NULL,              -- Brand logo URL
  background_color      TEXT,                       -- Hex color (#FF0000)
  background_image_url  TEXT,                       -- Background image
  text_color            TEXT,                       -- Hex color for text
  custom_text           TEXT,                       -- Vlastní text (kontakt, QR hint)
  qr_position           TEXT NOT NULL DEFAULT 'bottom-right'
                          CHECK (qr_position IN ('top-left', 'top-right', 'bottom-left', 'bottom-right', 'center')),
  is_default            BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, is_default) WHERE is_default = true  -- pouze 1 default per event
);

CREATE INDEX idx_templates_event ON pdf_templates.ticket_templates (event_id);
CREATE INDEX idx_templates_default ON pdf_templates.ticket_templates (event_id)
  WHERE is_default = true;

-- Migration 119: Fan communication templates (Feature #60)
-- Pre-built emaily + SMS: countdown, venue info, post-event.

CREATE SCHEMA IF NOT EXISTS comms;

CREATE TABLE comms.fan_communication_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL,              -- tenant
  event_id        UUID NOT NULL,              -- ref: catalog.events(id)
  type            TEXT NOT NULL CHECK (type IN ('email', 'sms')),
  template_name   TEXT NOT NULL CHECK (template_name IN ('countdown_7d', 'countdown_1d', 'venue_info', 'post_event')),
  subject         TEXT,                       -- jen pro email
  body            TEXT NOT NULL,              -- Placeholders: {{eventTitle}}, {{eventDate}}, {{eventTime}}, {{venueAddress}}, {{ticketUrl}}
  enabled         BOOLEAN NOT NULL DEFAULT true,
  scheduled_for   TIMESTAMPTZ,                -- pro automatické odeslání
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, type, template_name)
);

CREATE INDEX idx_comms_event    ON comms.fan_communication_templates (event_id);
CREATE INDEX idx_comms_promoter ON comms.fan_communication_templates (promoter_id);
CREATE INDEX idx_comms_scheduled ON comms.fan_communication_templates (event_id)
  WHERE enabled = true AND scheduled_for IS NOT NULL;

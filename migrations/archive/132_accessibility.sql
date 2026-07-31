-- =============================================================================
-- Migration 132: Accessibility — Companion Tickets & Accessible Seating
-- Feature #32: EU regulatory requirement for disabled attendee support
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS accessibility;

-- Companion ticket pairs (primary + free companion for disabled person)
CREATE TABLE accessibility.companion_pairs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_ticket_id UUID NOT NULL REFERENCES tickets.tickets(id),
  companion_ticket_id UUID NOT NULL REFERENCES tickets.tickets(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('assistant', 'carer', 'support_person', 'guide')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(primary_ticket_id, companion_ticket_id),
  CONSTRAINT no_self_pairing CHECK (primary_ticket_id != companion_ticket_id)
);

-- Accessibility metadata for seats
CREATE TABLE accessibility.accessible_seats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id       UUID NOT NULL,
  seat_id           TEXT NOT NULL,  -- e.g., 'A12', 'B5', etc.
  seat_section      TEXT,
  accessibility_type TEXT NOT NULL CHECK (accessibility_type IN (
    'wheelchair_accessible',
    'wheelchair_companion_space',
    'accessible_toilet_nearby',
    'hearing_loop',
    'accessible_entrance'
  )),
  is_available      BOOL NOT NULL DEFAULT true,
  reserved_until    TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, seat_id, accessibility_type)
);

-- Accessibility accommodations requested at checkout
CREATE TABLE accessibility.accommodations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         UUID NOT NULL REFERENCES tickets.tickets(id),
  accommodation_type TEXT NOT NULL CHECK (accommodation_type IN (
    'wheelchair_access',
    'blind_person_guide',
    'deaf_support',
    'mobility_assistance',
    'service_animal_space',
    'accessible_toilet',
    'hearing_loop',
    'audio_description'
  )),
  additional_info   TEXT,
  verified          BOOL NOT NULL DEFAULT false,
  verified_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_id, accommodation_type)
);

-- Indexes
CREATE INDEX idx_companion_pairs_primary ON accessibility.companion_pairs(primary_ticket_id);
CREATE INDEX idx_companion_pairs_companion ON accessibility.companion_pairs(companion_ticket_id);
CREATE INDEX idx_accessible_seats_event ON accessibility.accessible_seats(event_id);
CREATE INDEX idx_accessible_seats_promoter ON accessibility.accessible_seats(promoter_id, event_id);
CREATE INDEX idx_accommodations_ticket ON accessibility.accommodations(ticket_id);

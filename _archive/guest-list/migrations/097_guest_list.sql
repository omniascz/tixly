-- =============================================================================
-- MIGRACE 097: Guest List
-- Datum: 2026-04-11
-- Schema: guest_list (izolované dle schema-per-service architektury)
-- Cross-schema FK zakázané — stejná konvence jako ostatní schémata platformy
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS guest_list;

-- =============================================================================
-- guest_list.guests
-- Záznamy hostů na guest listu pro eventy.
-- Lifecycle: invited → confirmed → checked_in | no_show | cancelled
-- =============================================================================

CREATE TABLE guest_list.guests (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- event_id z catalog.events — cross-schema, bez FK
    event_id                UUID            NOT NULL,
    name                    TEXT            NOT NULL,
    email                   TEXT,
    phone                   TEXT,
    guest_type              TEXT            NOT NULL DEFAULT 'complimentary'
        CHECK (guest_type IN ('complimentary', 'press', 'vip', 'industry', 'promo', 'other')),
    status                  TEXT            NOT NULL DEFAULT 'invited'
        CHECK (status IN ('invited', 'confirmed', 'checked_in', 'no_show', 'cancelled')),
    -- Kolik dalších osob host přivede (0 = pouze tento host)
    plus_count              INTEGER         NOT NULL DEFAULT 0
        CHECK (plus_count BETWEEN 0 AND 9),
    -- plus_count + 1 — celkový headcount (generated column)
    total_count             INTEGER         GENERATED ALWAYS AS (plus_count + 1) STORED,
    -- IDs zón, do kterých má host přístup
    zone_access             TEXT[]          NOT NULL DEFAULT '{}',
    -- Interní poznámka — nikdy se neposílá hostovi
    notes                   TEXT,
    -- added_by_user_id z identity.users — cross-schema, bez FK
    added_by_user_id        UUID            NOT NULL,
    confirmed_at            TIMESTAMPTZ,
    checked_in_at           TIMESTAMPTZ,
    -- checked_in_by_staff_id z identity.users — cross-schema, bez FK
    checked_in_by_staff_id  UUID,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Jeden email na event (pokud je email vyplněn)
    CONSTRAINT uq_guest_list_event_email
        UNIQUE NULLS NOT DISTINCT (event_id, email),

    -- Konzistence: checked_in musí mít checked_in_at a staff_id
    CONSTRAINT chk_guest_checked_in_consistency
        CHECK (
            (status = 'checked_in' AND checked_in_at IS NOT NULL AND checked_in_by_staff_id IS NOT NULL)
            OR (status != 'checked_in')
        ),

    -- Konzistence: confirmed musí mít confirmed_at
    CONSTRAINT chk_guest_confirmed_consistency
        CHECK (
            (status = 'confirmed' AND confirmed_at IS NOT NULL)
            OR (status != 'confirmed')
        )
);

COMMENT ON TABLE guest_list.guests IS
    'Guest list pro eventy. Jeden záznam = jeden host (+ případní doprovod dle plus_count).';
COMMENT ON COLUMN guest_list.guests.event_id IS
    'UUID akce z catalog.events; cross-schema reference — bez FK.';
COMMENT ON COLUMN guest_list.guests.guest_type IS
    'Typ hosta: complimentary, press, vip, industry, promo, other.';
COMMENT ON COLUMN guest_list.guests.plus_count IS
    'Počet dalších osob v doprovodu (0–9). Celkový headcount = plus_count + 1.';
COMMENT ON COLUMN guest_list.guests.total_count IS
    'Generovaný sloupec: plus_count + 1. Celkový počet osob pro tento záznam.';
COMMENT ON COLUMN guest_list.guests.zone_access IS
    'Pole UUID zón, do kterých má host přístup.';
COMMENT ON COLUMN guest_list.guests.added_by_user_id IS
    'UUID uživatele, který hosta přidal; cross-schema reference — bez FK.';
COMMENT ON COLUMN guest_list.guests.checked_in_by_staff_id IS
    'UUID staff člena, který provedl check-in; cross-schema reference — bez FK.';

-- Index pro vyhledávání hostů dle eventu
CREATE INDEX idx_guest_list_event_id
    ON guest_list.guests (event_id);

-- Index pro filtrování dle statusu v rámci eventu
CREATE INDEX idx_guest_list_event_status
    ON guest_list.guests (event_id, status);

-- Index pro filtrování dle typu v rámci eventu
CREATE INDEX idx_guest_list_event_type
    ON guest_list.guests (event_id, guest_type);

-- Index pro vyhledávání dle emailu (duplicate check, confirm endpoint)
CREATE INDEX idx_guest_list_email
    ON guest_list.guests (email)
    WHERE email IS NOT NULL;

-- Index pro fulltextové vyhledávání dle jména
CREATE INDEX idx_guest_list_name_trgm
    ON guest_list.guests USING gin (name gin_trgm_ops);

-- Trigger pro updated_at
CREATE TRIGGER trg_guest_list_updated_at
    BEFORE UPDATE ON guest_list.guests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- RLS: organizátor vidí hosty svých eventů (přes checkOrganizerOwnership v service)
-- Service role má plný přístup
-- =============================================================================

ALTER TABLE guest_list.guests ENABLE ROW LEVEL SECURITY;

CREATE POLICY guest_list_service_full_access ON guest_list.guests
    FOR ALL
    USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

-- =============================================================================
-- KOMENTÁŘE ke schématu
-- =============================================================================

COMMENT ON SCHEMA guest_list IS
    'Schéma pro guest listy eventů. Izolováno dle schema-per-service architektury.';

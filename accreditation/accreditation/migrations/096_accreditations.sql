-- =============================================================================
-- MIGRACE 096: Accreditations
-- Datum: 2026-04-11
-- Schema: accreditation (izolované dle schema-per-service architektury)
-- Cross-schema FK zakázané — stejná konvence jako ostatní schémata platformy
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS accreditation;

-- =============================================================================
-- accreditation.accreditations
-- Akreditace pro eventy — staff, press, umělci, VIP hosté, dobrovolníci, vendoři, organizátoři.
-- Lifecycle: requested → approved → issued → active | rejected | revoked
-- =============================================================================

CREATE TABLE accreditation.accreditations (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- event_id z catalog.events — cross-schema, bez FK
    event_id                UUID            NOT NULL,
    holder_name             TEXT            NOT NULL,
    holder_email            TEXT            NOT NULL,
    holder_phone            TEXT,
    holder_organization     TEXT,
    accreditation_type      TEXT            NOT NULL
        CHECK (accreditation_type IN ('staff', 'press', 'artist', 'vip_host', 'volunteer', 'vendor', 'organizer')),
    role_description        TEXT,
    zone_access             TEXT[]          NOT NULL DEFAULT '{}',
    valid_days              DATE[],
    status                  TEXT            NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'issued', 'active', 'rejected', 'revoked')),
    qr_code                 TEXT            NOT NULL,
    badge_color             TEXT            NOT NULL,
    photo_url               TEXT,
    -- requested_by_user_id z identity.users — cross-schema, bez FK
    requested_by_user_id    UUID            NOT NULL,
    -- approved_by_user_id z identity.users — cross-schema, bez FK
    approved_by_user_id     UUID,
    issued_at               TIMESTAMPTZ,
    approved_at             TIMESTAMPTZ,
    rejected_at             TIMESTAMPTZ,
    revoked_at              TIMESTAMPTZ,
    revocation_reason       TEXT,
    notes                   TEXT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Jeden email na event = jedna akreditace
    CONSTRAINT uq_accreditation_event_email
        UNIQUE (event_id, holder_email),

    -- Konzistence: rejected musí mít rejected_at
    CONSTRAINT chk_accreditation_rejected_consistency
        CHECK (
            (status = 'rejected' AND rejected_at IS NOT NULL)
            OR (status != 'rejected')
        ),

    -- Konzistence: revoked musí mít revoked_at
    CONSTRAINT chk_accreditation_revoked_consistency
        CHECK (
            (status = 'revoked' AND revoked_at IS NOT NULL)
            OR (status != 'revoked')
        )
);

COMMENT ON TABLE accreditation.accreditations IS
    'Akreditace pro eventy. Jeden záznam = jedna akreditace pro jednu osobu na jednu akci.';
COMMENT ON COLUMN accreditation.accreditations.event_id IS
    'UUID akce z catalog.events; cross-schema reference — bez FK.';
COMMENT ON COLUMN accreditation.accreditations.accreditation_type IS
    'Typ akreditace: staff, press, artist, vip_host, volunteer, vendor, organizer.';
COMMENT ON COLUMN accreditation.accreditations.zone_access IS
    'Pole UUID zón, do kterých má držitel přístup.';
COMMENT ON COLUMN accreditation.accreditations.valid_days IS
    'Pole dnů platnosti; NULL = celá akce. Pro vícedenní festivaly.';
COMMENT ON COLUMN accreditation.accreditations.qr_code IS
    'Deterministický QR kód: ACC-<12 znaků z UUID>. Používá se pro skenování na vstupu.';
COMMENT ON COLUMN accreditation.accreditations.badge_color IS
    'Hex barva odznaku dle typu akreditace (#f59e0b pro staff, #3b82f6 pro press atd.).';
COMMENT ON COLUMN accreditation.accreditations.requested_by_user_id IS
    'UUID uživatele, který akreditaci vyžádal; cross-schema reference — bez FK.';

-- Index pro vyhledávání akreditací dle eventu
CREATE INDEX idx_accreditation_event_id
    ON accreditation.accreditations (event_id);

-- Index pro filtrování dle statusu v rámci eventu
CREATE INDEX idx_accreditation_event_status
    ON accreditation.accreditations (event_id, status);

-- Index pro filtrování dle typu v rámci eventu
CREATE INDEX idx_accreditation_event_type
    ON accreditation.accreditations (event_id, accreditation_type);

-- Index pro vyhledávání dle QR kódu (scan endpoint)
CREATE UNIQUE INDEX idx_accreditation_qr_code
    ON accreditation.accreditations (qr_code);

-- Index pro vyhledávání dle emailu (duplicate check)
CREATE INDEX idx_accreditation_holder_email
    ON accreditation.accreditations (holder_email);

-- Index pro vyhledávání akreditací dle požadujícího uživatele
CREATE INDEX idx_accreditation_requested_by
    ON accreditation.accreditations (requested_by_user_id);

-- =============================================================================
-- RLS: organizátor vidí akreditace svých eventů (přes checkOrganizerOwnership v service)
-- Service role má plný přístup
-- =============================================================================

ALTER TABLE accreditation.accreditations ENABLE ROW LEVEL SECURITY;

CREATE POLICY accreditation_service_full_access ON accreditation.accreditations
    FOR ALL
    USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

-- =============================================================================
-- KOMENTÁŘE ke schématu
-- =============================================================================

COMMENT ON SCHEMA accreditation IS
    'Schéma pro akreditace. Izolováno dle schema-per-service architektury.';

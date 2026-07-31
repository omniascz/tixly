-- =============================================================================
-- Migration 033: Conference Exhibitor Management
-- Tables: floor_maps, booth_categories, booths, exhibitors,
--         booth_assignments, exhibitor_staff, exhibitor_sessions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Floor maps (SVG floor plan for a conference)
-- ---------------------------------------------------------------------------
CREATE TABLE conference.floor_maps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id   UUID NOT NULL REFERENCES conference.conferences(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    svg_content     TEXT,
    width_px        INT NOT NULL DEFAULT 1000,
    height_px       INT NOT NULL DEFAULT 800,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conference_id, name)
);

-- ---------------------------------------------------------------------------
-- Booth categories (groups of booths with visual color coding)
-- ---------------------------------------------------------------------------
CREATE TABLE conference.booth_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id   UUID NOT NULL REFERENCES conference.conferences(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    color           CHAR(7) NOT NULL DEFAULT '#808080',
    description     TEXT,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conference_id, name)
);

-- ---------------------------------------------------------------------------
-- Booths (individual exhibitor spaces on the floor map)
-- ---------------------------------------------------------------------------
CREATE TABLE conference.booths (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id   UUID NOT NULL REFERENCES conference.conferences(id) ON DELETE CASCADE,
    floor_map_id    UUID NOT NULL REFERENCES conference.floor_maps(id) ON DELETE CASCADE,
    category_id     UUID REFERENCES conference.booth_categories(id) ON DELETE SET NULL,
    booth_number    VARCHAR(20) NOT NULL,
    x_px            INT NOT NULL DEFAULT 0,
    y_px            INT NOT NULL DEFAULT 0,
    width_px        INT NOT NULL DEFAULT 100,
    height_px       INT NOT NULL DEFAULT 100,
    status          VARCHAR(20) NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'reserved', 'confirmed', 'blocked')),
    price_hellers   INT NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conference_id, booth_number)
);

CREATE INDEX idx_booths_conference_status ON conference.booths (conference_id, status);

-- ---------------------------------------------------------------------------
-- Exhibitors (companies participating in the conference)
-- ---------------------------------------------------------------------------
CREATE TABLE conference.exhibitors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id   UUID NOT NULL REFERENCES conference.conferences(id) ON DELETE CASCADE,
    company_name    VARCHAR(255) NOT NULL,
    description     TEXT,
    logo_url        TEXT,
    website_url     TEXT,
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(50),
    tier            VARCHAR(20) NOT NULL DEFAULT 'standard'
                        CHECK (tier IN ('platinum', 'gold', 'silver', 'bronze', 'standard')),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
    promoter_id     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conference_id, company_name)
);

CREATE INDEX idx_exhibitors_conference_tier ON conference.exhibitors (conference_id, tier);

-- ---------------------------------------------------------------------------
-- Booth assignments (one exhibitor per booth)
-- ---------------------------------------------------------------------------
CREATE TABLE conference.booth_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booth_id        UUID NOT NULL REFERENCES conference.booths(id) ON DELETE CASCADE,
    exhibitor_id    UUID NOT NULL REFERENCES conference.exhibitors(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at    TIMESTAMPTZ,
    setup_start     TIMESTAMPTZ,
    teardown_end    TIMESTAMPTZ,
    notes           TEXT,
    UNIQUE (booth_id),
    UNIQUE (exhibitor_id, booth_id)
);

CREATE INDEX idx_booth_assignments_exhibitor ON conference.booth_assignments (exhibitor_id);

-- ---------------------------------------------------------------------------
-- Exhibitor staff (personnel with badges and access tokens)
-- ---------------------------------------------------------------------------
CREATE TABLE conference.exhibitor_staff (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exhibitor_id    UUID NOT NULL REFERENCES conference.exhibitors(id) ON DELETE CASCADE,
    full_name       VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    phone           VARCHAR(50),
    role            VARCHAR(20) NOT NULL DEFAULT 'staff'
                        CHECK (role IN ('manager', 'staff', 'presenter')),
    badge_printed   BOOLEAN NOT NULL DEFAULT false,
    access_token    UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (exhibitor_id, email)
);

CREATE INDEX idx_exhibitor_staff_exhibitor ON conference.exhibitor_staff (exhibitor_id);
CREATE INDEX idx_exhibitor_staff_access_token ON conference.exhibitor_staff (access_token);

-- ---------------------------------------------------------------------------
-- Exhibitor sessions (sessions sponsored or presented by exhibitors)
-- ---------------------------------------------------------------------------
CREATE TABLE conference.exhibitor_sessions (
    exhibitor_id    UUID NOT NULL REFERENCES conference.exhibitors(id) ON DELETE CASCADE,
    session_id      UUID NOT NULL REFERENCES conference.sessions(id) ON DELETE CASCADE,
    is_sponsored    BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (exhibitor_id, session_id)
);

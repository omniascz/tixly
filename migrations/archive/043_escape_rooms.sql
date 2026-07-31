-- =============================================================================
-- MIGRACE 043: Escape Rooms — schéma venues
-- Datum: 2026-04-07
-- Schéma: venues (rozšíření stávajícího schématu)
-- Modul #90: Escape rooms, laser game, paintball — slot booking, room capacity
-- Staví nad slot engine (#166): reservations.resources, slots, bookings, booking_holds
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS venues;

-- =============================================================================
-- venues.escape_venues
-- Provozovatelé únikových místností, laser game arén, paintball hřišť
-- =============================================================================

CREATE TABLE venues.escape_venues (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    promoter_id     UUID            NOT NULL,
    name            VARCHAR(200)    NOT NULL,
    address         TEXT,
    city            VARCHAR(100),
    description     TEXT,
    website_url     TEXT,
    is_active       BOOL            NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (promoter_id, name)
);

-- =============================================================================
-- venues.escape_rooms
-- Konkrétní místnosti / arény / hřiště v rámci venue
-- resource_id odkazuje na reservations.resources (slot engine)
-- =============================================================================

CREATE TABLE venues.escape_rooms (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id                    UUID            NOT NULL
        REFERENCES venues.escape_venues (id) ON DELETE CASCADE,
    resource_id                 UUID,           -- FK reservations.resources (cross-schema, bez FK constraint)
    name                        VARCHAR(200)    NOT NULL,
    description                 TEXT,
    theme                       VARCHAR(100),   -- 'horror', 'adventure', 'mystery', 'sci-fi'
    difficulty                  VARCHAR(20)     NOT NULL DEFAULT 'medium'
        CHECK (difficulty IN ('easy', 'medium', 'hard', 'extreme')),
    min_players                 INT             NOT NULL DEFAULT 2,
    max_players                 INT             NOT NULL DEFAULT 6,
    duration_minutes            INT             NOT NULL DEFAULT 60,
    price_hellers               INT             NOT NULL,
    price_per_person_hellers    INT             NOT NULL DEFAULT 0,
    pricing_type                VARCHAR(20)     NOT NULL DEFAULT 'flat'
        CHECK (pricing_type IN ('flat', 'per_person')),
    min_age                     INT             NOT NULL DEFAULT 0,
    requires_waiver             BOOL            NOT NULL DEFAULT false,
    images                      TEXT[]          NOT NULL DEFAULT '{}',
    is_active                   BOOL            NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CHECK (max_players >= min_players),
    UNIQUE (venue_id, name)
);

-- =============================================================================
-- venues.escape_bookings
-- Rezervace konkrétní místnosti na konkrétní slot
-- slot_id → reservations.slots, booking_id → reservations.bookings (cross-schema)
-- =============================================================================

CREATE TABLE venues.escape_bookings (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id             UUID            NOT NULL
        REFERENCES venues.escape_rooms (id) ON DELETE RESTRICT,
    slot_id             UUID            NOT NULL,   -- FK reservations.slots (cross-schema)
    booking_id          UUID            NOT NULL,   -- FK reservations.bookings (cross-schema)
    player_count        INT             NOT NULL,
    contact_name        VARCHAR(200),
    contact_email       VARCHAR(200),
    contact_phone       VARCHAR(50),
    is_private          BOOL            NOT NULL DEFAULT true,
    special_requests    TEXT,
    waiver_signed_at    TIMESTAMPTZ,
    gift_voucher_code   VARCHAR(50),
    status              VARCHAR(20)     NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CHECK (player_count >= 1)
);

-- =============================================================================
-- venues.game_results
-- Výsledek hry zaznamenaný game masterem po skončení
-- Jeden výsledek na booking (UNIQUE)
-- =============================================================================

CREATE TABLE venues.game_results (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    escape_booking_id   UUID        NOT NULL UNIQUE
        REFERENCES venues.escape_bookings (id) ON DELETE CASCADE,
    escaped             BOOL        NOT NULL,
    time_taken_seconds  INT,        -- NULL pokud tým neutekl
    hints_used          INT         NOT NULL DEFAULT 0,
    notes               TEXT,       -- poznámky game mastera
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- venues.leaderboard_entries
-- Veřejný žebříček nejlepších výsledků per room
-- =============================================================================

CREATE TABLE venues.leaderboard_entries (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id             UUID        NOT NULL
        REFERENCES venues.escape_rooms (id) ON DELETE CASCADE,
    team_name           VARCHAR(100),
    player_count        INT,
    time_taken_seconds  INT         NOT NULL,
    hints_used          INT         NOT NULL DEFAULT 0,
    played_at           DATE        NOT NULL,
    is_public           BOOL        NOT NULL DEFAULT true
);

-- =============================================================================
-- Indexy
-- =============================================================================

CREATE INDEX idx_escape_rooms_venue_id
    ON venues.escape_rooms (venue_id);

CREATE INDEX idx_escape_bookings_room_id
    ON venues.escape_bookings (room_id);

CREATE INDEX idx_escape_bookings_slot_id
    ON venues.escape_bookings (slot_id);

CREATE INDEX idx_escape_bookings_status
    ON venues.escape_bookings (status);

CREATE INDEX idx_game_results_escape_booking_id
    ON venues.game_results (escape_booking_id);

CREATE INDEX idx_leaderboard_room_time
    ON venues.leaderboard_entries (room_id, time_taken_seconds);

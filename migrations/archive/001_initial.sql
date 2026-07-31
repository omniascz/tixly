-- =============================================================================
-- MIGRACE 001: Inicializační schema (base tables)
-- Datum: 2026-04-08
-- Popis: Kompletní PostgreSQL schéma pro Tixly — base tables pro všechny služby
-- =============================================================================

BEGIN;

-- =============================================================================
-- TICKETING PLATFORM — KOMPLETNÍ POSTGRESQL DATABÁZOVÉ SCHÉMA
-- Verze: 1.0 | Datum: 2026-04-03
-- Architektura: schema-per-service, cross-schema FK zakázané
-- Compliance: GDPR, EET (10 let retence účetních dokladů)
-- Ceny: INTEGER halíře (1 Kč = 100, 1 EUR = 100 centů). Nikdy FLOAT ani NUMERIC pro peníze.
-- Sync: sjednoceno s price-migration/ konvencí (2026-04-05)
-- =============================================================================

-- =============================================================================
-- ROZŠÍŘENÍ
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- SCHÉMATA
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS orders;
CREATE SCHEMA IF NOT EXISTS tickets;
CREATE SCHEMA IF NOT EXISTS resale;
CREATE SCHEMA IF NOT EXISTS audit;

-- =============================================================================
-- SDÍLENÉ FUNKCE (ve veřejném schématu)
-- =============================================================================

-- Trigger funkce pro automatickou aktualizaci updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
    'Generický trigger pro automatickou aktualizaci sloupce updated_at při každém UPDATE.';

-- =============================================================================
-- SCHÉMA: identity
-- Zodpovědnost: autentizace, uživatelé, zařízení, refresh tokeny, MFA
-- =============================================================================

CREATE TABLE identity.users (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT            NOT NULL,
    phone               TEXT,
    name                TEXT,
    password_hash       TEXT            NOT NULL,
    email_verified_at   TIMESTAMPTZ,
    phone_verified_at   TIMESTAMPTZ,
    gdpr_consent_at     TIMESTAMPTZ     NOT NULL,
    -- GDPR: soft delete — nastaví deleted_at, anonymized_at nullifikuje PII
    deleted_at          TIMESTAMPTZ,
    anonymized_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN identity.users.email IS
    'Primární kontaktní e-mail; po anonymizaci (GDPR right to erasure) nahrazen hash hodnotou.';
COMMENT ON COLUMN identity.users.phone IS
    'Volitelné telefonní číslo; po anonymizaci set na NULL.';
COMMENT ON COLUMN identity.users.password_hash IS
    'Argon2id hash hesla; nikdy plaintext.';
COMMENT ON COLUMN identity.users.gdpr_consent_at IS
    'Timestamp udělení GDPR souhlasu; povinný při registraci.';
COMMENT ON COLUMN identity.users.deleted_at IS
    'Soft delete — záznam zůstává pro referenční integritu a EET; PII odstraněno přes anonymized_at.';
COMMENT ON COLUMN identity.users.anonymized_at IS
    'Kdy proběhla GDPR anonymizace (pseudonymizace PII polí).';

-- Unikátní e-mail pouze u aktivních (neanonymizovaných) uživatelů
CREATE UNIQUE INDEX uq_identity_users_email_active
    ON identity.users (email)
    WHERE anonymized_at IS NULL;

CREATE INDEX idx_identity_users_deleted_at
    ON identity.users (deleted_at)
    WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_identity_users_created_at
    ON identity.users (created_at DESC);

CREATE TRIGGER trg_identity_users_updated_at
    BEFORE UPDATE ON identity.users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------

CREATE TABLE identity.user_devices (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    -- SHA-256 hash fingerprintu zařízení; nikdy raw fingerprint
    device_fingerprint_hash TEXT        NOT NULL,
    device_type             TEXT        NOT NULL
        CHECK (device_type IN ('web', 'ios', 'android', 'other')),
    last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN identity.user_devices.device_fingerprint_hash IS
    'SHA-256 hash kombinace UA + canvas + hardware; raw fingerprint se neukládá.';
COMMENT ON COLUMN identity.user_devices.device_type IS
    'Platforma zařízení: web, ios, android, other.';

CREATE INDEX idx_identity_user_devices_user_id
    ON identity.user_devices (user_id);

CREATE UNIQUE INDEX uq_identity_user_devices_fingerprint
    ON identity.user_devices (user_id, device_fingerprint_hash);

-- -----------------------------------------------------------------------------

CREATE TABLE identity.refresh_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash  TEXT        NOT NULL UNIQUE,
    user_id     UUID        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    device_id   UUID        NOT NULL REFERENCES identity.user_devices (id) ON DELETE CASCADE,
    -- Family tracking: celá rodina tokenů se zneplatní při detekci opakovaného použití
    family_id   UUID        NOT NULL DEFAULT gen_random_uuid(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN identity.refresh_tokens.token_hash IS
    'SHA-256 hash refresh tokenu; raw token nikdy neukládáme.';
COMMENT ON COLUMN identity.refresh_tokens.family_id IS
    'UUID rodiny tokenů; při detekci opakovaného použití (token reuse) se revokuje celá rodina — ochrana před token theft.';
COMMENT ON COLUMN identity.refresh_tokens.used_at IS
    'Kdy byl token použit k vydání nového páru; každý token lze použít právě jednou.';

CREATE INDEX idx_identity_refresh_tokens_user_id
    ON identity.refresh_tokens (user_id);

CREATE INDEX idx_identity_refresh_tokens_device_id
    ON identity.refresh_tokens (device_id);

CREATE INDEX idx_identity_refresh_tokens_family_id
    ON identity.refresh_tokens (family_id);

-- Partial index: pouze aktivní (neexpirované, nerevokované) tokeny
CREATE INDEX idx_identity_refresh_tokens_active
    ON identity.refresh_tokens (user_id, expires_at)
    WHERE revoked_at IS NULL AND used_at IS NULL;

-- -----------------------------------------------------------------------------

CREATE TABLE identity.mfa_configs (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    type             TEXT        NOT NULL CHECK (type IN ('totp', 'sms')),
    -- AES-256-GCM šifrované TOTP tajemství nebo ověřené telefonní číslo
    secret_encrypted BYTEA       NOT NULL,
    is_active        BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN identity.mfa_configs.secret_encrypted IS
    'AES-256-GCM šifrovaný TOTP secret nebo phone pro SMS OTP; IV uložen samostatně na KMS.';
COMMENT ON COLUMN identity.mfa_configs.type IS
    'Typ MFA: totp (TOTP aplikace), sms (OTP přes SMS).';

CREATE INDEX idx_identity_mfa_configs_user_id
    ON identity.mfa_configs (user_id);

-- Každý uživatel může mít max. jednu aktivní konfiguraci daného typu
CREATE UNIQUE INDEX uq_identity_mfa_configs_active_type
    ON identity.mfa_configs (user_id, type)
    WHERE is_active = TRUE;

-- =============================================================================
-- SCHÉMA: catalog
-- Zodpovědnost: místa konání, události, typy vstupenek, cenotvorba, místa k sezení
-- =============================================================================

CREATE TABLE catalog.venues (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    address         TEXT        NOT NULL,
    city            TEXT        NOT NULL,
    country         CHAR(2)     NOT NULL,
    capacity        INTEGER     NOT NULL CHECK (capacity > 0),
    -- SVG mapa sedadel pro frontend rendering
    seat_map_svg    TEXT,
    -- Strukturovaná JSON mapa sedadel (sekce, řady, sedadla)
    seat_map_json   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN catalog.venues.country IS
    'ISO 3166-1 alpha-2 kód země (např. CZ, SK, DE).';
COMMENT ON COLUMN catalog.venues.seat_map_svg IS
    'SVG reprezentace mapy sedadel pro interaktivní výběr na frontendu.';
COMMENT ON COLUMN catalog.venues.seat_map_json IS
    'Strukturovaná JSON mapa sektoru → řad → sedadel; používá seat selection service.';

CREATE INDEX idx_catalog_venues_city
    ON catalog.venues (city);

CREATE INDEX idx_catalog_venues_country
    ON catalog.venues (country);

-- -----------------------------------------------------------------------------

CREATE TABLE catalog.events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- organizer_id odkazuje na identity.users — cross-schema FK zakázané, kontrola přes API
    organizer_id    UUID        NOT NULL,
    -- venue_id odkazuje na catalog.venues — FK v rámci schématu
    venue_id        UUID        NOT NULL REFERENCES catalog.venues (id),
    title           TEXT        NOT NULL,
    description     TEXT,
    category        TEXT,
    date_start      TIMESTAMPTZ NOT NULL,
    date_end        TIMESTAMPTZ,
    status          TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
    sale_start_at   TIMESTAMPTZ,
    sale_end_at     TIMESTAMPTZ,
    resale_allowed  BOOLEAN     NOT NULL DEFAULT TRUE,
    currency        CHAR(3)         NOT NULL DEFAULT 'CZK',
    timezone        VARCHAR(50)     NOT NULL DEFAULT 'Europe/Prague',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_catalog_events_dates CHECK (date_end IS NULL OR date_end >= date_start),
    CONSTRAINT chk_catalog_events_sale_dates CHECK (
        sale_end_at IS NULL OR sale_start_at IS NULL OR sale_end_at >= sale_start_at
    )
);

COMMENT ON COLUMN catalog.events.organizer_id IS
    'UUID organizátora z identity.users; cross-schema FK záměrně vynecháno — validace přes API.';
COMMENT ON COLUMN catalog.events.status IS
    'Životní cyklus události: draft → published → (cancelled | completed).';
COMMENT ON COLUMN catalog.events.resale_allowed IS
    'Zda organizátor povoluje přeprodej vstupenek přes resale platformu.';
COMMENT ON COLUMN catalog.events.currency IS
    'ISO 4217 zdrojová měna akce (CZK, EUR, …). Pevně daná při vytvoření, nelze měnit po spuštění prodeje.';
COMMENT ON COLUMN catalog.events.timezone IS
    'IANA timezone name místa konání (Europe/Prague, Europe/Berlin, …). Používá se pro zobrazení času kupujícímu.';

CREATE INDEX idx_catalog_events_organizer_id
    ON catalog.events (organizer_id);

CREATE INDEX idx_catalog_events_venue_id
    ON catalog.events (venue_id);

CREATE INDEX idx_catalog_events_status
    ON catalog.events (status);

CREATE INDEX idx_catalog_events_date_start
    ON catalog.events (date_start DESC);

-- Partial index: pouze publikované budoucí události (nejčastější dotaz)
CREATE INDEX idx_catalog_events_published_upcoming
    ON catalog.events (date_start ASC)
    WHERE status = 'published';

CREATE TRIGGER trg_catalog_events_updated_at
    BEFORE UPDATE ON catalog.events
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------

CREATE TABLE catalog.ticket_types (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID            NOT NULL REFERENCES catalog.events (id) ON DELETE CASCADE,
    name            TEXT            NOT NULL,
    kind            TEXT            NOT NULL
        CHECK (kind IN ('standing', 'seated', 'season_pass', 'bundle')),
    base_price      INTEGER         NOT NULL CHECK (base_price >= 0), -- halíře (1 Kč = 100)
    total_qty       INTEGER         NOT NULL CHECK (total_qty > 0),
    remaining_qty   INTEGER         NOT NULL CHECK (remaining_qty >= 0),
    max_per_user    INTEGER         CHECK (max_per_user > 0),
    zone            TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_catalog_ticket_types_remaining
        CHECK (remaining_qty <= total_qty)
);

COMMENT ON COLUMN catalog.ticket_types.kind IS
    'Typ vstupenky: standing (stání), seated (sezení), season_pass (sezónní), bundle (balíček).';
COMMENT ON COLUMN catalog.ticket_types.remaining_qty IS
    'Aktuální počet dostupných vstupenek; dekrementován atomicky při rezervaci objednávky.';
COMMENT ON COLUMN catalog.ticket_types.max_per_user IS
    'Maximální počet vstupenek tohoto typu pro jednoho uživatele; NULL = bez omezení.';
COMMENT ON COLUMN catalog.ticket_types.zone IS
    'Označení zóny/sektoru (A, B, VIP, Pit, …); NULL pro celoplošné vstupenky.';

CREATE INDEX idx_catalog_ticket_types_event_id
    ON catalog.ticket_types (event_id);

-- Partial index: typy s dostupnými vstupenkami
CREATE INDEX idx_catalog_ticket_types_available
    ON catalog.ticket_types (event_id, remaining_qty)
    WHERE remaining_qty > 0;

-- -----------------------------------------------------------------------------

CREATE TABLE catalog.pricing_rules (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_type_id      UUID            NOT NULL REFERENCES catalog.ticket_types (id) ON DELETE CASCADE,
    phase               TEXT            NOT NULL
        CHECK (phase IN ('early_bird', 'regular', 'late', 'door')),
    price               INTEGER         NOT NULL CHECK (price >= 0), -- halíře (1 Kč = 100)
    -- Minimální počet zbývajících vstupenek pro aktivaci fáze
    threshold_qty       INTEGER,
    -- Datum aktivace fáze
    threshold_date      TIMESTAMPTZ,
    -- Dynamická cenotvorba: koeficient poptávky (např. 0.8–1.5)
    demand_factor_min   NUMERIC(4, 2)   NOT NULL DEFAULT 1.0
        CHECK (demand_factor_min > 0),
    demand_factor_max   NUMERIC(4, 2)   NOT NULL DEFAULT 1.0
        CHECK (demand_factor_max >= demand_factor_min),
    -- Nižší číslo = vyšší priorita vyhodnocení pravidla
    priority            INTEGER         NOT NULL DEFAULT 0,
    active              BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN catalog.pricing_rules.phase IS
    'Prodejní fáze: early_bird, regular, late, door.';
COMMENT ON COLUMN catalog.pricing_rules.threshold_qty IS
    'Pravidlo se aktivuje, pokud remaining_qty klesne pod tuto hodnotu; NULL = ignorováno.';
COMMENT ON COLUMN catalog.pricing_rules.threshold_date IS
    'Pravidlo se aktivuje po tomto datu; NULL = ignorováno.';
COMMENT ON COLUMN catalog.pricing_rules.demand_factor_min IS
    'Minimální multiplikátor ceny při nízkém zájmu (dynamická cenotvorba).';
COMMENT ON COLUMN catalog.pricing_rules.demand_factor_max IS
    'Maximální multiplikátor ceny při vysokém zájmu (dynamická cenotvorba).';
COMMENT ON COLUMN catalog.pricing_rules.priority IS
    'Priorita pravidla; nižší číslo = vyšší priorita. Vyhodnocuje pricing engine.';

CREATE INDEX idx_catalog_pricing_rules_ticket_type_id
    ON catalog.pricing_rules (ticket_type_id);

-- Partial index: pouze aktivní pravidla
CREATE INDEX idx_catalog_pricing_rules_active
    ON catalog.pricing_rules (ticket_type_id, priority ASC)
    WHERE active = TRUE;

-- -----------------------------------------------------------------------------

CREATE TABLE catalog.seats (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id            UUID        NOT NULL REFERENCES catalog.venues (id) ON DELETE CASCADE,
    section             TEXT        NOT NULL,
    row                 TEXT        NOT NULL,
    seat_number         TEXT        NOT NULL,
    zone                TEXT,
    status              TEXT        NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'locked', 'sold', 'blocked')),
    -- locked_by_order_id: UUID objednávky z orders.orders — cross-schema, bez FK
    locked_by_order_id  UUID,
    locked_until        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_catalog_seats_venue_position
        UNIQUE (venue_id, section, row, seat_number),
    CONSTRAINT chk_catalog_seats_lock_consistency CHECK (
        (status = 'locked' AND locked_by_order_id IS NOT NULL AND locked_until IS NOT NULL)
        OR (status != 'locked')
    )
);

COMMENT ON COLUMN catalog.seats.status IS
    'Stav sedadla: available, locked (dočasně rezervováno), sold, blocked (nedostupné).';
COMMENT ON COLUMN catalog.seats.locked_by_order_id IS
    'UUID objednávky z orders.orders; cross-schema reference — bez FK, kontrola přes event/saga.';
COMMENT ON COLUMN catalog.seats.locked_until IS
    'Platnost zámku; po vypršení se sedadlo automaticky uvolní (job nebo trigger).';

CREATE INDEX idx_catalog_seats_venue_id
    ON catalog.seats (venue_id);

CREATE INDEX idx_catalog_seats_status
    ON catalog.seats (status);

-- Partial index: pouze uzamčená sedadla (pro cleanup joby)
CREATE INDEX idx_catalog_seats_locked
    ON catalog.seats (locked_until ASC)
    WHERE status = 'locked';

-- Partial index: dostupná sedadla (nejčastější dotaz při výběru)
CREATE INDEX idx_catalog_seats_available
    ON catalog.seats (venue_id, zone)
    WHERE status = 'available';

-- =============================================================================
-- SCHÉMA: orders
-- Zodpovědnost: objednávky, položky, platební události
-- EET compliance: záznamy nesmí být smazány (10 let retence)
-- =============================================================================

CREATE TABLE orders.orders (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- user_id z identity.users — cross-schema, bez FK
    user_id             UUID            NOT NULL,
    status              TEXT            NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded', 'expired')),
    total_amount        INTEGER         NOT NULL CHECK (total_amount >= 0), -- halíře (1 Kč = 100)
    currency            CHAR(3)         NOT NULL DEFAULT 'CZK',
    locale              VARCHAR(10)     NOT NULL DEFAULT 'cs',
    -- GoPay identifikátory platby
    gopay_payment_id    TEXT,
    gopay_order_id      TEXT,
    -- Idempotency key pro ochranu před duplicitními objednávkami
    idempotency_key     UUID            NOT NULL DEFAULT gen_random_uuid(),
    expires_at          TIMESTAMPTZ     NOT NULL,
    paid_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_orders_idempotency_key UNIQUE (idempotency_key)
);

COMMENT ON COLUMN orders.orders.user_id IS
    'UUID uživatele z identity.users; cross-schema reference — bez FK.';
COMMENT ON COLUMN orders.orders.currency IS
    'ISO 4217 kód měny (CZK, EUR, …).';
COMMENT ON COLUMN orders.orders.locale IS
    'Locale kupujícího při nákupu (cs, en, de, …). Používá se pro generování emailů a PDF vstupenek ve správném jazyce.';
COMMENT ON COLUMN orders.orders.gopay_payment_id IS
    'Interní ID platby v GoPay systému.';
COMMENT ON COLUMN orders.orders.gopay_order_id IS
    'ID objednávky v GoPay systému pro párování webhooků.';
COMMENT ON COLUMN orders.orders.idempotency_key IS
    'UUID pro idempotentní zpracování; zabraňuje duplicitním objednávkám při síťových chybách.';
COMMENT ON COLUMN orders.orders.expires_at IS
    'Deadline pro dokončení platby; po vypršení přechází objednávka do stavu expired.';

CREATE INDEX idx_orders_orders_user_id
    ON orders.orders (user_id);

CREATE INDEX idx_orders_orders_status
    ON orders.orders (status);

CREATE INDEX idx_orders_orders_gopay_payment_id
    ON orders.orders (gopay_payment_id)
    WHERE gopay_payment_id IS NOT NULL;

CREATE INDEX idx_orders_orders_created_at
    ON orders.orders (created_at DESC);

-- Partial index: čekající objednávky s blížícím se vypršením (pro cleanup job)
CREATE INDEX idx_orders_orders_pending_expires
    ON orders.orders (expires_at ASC)
    WHERE status = 'pending';

CREATE TRIGGER trg_orders_orders_updated_at
    BEFORE UPDATE ON orders.orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: uživatel vidí pouze své objednávky
ALTER TABLE orders.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_user_isolation ON orders.orders
    FOR ALL
    USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE POLICY orders_service_full_access ON orders.orders
    FOR ALL
    USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

-- -----------------------------------------------------------------------------

CREATE TABLE orders.order_items (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID            NOT NULL REFERENCES orders.orders (id) ON DELETE RESTRICT,
    -- ticket_type_id z catalog.ticket_types — cross-schema, bez FK
    ticket_type_id  UUID            NOT NULL,
    -- seat_id z catalog.seats — cross-schema, bez FK; NULL pro stání
    seat_id         UUID,
    quantity        INTEGER         NOT NULL CHECK (quantity > 0),
    unit_price      INTEGER         NOT NULL CHECK (unit_price >= 0), -- halíře (1 Kč = 100)
    total_price     INTEGER         NOT NULL CHECK (total_price >= 0), -- halíře (1 Kč = 100)
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_orders_order_items_total
        CHECK (total_price = unit_price * quantity)
);

COMMENT ON COLUMN orders.order_items.ticket_type_id IS
    'UUID typu vstupenky z catalog.ticket_types; cross-schema reference — bez FK.';
COMMENT ON COLUMN orders.order_items.seat_id IS
    'UUID sedadla z catalog.seats; NULL pro vstupenky bez přiřazeného místa (stání).';
COMMENT ON COLUMN orders.order_items.total_price IS
    'Musí se rovnat unit_price × quantity; ověřeno CHECK constraint.';

CREATE INDEX idx_orders_order_items_order_id
    ON orders.order_items (order_id);

CREATE INDEX idx_orders_order_items_ticket_type_id
    ON orders.order_items (ticket_type_id);

-- -----------------------------------------------------------------------------

CREATE TABLE orders.payment_events (
    id              BIGSERIAL       PRIMARY KEY,
    order_id        UUID            NOT NULL REFERENCES orders.orders (id) ON DELETE RESTRICT,
    event_type      TEXT            NOT NULL,
    gopay_status    TEXT,
    amount          INTEGER, -- halíře (1 Kč = 100)
    -- Surový webhook payload z GoPay — pro EET audit trail
    raw_payload     JSONB           NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE orders.payment_events IS
    'Immutable log platebních událostí; záznamy se nesmí mazat (EET retence 10 let).';
COMMENT ON COLUMN orders.payment_events.event_type IS
    'Typ události (payment_created, payment_paid, payment_refunded, webhook_received, …).';
COMMENT ON COLUMN orders.payment_events.raw_payload IS
    'Kompletní surový JSON payload z GoPay webhook notifikace; nemodifikovaný.';

CREATE INDEX idx_orders_payment_events_order_id
    ON orders.payment_events (order_id);

CREATE INDEX idx_orders_payment_events_created_at
    ON orders.payment_events (created_at DESC);

CREATE INDEX idx_orders_payment_events_gopay_status
    ON orders.payment_events (gopay_status)
    WHERE gopay_status IS NOT NULL;

-- =============================================================================
-- SCHÉMA: tickets
-- Zodpovědnost: vydané vstupenky, převody, záznamy skenování
-- =============================================================================

CREATE TABLE tickets.tickets (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- order_id z orders.orders — cross-schema, bez FK
    order_id                UUID            NOT NULL,
    -- ticket_type_id z catalog.ticket_types — cross-schema, bez FK
    ticket_type_id          UUID            NOT NULL,
    -- owner_id: aktuální vlastník (mění se při převodu)
    owner_id                UUID            NOT NULL,
    -- original_owner_id: první kupující (neměnný, pro audit)
    original_owner_id       UUID            NOT NULL,
    -- seat_id z catalog.seats — cross-schema, bez FK; NULL pro stání
    seat_id                 UUID,
    status                  TEXT            NOT NULL DEFAULT 'valid'
        CHECK (status IN ('valid', 'used', 'revoked', 'transferred', 'resale_listed')),
    -- AES-256-GCM šifrovaný TOTP secret pro dynamický QR kód
    totp_secret_encrypted   BYTEA           NOT NULL,
    -- IV (initialization vector) pro AES-256-GCM dešifrování
    totp_secret_iv          BYTEA           NOT NULL,
    -- device_binding_id z identity.user_devices — cross-schema, bez FK
    device_binding_id       UUID,
    original_price          INTEGER         NOT NULL CHECK (original_price >= 0), -- halíře (1 Kč = 100)
    transfer_count          INTEGER         NOT NULL DEFAULT 0 CHECK (transfer_count >= 0),
    claimed_at              TIMESTAMPTZ,
    used_at                 TIMESTAMPTZ,
    revoked_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN tickets.tickets.owner_id IS
    'UUID aktuálního vlastníka vstupenky; aktualizuje se při každém převodu.';
COMMENT ON COLUMN tickets.tickets.original_owner_id IS
    'UUID prvního kupujícího; neměnný audit záznam z identity.users.';
COMMENT ON COLUMN tickets.tickets.totp_secret_encrypted IS
    'AES-256-GCM šifrovaný TOTP secret pro generování dynamického QR kódu (30s interval).';
COMMENT ON COLUMN tickets.tickets.totp_secret_iv IS
    'Initialization vector (96 bitů) pro AES-256-GCM dešifrování TOTP secretu.';
COMMENT ON COLUMN tickets.tickets.device_binding_id IS
    'UUID zařízení z identity.user_devices; pokud nastaveno, vstupenku lze zobrazit pouze na tomto zařízení.';
COMMENT ON COLUMN tickets.tickets.original_price IS
    'Původní nákupní cena; používá resale service pro enforce face-value pravidla.';
COMMENT ON COLUMN tickets.tickets.transfer_count IS
    'Počet provedených převodů; limit může nastavit organizátor.';
COMMENT ON COLUMN tickets.tickets.claimed_at IS
    'Kdy si vlastník poprvé zobrazil vstupenku (aktivace device binding).';

CREATE INDEX idx_tickets_tickets_order_id
    ON tickets.tickets (order_id);

CREATE INDEX idx_tickets_tickets_owner_id
    ON tickets.tickets (owner_id);

CREATE INDEX idx_tickets_tickets_original_owner_id
    ON tickets.tickets (original_owner_id);

CREATE INDEX idx_tickets_tickets_ticket_type_id
    ON tickets.tickets (ticket_type_id);

CREATE INDEX idx_tickets_tickets_status
    ON tickets.tickets (status);

CREATE INDEX idx_tickets_tickets_created_at
    ON tickets.tickets (created_at DESC);

-- Partial index: pouze platné vstupenky (nejčastější dotaz při skenování)
CREATE INDEX idx_tickets_tickets_valid
    ON tickets.tickets (owner_id)
    WHERE status = 'valid';

-- Partial index: vstupenky vystavené k přeprodeji
CREATE INDEX idx_tickets_tickets_resale_listed
    ON tickets.tickets (ticket_type_id)
    WHERE status = 'resale_listed';

CREATE TRIGGER trg_tickets_tickets_updated_at
    BEFORE UPDATE ON tickets.tickets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: uživatel vidí pouze své vstupenky
ALTER TABLE tickets.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tickets_owner_isolation ON tickets.tickets
    FOR ALL
    USING (owner_id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE POLICY tickets_service_full_access ON tickets.tickets
    FOR ALL
    USING (current_setting('app.role', TRUE) IN ('service', 'admin', 'gate'));

-- -----------------------------------------------------------------------------

CREATE TABLE tickets.ticket_transfers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id       UUID        NOT NULL REFERENCES tickets.tickets (id) ON DELETE RESTRICT,
    -- from_user_id / to_user_id z identity.users — cross-schema, bez FK
    from_user_id    UUID        NOT NULL,
    to_user_id      UUID        NOT NULL,
    transfer_type   TEXT        NOT NULL CHECK (transfer_type IN ('resale', 'gift')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ticket_transfers_different_users
        CHECK (from_user_id != to_user_id)
);

COMMENT ON COLUMN tickets.ticket_transfers.transfer_type IS
    'Typ převodu: resale (prodej přes resale platformu s escrow), gift (darování, bez platby).';

CREATE INDEX idx_tickets_ticket_transfers_ticket_id
    ON tickets.ticket_transfers (ticket_id);

CREATE INDEX idx_tickets_ticket_transfers_from_user_id
    ON tickets.ticket_transfers (from_user_id);

CREATE INDEX idx_tickets_ticket_transfers_to_user_id
    ON tickets.ticket_transfers (to_user_id);

CREATE INDEX idx_tickets_ticket_transfers_created_at
    ON tickets.ticket_transfers (created_at DESC);

-- -----------------------------------------------------------------------------

CREATE TABLE tickets.scan_logs (
    id                      BIGSERIAL   PRIMARY KEY,
    ticket_id               UUID        NOT NULL REFERENCES tickets.tickets (id) ON DELETE RESTRICT,
    -- event_id z catalog.events — cross-schema, bez FK
    event_id                UUID        NOT NULL,
    -- scanned_by_device_id z identity.user_devices — cross-schema, bez FK
    scanned_by_device_id    UUID        NOT NULL,
    scan_result             TEXT        NOT NULL
        CHECK (scan_result IN ('ok', 'duplicate', 'revoked', 'invalid', 'expired')),
    scanned_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- override_by: UUID personálu, který přepsal výsledek skenování
    override_by             UUID,
    override_reason         TEXT
);

COMMENT ON TABLE tickets.scan_logs IS
    'Immutable log skenování vstupenek na vstupní bráně; záznamy se nesmí mazat.';
COMMENT ON COLUMN tickets.scan_logs.scan_result IS
    'Výsledek skenování: ok, duplicate (druhý sken), revoked, invalid, expired.';
COMMENT ON COLUMN tickets.scan_logs.scanned_by_device_id IS
    'UUID skenovacího zařízení (gate device) z identity.user_devices.';
COMMENT ON COLUMN tickets.scan_logs.override_by IS
    'UUID personálu, který manuálně přepsal výsledek (např. povolil vstup i přes duplicate).';
COMMENT ON COLUMN tickets.scan_logs.override_reason IS
    'Povinný text při override; auditní záznam důvodu přepsání.';

CREATE INDEX idx_tickets_scan_logs_ticket_id
    ON tickets.scan_logs (ticket_id);

CREATE INDEX idx_tickets_scan_logs_event_id
    ON tickets.scan_logs (event_id);

CREATE INDEX idx_tickets_scan_logs_scanned_at
    ON tickets.scan_logs (scanned_at DESC);

-- Partial index: pouze neúspěšné skeny (pro bezpečnostní monitoring)
CREATE INDEX idx_tickets_scan_logs_failed
    ON tickets.scan_logs (event_id, scanned_at DESC)
    WHERE scan_result != 'ok';

-- =============================================================================
-- SCHÉMA: resale
-- Zodpovědnost: přeprodejní inzeráty, watchlist, escrow
-- Face-value enforcement: ask_price ≤ original_price
-- =============================================================================

CREATE TABLE resale.resale_listings (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ticket_id z tickets.tickets — cross-schema, bez FK
    ticket_id           UUID            NOT NULL,
    -- seller_id / buyer_id z identity.users — cross-schema, bez FK
    seller_id           UUID            NOT NULL,
    buyer_id            UUID,
    ask_price           INTEGER         NOT NULL CHECK (ask_price >= 0), -- halíře (1 Kč = 100)
    original_price      INTEGER         NOT NULL CHECK (original_price >= 0), -- halíře (1 Kč = 100)
    status              TEXT            NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
    escrow_status       TEXT            NOT NULL DEFAULT 'none'
        CHECK (escrow_status IN ('none', 'held', 'released', 'refunded')),
    -- GoPay escrow platba ID
    escrow_gopay_id     TEXT,
    listed_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ,
    sold_at             TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,

    -- KLÍČOVÝ CONSTRAINT: face-value enforcement — nelze prodat dráže než původní cena
    CONSTRAINT chk_resale_face_value_enforcement
        CHECK (ask_price <= original_price),

    -- Logická konzistence stavů
    CONSTRAINT chk_resale_sold_consistency
        CHECK ((status = 'sold') = (buyer_id IS NOT NULL AND sold_at IS NOT NULL)),

    CONSTRAINT chk_resale_cancelled_consistency
        CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

COMMENT ON TABLE resale.resale_listings IS
    'Přeprodejní inzeráty; ask_price nesmí překročit original_price (face-value enforcement).';
COMMENT ON COLUMN resale.resale_listings.ask_price IS
    'Požadovaná cena prodejce; CHECK constraint zaručuje ask_price ≤ original_price.';
COMMENT ON COLUMN resale.resale_listings.original_price IS
    'Kopie původní ceny z tickets.tickets; denormalizováno pro CHECK constraint bez cross-schema FK.';
COMMENT ON COLUMN resale.resale_listings.escrow_status IS
    'Stav escrow: none, held (platba zadržena), released (uvolněno prodejci), refunded (vráceno kupujícímu).';
COMMENT ON COLUMN resale.resale_listings.escrow_gopay_id IS
    'ID escrow platby v GoPay; prostředky jsou zadrženy do potvrzení převodu vstupenky.';

CREATE INDEX idx_resale_listings_ticket_id
    ON resale.resale_listings (ticket_id);

CREATE INDEX idx_resale_listings_seller_id
    ON resale.resale_listings (seller_id);

CREATE INDEX idx_resale_listings_buyer_id
    ON resale.resale_listings (buyer_id)
    WHERE buyer_id IS NOT NULL;

CREATE INDEX idx_resale_listings_listed_at
    ON resale.resale_listings (listed_at DESC);

-- Partial index: pouze aktivní inzeráty (nejčastější dotaz kupujících)
CREATE INDEX idx_resale_listings_active
    ON resale.resale_listings (ask_price ASC, listed_at DESC)
    WHERE status = 'active';

-- Partial index: inzeráty s blížící se expirací (pro cleanup job)
CREATE INDEX idx_resale_listings_expiring
    ON resale.resale_listings (expires_at ASC)
    WHERE status = 'active' AND expires_at IS NOT NULL;

-- RLS: uživatel vidí aktivní inzeráty nebo své vlastní
ALTER TABLE resale.resale_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY resale_listings_buyer_view ON resale.resale_listings
    FOR SELECT
    USING (
        status = 'active'
        OR seller_id = current_setting('app.current_user_id', TRUE)::UUID
        OR buyer_id = current_setting('app.current_user_id', TRUE)::UUID
    );

CREATE POLICY resale_listings_seller_modify ON resale.resale_listings
    FOR ALL
    USING (seller_id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE POLICY resale_listings_service_full_access ON resale.resale_listings
    FOR ALL
    USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

-- -----------------------------------------------------------------------------

CREATE TABLE resale.resale_watchlist (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- user_id z identity.users — cross-schema, bez FK
    user_id     UUID            NOT NULL,
    -- event_id z catalog.events — cross-schema, bez FK
    event_id    UUID            NOT NULL,
    max_price   INTEGER         CHECK (max_price > 0), -- halíře (1 Kč = 100)
    zone        TEXT,
    notified_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_resale_watchlist_user_event
        UNIQUE (user_id, event_id)
);

COMMENT ON COLUMN resale.resale_watchlist.max_price IS
    'Maximální cena, za kterou má uživatel zájem; NULL = jakákoliv cena.';
COMMENT ON COLUMN resale.resale_watchlist.zone IS
    'Preferovaná zóna/sektor; NULL = jakákoliv zóna.';
COMMENT ON COLUMN resale.resale_watchlist.notified_at IS
    'Kdy byla uživateli naposledy odeslána notifikace o dostupné vstupence.';

CREATE INDEX idx_resale_watchlist_user_id
    ON resale.resale_watchlist (user_id);

CREATE INDEX idx_resale_watchlist_event_id
    ON resale.resale_watchlist (event_id);

-- Partial index: watchlist záznamy čekající na notifikaci
CREATE INDEX idx_resale_watchlist_pending_notification
    ON resale.resale_watchlist (event_id, max_price)
    WHERE notified_at IS NULL;

-- =============================================================================
-- SCHÉMA: audit
-- Zodpovědnost: centrální audit log všech změn (GDPR, compliance)
-- EET: záznamy platebních transakcí retence 10 let
-- =============================================================================

CREATE TABLE audit.audit_log (
    id          BIGSERIAL   PRIMARY KEY,
    schema_name TEXT        NOT NULL,
    table_name  TEXT        NOT NULL,
    -- UUID nebo jiný identifikátor záznamu (jako text pro flexibilitu)
    record_id   TEXT        NOT NULL,
    action      TEXT        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    -- actor_id z identity.users nebo systémový — cross-schema, bez FK
    actor_id    UUID,
    actor_type  TEXT        NOT NULL DEFAULT 'system'
        CHECK (actor_type IN ('user', 'system', 'admin', 'gate')),
    old_values  JSONB,
    new_values  JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit.audit_log IS
    'Immutable centrální audit log; záznamy se nesmí mazat, mazání je technicky zakázáno via revoke.';
COMMENT ON COLUMN audit.audit_log.record_id IS
    'Primární klíč auditovaného záznamu jako text; UUID nebo BIGINT dle tabulky.';
COMMENT ON COLUMN audit.audit_log.actor_id IS
    'UUID aktéra změny z identity.users; NULL pro systémové operace.';
COMMENT ON COLUMN audit.audit_log.actor_type IS
    'Typ aktéra: user (přihlášený uživatel), system (automatický job), admin (backoffice), gate (brána).';
COMMENT ON COLUMN audit.audit_log.old_values IS
    'JSON snapshot záznamu před změnou; NULL pro INSERT.';
COMMENT ON COLUMN audit.audit_log.new_values IS
    'JSON snapshot záznamu po změně; NULL pro DELETE.';
COMMENT ON COLUMN audit.audit_log.ip_address IS
    'IP adresa aktéra; NULL pro systémové operace bez HTTP kontextu.';

CREATE INDEX idx_audit_log_schema_table
    ON audit.audit_log (schema_name, table_name);

CREATE INDEX idx_audit_log_record
    ON audit.audit_log (schema_name, table_name, record_id);

CREATE INDEX idx_audit_log_actor_id
    ON audit.audit_log (actor_id)
    WHERE actor_id IS NOT NULL;

CREATE INDEX idx_audit_log_created_at
    ON audit.audit_log (created_at DESC);

CREATE INDEX idx_audit_log_action
    ON audit.audit_log (action, created_at DESC);

-- =============================================================================
-- AUDIT TRIGGER FUNKCE
-- Automatické logování změn na klíčových tabulkách
-- =============================================================================

CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_record_id TEXT;
    v_old_values JSONB;
    v_new_values JSONB;
    v_actor_id   UUID;
    v_actor_type TEXT;
    v_ip_address INET;
BEGIN
    -- Načtení kontextu z aplikační session proměnné
    BEGIN
        v_actor_id   := current_setting('app.current_user_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_actor_id   := NULL;
    END;

    v_actor_type := COALESCE(current_setting('app.role', TRUE), 'system');

    BEGIN
        v_ip_address := current_setting('app.client_ip', TRUE)::INET;
    EXCEPTION WHEN OTHERS THEN
        v_ip_address := NULL;
    END;

    IF TG_OP = 'INSERT' THEN
        v_record_id  := NEW.id::TEXT;
        v_old_values := NULL;
        v_new_values := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_record_id  := NEW.id::TEXT;
        v_old_values := to_jsonb(OLD);
        v_new_values := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_record_id  := OLD.id::TEXT;
        v_old_values := to_jsonb(OLD);
        v_new_values := NULL;
    END IF;

    INSERT INTO audit.audit_log (
        schema_name,
        table_name,
        record_id,
        action,
        actor_id,
        actor_type,
        old_values,
        new_values,
        ip_address
    ) VALUES (
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        v_record_id,
        TG_OP,
        v_actor_id,
        v_actor_type,
        v_old_values,
        v_new_values,
        v_ip_address
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.audit_trigger_func() IS
    'Generická AFTER trigger funkce pro zápis do audit.audit_log. Čte kontext z app.current_user_id, app.role, app.client_ip session proměnných.';

-- Audit trigger na tickets.tickets
CREATE TRIGGER trg_audit_tickets
    AFTER INSERT OR UPDATE OR DELETE ON tickets.tickets
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Audit trigger na resale.resale_listings
CREATE TRIGGER trg_audit_resale_listings
    AFTER INSERT OR UPDATE OR DELETE ON resale.resale_listings
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Audit trigger na orders.orders (pro EET compliance)
CREATE TRIGGER trg_audit_orders
    AFTER INSERT OR UPDATE OR DELETE ON orders.orders
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- =============================================================================
-- OCHRANA AUDIT LOGU
-- Zakázání DELETE a UPDATE na audit_log (immutable log)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit.audit_log je immutable — DELETE a UPDATE jsou zakázány (compliance).';
END;
$$;

CREATE TRIGGER trg_audit_log_no_delete
    BEFORE DELETE ON audit.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();

CREATE TRIGGER trg_audit_log_no_update
    BEFORE UPDATE ON audit.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();

-- =============================================================================
-- OCHRANA PAYMENT EVENTS (immutable — EET)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.payment_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'orders.payment_events je immutable — DELETE a UPDATE jsou zakázány (EET compliance, retence 10 let).';
END;
$$;

CREATE TRIGGER trg_payment_events_no_delete
    BEFORE DELETE ON orders.payment_events
    FOR EACH ROW EXECUTE FUNCTION public.payment_events_immutable();

CREATE TRIGGER trg_payment_events_no_update
    BEFORE UPDATE ON orders.payment_events
    FOR EACH ROW EXECUTE FUNCTION public.payment_events_immutable();

-- =============================================================================
-- OCHRANA SCAN LOGS (immutable — bezpečnostní audit)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.scan_logs_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'tickets.scan_logs je immutable — DELETE a UPDATE jsou zakázány (bezpečnostní audit).';
END;
$$;

CREATE TRIGGER trg_scan_logs_no_delete
    BEFORE DELETE ON tickets.scan_logs
    FOR EACH ROW EXECUTE FUNCTION public.scan_logs_immutable();

CREATE TRIGGER trg_scan_logs_no_update
    BEFORE UPDATE ON tickets.scan_logs
    FOR EACH ROW EXECUTE FUNCTION public.scan_logs_immutable();

-- =============================================================================
-- GDPR: ANONYMIZACE FUNKCE
-- Pseudonymizace PII dat při uplatnění práva na výmaz
-- =============================================================================

CREATE OR REPLACE FUNCTION identity.anonymize_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_anon_suffix TEXT := substr(md5(p_user_id::TEXT), 1, 8);
BEGIN
    -- Nahrazení PII hash hodnotami (pseudonymizace)
    UPDATE identity.users SET
        email           = 'anonymized_' || v_anon_suffix || '@deleted.invalid',
        phone           = NULL,
        name            = 'Anonymized User ' || v_anon_suffix,
        password_hash   = 'ANONYMIZED',
        deleted_at      = COALESCE(deleted_at, NOW()),
        anonymized_at   = NOW()
    WHERE id = p_user_id
      AND anonymized_at IS NULL;

    -- Revokace všech aktivních refresh tokenů
    UPDATE identity.refresh_tokens SET
        revoked_at = NOW()
    WHERE user_id = p_user_id
      AND revoked_at IS NULL;

    -- Deaktivace MFA konfigurací
    UPDATE identity.mfa_configs SET
        is_active = FALSE
    WHERE user_id = p_user_id;
END;
$$;

COMMENT ON FUNCTION identity.anonymize_user(UUID) IS
    'GDPR right to erasure: pseudonymizuje PII uživatele, revokuje tokeny a deaktivuje MFA. Auditní záznamy a transakční data zůstávají pro EET compliance.';

-- =============================================================================
-- OVĚŘENÍ MIGRACE
-- Kontrola existenci klíčových tabulek
-- =============================================================================

DO $$
DECLARE
    v_table_count INT := 0;
BEGIN
    -- Ověření existenci klíčových 5 tabulek
    SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
    WHERE table_schema IN ('identity', 'catalog', 'orders', 'tickets', 'resale')
      AND table_name IN ('users', 'events', 'orders', 'tickets', 'resale_listings');

    IF v_table_count >= 5 THEN
        RAISE NOTICE 'Migrace 001 úspěšně ověřena.';
    ELSE
        RAISE EXCEPTION 'Migrace 001 selhala: chybí některé klíčové tabulky (nalezeno: %)', v_table_count;
    END IF;
END $$;

COMMIT;

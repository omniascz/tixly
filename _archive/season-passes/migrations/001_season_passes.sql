-- =============================================================================
-- MIGRACE 001: Season Passes — schéma passes
-- Datum: 2026-04-03
-- Schéma: passes (nové, izolované dle schema-per-service architektury)
-- Cross-schema FK zakázané — stejná konvence jako ostatní schémata platformy
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS passes;

-- =============================================================================
-- passes.season_pass_types
-- Konfigurace produktů permanentek definovaná pořadatelem.
-- Jeden záznam = jeden produkt (např. "Sezónní karta 2026", "10-vstupový Flex pass")
-- =============================================================================

CREATE TABLE passes.season_pass_types (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- organizer_id z identity.users — cross-schema, bez FK
    organizer_id            UUID            NOT NULL,
    name                    TEXT            NOT NULL,
    kind                    TEXT            NOT NULL
        CHECK (kind IN ('season', 'flex')),
    billing_cycle           TEXT            NOT NULL
        CHECK (billing_cycle IN ('monthly', 'annual', 'one_time')),
    price                   NUMERIC(10, 2)  NOT NULL CHECK (price >= 0),
    -- Pro flex passy: celkový počet vstupů zahrnutých v pasu; NULL pro season
    total_uses              INTEGER         CHECK (total_uses > 0),
    -- Délka platnosti pasu v celých kalendářních měsících
    valid_months            INTEGER         NOT NULL CHECK (valid_months > 0),
    -- Benefity: % sleva na doplňkové vstupenky
    addon_discount_percent  INTEGER         NOT NULL DEFAULT 0
        CHECK (addon_discount_percent BETWEEN 0 AND 100),
    -- Benefity: kolik hodin před veřejným prodejem má držitel přístup
    early_access_hours      INTEGER         NOT NULL DEFAULT 0
        CHECK (early_access_hours >= 0),
    -- Benefity: počet host vstupů v ceně
    guest_passes            INTEGER         NOT NULL DEFAULT 0
        CHECK (guest_passes >= 0),
    active                  BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_passes_pass_type_flex_uses
        CHECK (kind != 'flex' OR total_uses IS NOT NULL)
);

COMMENT ON TABLE passes.season_pass_types IS
    'Produkty permanentek definované pořadatelem. Jeden záznam = jeden prodejní produkt.';
COMMENT ON COLUMN passes.season_pass_types.organizer_id IS
    'UUID organizátora z identity.users; cross-schema reference — bez FK.';
COMMENT ON COLUMN passes.season_pass_types.kind IS
    'season = přístup na všechny akce v sezóně; flex = fixní počet vstupů dle výběru.';
COMMENT ON COLUMN passes.season_pass_types.billing_cycle IS
    'monthly = měsíční opakovaná platba; annual = roční; one_time = jednorázová.';
COMMENT ON COLUMN passes.season_pass_types.total_uses IS
    'Celkový počet vstupů pro flex pass; NULL pro season pass (neomezené akce v sezóně).';
COMMENT ON COLUMN passes.season_pass_types.valid_months IS
    'Délka platnosti v kalendářních měsících od data nákupu.';
COMMENT ON COLUMN passes.season_pass_types.addon_discount_percent IS
    'Procentní sleva na doplňkové vstupenky pro držitele permanentky (0–100).';
COMMENT ON COLUMN passes.season_pass_types.early_access_hours IS
    'Kolik hodin před veřejným sale_start má držitel přístup k nákupu vstupenek.';

CREATE INDEX idx_passes_pass_types_organizer_id
    ON passes.season_pass_types (organizer_id);

CREATE INDEX idx_passes_pass_types_active
    ON passes.season_pass_types (organizer_id, kind)
    WHERE active = TRUE;

-- =============================================================================
-- passes.season_passes
-- Vydané permanentky — jeden záznam na nákup.
-- =============================================================================

CREATE TABLE passes.season_passes (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- user_id z identity.users — cross-schema, bez FK
    user_id                 UUID            NOT NULL,
    -- organizer_id z identity.users — cross-schema, bez FK
    organizer_id            UUID            NOT NULL,
    -- pass_type_id z passes.season_pass_types — FK v rámci schématu
    pass_type_id            UUID            NOT NULL REFERENCES passes.season_pass_types (id),
    kind                    TEXT            NOT NULL
        CHECK (kind IN ('season', 'flex')),
    billing_cycle           TEXT            NOT NULL
        CHECK (billing_cycle IN ('monthly', 'annual', 'one_time')),
    -- Skutečně zaplacená cena (může se lišit od aktuální ceny typu)
    price_paid              NUMERIC(10, 2)  NOT NULL CHECK (price_paid >= 0),
    status                  TEXT            NOT NULL DEFAULT 'pending_payment'
        CHECK (status IN ('active', 'expired', 'cancelled', 'suspended', 'pending_payment')),
    start_date              TIMESTAMPTZ     NOT NULL,
    end_date                TIMESTAMPTZ     NOT NULL,
    -- Pro flex passy: zbývající počet vstupů; NULL pro season passy
    remaining_uses          INTEGER         CHECK (remaining_uses >= 0),
    -- GoPay recurring token pro ON_DEMAND opakované platby; NULL pro one_time
    gopay_recurring_token   TEXT,
    -- GoPay payment ID poslední platby
    gopay_payment_id        TEXT,
    -- Datum příští automatické platby; NULL pro one_time
    next_billing_date       TIMESTAMPTZ,
    -- Počet neúspěšných pokusů o obnovení (pro retry logiku)
    renewal_attempts        INTEGER         NOT NULL DEFAULT 0,
    cancelled_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_passes_season_passes_dates
        CHECK (end_date > start_date),
    CONSTRAINT chk_passes_season_passes_flex_uses
        CHECK (kind != 'flex' OR remaining_uses IS NOT NULL),
    CONSTRAINT chk_passes_season_passes_cancelled_consistency
        CHECK (
            (status = 'cancelled' AND cancelled_at IS NOT NULL)
            OR (status != 'cancelled')
        )
);

COMMENT ON TABLE passes.season_passes IS
    'Vydané permanentky. Jeden záznam = jeden nákup permanentky uživatelem.';
COMMENT ON COLUMN passes.season_passes.user_id IS
    'UUID držitele permanentky z identity.users; cross-schema reference — bez FK.';
COMMENT ON COLUMN passes.season_passes.organizer_id IS
    'UUID organizátora z identity.users; cross-schema reference — bez FK.';
COMMENT ON COLUMN passes.season_passes.price_paid IS
    'Skutečně zaplacená cena při nákupu; zachována i po změně ceny pass_type.';
COMMENT ON COLUMN passes.season_passes.gopay_recurring_token IS
    'GoPay recurring token vydaný po první PAID platbě; použit pro ON_DEMAND dobíjení.';
COMMENT ON COLUMN passes.season_passes.renewal_attempts IS
    'Počet neúspěšných pokusů o obnovení; po 3 pokusech je pass zrušen.';

-- Index pro rychlé vyhledávání pasů uživatele
CREATE INDEX idx_passes_season_passes_user_id
    ON passes.season_passes (user_id);

-- Index pro vyhledávání pasů organizátora
CREATE INDEX idx_passes_season_passes_organizer_id
    ON passes.season_passes (organizer_id);

-- Index pro filtrování dle statusu
CREATE INDEX idx_passes_season_passes_status
    ON passes.season_passes (status);

-- Složený index pro duplicate-check: uživatel + typ + aktivní status
CREATE INDEX idx_passes_season_passes_user_type_active
    ON passes.season_passes (user_id, pass_type_id)
    WHERE status = 'active';

-- Partial index pro renewal job: passy s blížícím se datem platby
-- Renewal job dotazuje: next_billing_date <= NOW() + 24h AND status = 'active'
CREATE INDEX idx_passes_season_passes_renewal
    ON passes.season_passes (next_billing_date ASC)
    WHERE status IN ('active', 'suspended') AND next_billing_date IS NOT NULL;

CREATE TRIGGER trg_passes_season_passes_updated_at
    BEFORE UPDATE ON passes.season_passes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: uživatel vidí pouze své vlastní permanentky
ALTER TABLE passes.season_passes ENABLE ROW LEVEL SECURITY;

CREATE POLICY passes_user_isolation ON passes.season_passes
    FOR ALL
    USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE POLICY passes_service_full_access ON passes.season_passes
    FOR ALL
    USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

-- =============================================================================
-- passes.pass_usages
-- Záznamy každého použití permanentky na konkrétní akci.
-- Immutable audit log — záznamy se nesmí mazat.
-- =============================================================================

CREATE TABLE passes.pass_usages (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- pass_id z passes.season_passes — FK v rámci schématu
    pass_id     UUID        NOT NULL REFERENCES passes.season_passes (id),
    -- event_id z catalog.events — cross-schema, bez FK
    event_id    UUID        NOT NULL,
    -- ticket_id z tickets.tickets — cross-schema, bez FK; NULL pokud vstupenka ještě nebyla vydána
    ticket_id   UUID,
    used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE passes.pass_usages IS
    'Immutable log použití permanentek. Jeden záznam = jedno použití na akci.';
COMMENT ON COLUMN passes.pass_usages.event_id IS
    'UUID akce z catalog.events; cross-schema reference — bez FK.';
COMMENT ON COLUMN passes.pass_usages.ticket_id IS
    'UUID vydané vstupenky z tickets.tickets; cross-schema reference — bez FK. NULL pokud ještě nebyla vydána.';

CREATE INDEX idx_passes_pass_usages_pass_id
    ON passes.pass_usages (pass_id);

CREATE INDEX idx_passes_pass_usages_event_id
    ON passes.pass_usages (event_id);

CREATE INDEX idx_passes_pass_usages_used_at
    ON passes.pass_usages (used_at DESC);

-- Partial index pro kontrolu duplicitního použití (jeden pas + event)
CREATE INDEX idx_passes_pass_usages_unique_check
    ON passes.pass_usages (pass_id, event_id);

-- =============================================================================
-- KOMENTÁŘE ke schématu
-- =============================================================================

COMMENT ON SCHEMA passes IS
    'Schéma pro permanentky a sezónní karty. Izolováno dle schema-per-service architektury.';

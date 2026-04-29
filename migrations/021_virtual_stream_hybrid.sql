-- =============================================================================
-- MIGRACE 021: Virtual stream access a hybridní eventy
-- Datum: 2026-04-06
-- Důvod:
--   #55 Virtual ticket & stream access — token, replay window, geo-block
--   #56 Hybridní eventy — fyzická + online účast, dual ticket type
--
--   Model:
--   - catalog.events dostane stream konfiguraci (URL, provider, geo-block, replay)
--   - catalog.ticket_types dostane attendance_type (physical / online / hybrid)
--   - tickets.tickets dostane stream access tracking (token hash, access count)
--   - Nová tabulka tickets.stream_token_log pro audit stream přístupů
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. catalog.events — stream konfigurace
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS stream_provider TEXT
    CHECK (stream_provider IN (
      'mux',               -- Mux Video (doporučeno — LLHLS, DRM)
      'cloudflare_stream', -- Cloudflare Stream
      'youtube_live',      -- YouTube Live (veřejný nebo unlisted)
      'vimeo',             -- Vimeo OTT
      'custom'             -- vlastní RTMP/HLS endpoint
    )),
  ADD COLUMN IF NOT EXISTS stream_url_encrypted   BYTEA,  -- AES-256-GCM šifrovaná stream URL
  ADD COLUMN IF NOT EXISTS stream_url_iv          BYTEA,
  ADD COLUMN IF NOT EXISTS stream_starts_at       TIMESTAMPTZ,  -- kdy se stream otevře (může předcházet event starts_at)
  ADD COLUMN IF NOT EXISTS stream_ends_at         TIMESTAMPTZ,  -- kdy se stream uzavře
  ADD COLUMN IF NOT EXISTS replay_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS replay_window_hours    INTEGER        -- NULL = neomezeno, 0 = bez replay
    CHECK (replay_window_hours IS NULL OR replay_window_hours >= 0),
  ADD COLUMN IF NOT EXISTS max_concurrent_viewers INTEGER        -- NULL = neomezeno
    CHECK (max_concurrent_viewers IS NULL OR max_concurrent_viewers > 0),
  ADD COLUMN IF NOT EXISTS geo_block_mode         TEXT NOT NULL DEFAULT 'allow_all'
    CHECK (geo_block_mode IN (
      'allow_all',   -- žádný geo-block
      'allowlist',   -- stream jen pro uvedené země
      'blocklist'    -- stream zakázán pro uvedené země
    )),
  ADD COLUMN IF NOT EXISTS geo_block_countries    TEXT[];  -- ISO 3166-1 alpha-2, např. {'CZ','SK','PL'}

COMMENT ON COLUMN catalog.events.stream_provider IS
  'Poskytovatel livestreamu. NULL = akce nemá stream (pouze fyzická).
   Mux je doporučen pro LLHLS a DRM podporu.';

COMMENT ON COLUMN catalog.events.stream_url_encrypted IS
  'AES-256-GCM šifrovaná URL streamu (RTMP ingest nebo HLS playback URL).
   Nikdy plaintext — URL nesmí uniknout z API response bez podpisového tokenu.';

COMMENT ON COLUMN catalog.events.replay_enabled IS
  'TRUE = záznam streamu je dostupný po skončení akce.
   replay_window_hours určuje jak dlouho (NULL = navždy, 0 = bez replay).';

COMMENT ON COLUMN catalog.events.geo_block_mode IS
  'allow_all: bez omezení.
   allowlist: stream dostupný POUZE pro geo_block_countries.
   blocklist: stream ZAKÁZÁN pro geo_block_countries.';

COMMENT ON COLUMN catalog.events.geo_block_countries IS
  'ISO 3166-1 alpha-2 kódy zemí. Interpretace závisí na geo_block_mode.
   Příklad: {''CZ'',''SK''} s allowlist = stream jen pro CZ a SK.';

-- Constraint: stream_url musí být v páru (encrypted + iv)
ALTER TABLE catalog.events
  ADD CONSTRAINT chk_events_stream_url_pair
    CHECK (
      (stream_url_encrypted IS NULL AND stream_url_iv IS NULL)
      OR
      (stream_url_encrypted IS NOT NULL AND stream_url_iv IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- 2. catalog.ticket_types — attendance_type pro hybridní eventy
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS attendance_type TEXT NOT NULL DEFAULT 'physical'
    CHECK (attendance_type IN (
      'physical',  -- pouze fyzická přítomnost (původní chování)
      'online',    -- pouze stream přístup (bez fyzického vstupu)
      'hybrid'     -- fyzický vstup + stream (kombinovaný)
    ));

COMMENT ON COLUMN catalog.ticket_types.attendance_type IS
  'Typ účasti pro tento ticket type.
   physical: klasická vstupenka, QR scan na bráně, bez streamu.
   online:   stream token, bez fyzického vstupu (kapacita = max_concurrent_viewers).
   hybrid:   fyzický QR + stream token — oba přístupy v jedné vstupence.
   DEFAULT physical zachovává kompatibilitu s existujícími záznamy.';

-- ---------------------------------------------------------------------------
-- 3. tickets.tickets — stream access tracking
-- ---------------------------------------------------------------------------
ALTER TABLE tickets.tickets
  ADD COLUMN IF NOT EXISTS stream_token_hash      TEXT,      -- SHA-256 posledního vydaného stream tokenu
  ADD COLUMN IF NOT EXISTS stream_first_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stream_access_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stream_last_ip_hash    TEXT;     -- SHA-256(IP) pro abuse detekci

COMMENT ON COLUMN tickets.tickets.stream_token_hash IS
  'SHA-256 hash naposledy vydaného stream tokenu.
   Při vydání nového tokenu se starý implicitně invaliduje (pouze poslední token platí).
   NULL = stream token ještě nebyl vydán.';

COMMENT ON COLUMN tickets.tickets.stream_access_count IS
  'Počet vydaných stream tokenů (ne přehrání — CDN side).
   Slouží k detekci sdílení přístupu (abuse threshold konfigurovatelný per event).';

-- ---------------------------------------------------------------------------
-- 4. tickets.stream_token_log — audit log stream přístupů
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets.stream_token_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID        NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  event_id        UUID        NOT NULL,  -- denormalizováno pro rychlé dotazy bez JOIN
  user_id         UUID        NOT NULL REFERENCES identity.users(id),

  -- Token identifikace
  token_jti       TEXT        NOT NULL,  -- JWT ID (unique per token)
  token_issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_expires_at TIMESTAMPTZ NOT NULL,

  -- Typ přístupu
  access_type     TEXT        NOT NULL
    CHECK (access_type IN (
      'live',    -- živý stream
      'replay'   -- replay záznam
    )),

  -- Geo informace
  ip_hash         TEXT,        -- SHA-256(IP) — raw IP se neukládá (GDPR)
  country_code    TEXT,        -- ISO 3166-1 alpha-2 (z GeoIP)
  geo_blocked     BOOLEAN NOT NULL DEFAULT FALSE,

  -- Výsledek
  issued          BOOLEAN NOT NULL DEFAULT TRUE,
  deny_reason     TEXT
    CHECK (deny_reason IS NULL OR deny_reason IN (
      'geo_blocked',         -- zamítnuto geo-blockem
      'ticket_invalid',      -- vstupenka neplatná/neexistuje
      'no_stream_access',    -- ticket type nemá stream přístup
      'event_not_live',      -- stream ještě nezačal nebo skončil
      'replay_expired',      -- replay okno vypršelo
      'concurrent_limit'     -- překročen max_concurrent_viewers
    )),

  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tickets.stream_token_log IS
  'Audit log každého pokusu o získání stream tokenu.
   Slouží pro abuse detekci, geo-compliance audit a billing (pay-per-view).
   IP hash uložen bez raw IP — GDPR compliant.';

CREATE INDEX IF NOT EXISTS idx_stream_token_log_ticket_id
  ON tickets.stream_token_log(ticket_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_stream_token_log_event_id
  ON tickets.stream_token_log(event_id, occurred_at DESC)
  WHERE issued = TRUE;

CREATE INDEX IF NOT EXISTS idx_stream_token_log_geo_blocked
  ON tickets.stream_token_log(event_id, country_code)
  WHERE geo_blocked = TRUE;

-- Index pro concurrent viewer tracking (počet aktivních tokenů)
CREATE INDEX IF NOT EXISTS idx_stream_token_log_active_viewers
  ON tickets.stream_token_log(event_id, token_expires_at)
  WHERE issued = TRUE AND access_type = 'live';

-- ---------------------------------------------------------------------------
-- 5. Indexy na catalog.events pro stream queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_catalog_events_stream_provider
  ON catalog.events(stream_provider)
  WHERE stream_provider IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_events_stream_live
  ON catalog.events(stream_starts_at, stream_ends_at)
  WHERE stream_provider IS NOT NULL AND replay_enabled = FALSE;

-- ---------------------------------------------------------------------------
-- 6. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'events'
      AND column_name = 'stream_provider'
  ), 'CHYBA: catalog.events.stream_provider neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog'
      AND table_name = 'ticket_types'
      AND column_name = 'attendance_type'
  ), 'CHYBA: catalog.ticket_types.attendance_type neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'tickets'
      AND table_name = 'tickets'
      AND column_name = 'stream_token_hash'
  ), 'CHYBA: tickets.tickets.stream_token_hash neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'tickets'
      AND table_name = 'stream_token_log'
  ), 'CHYBA: tickets.stream_token_log neexistuje';

  RAISE NOTICE 'Migrace 021 úspěšně ověřena — virtual stream + hybrid events přidány.';
END;
$$;

COMMIT;

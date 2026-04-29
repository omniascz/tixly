-- =============================================================================
-- MIGRACE 014: Schéma pro marketing-attribution modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\marketing-attribution\
-- Tabulky: attribution.touch_points, attribution.conversions
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS attribution;

-- ---------------------------------------------------------------------------
-- attribution.touch_points — marketingové touchpointy (utm parametry, referrer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attribution.touch_points (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Session ID (z cookie nebo localStorage) — anonymní tracking
  session_id      TEXT        NOT NULL,
  -- NULL pro anonymní návštěvníky
  user_id         UUID,
  -- cross-schema ref na catalog.events — bez FK; NULL = landing page bez konkrétní akce
  event_id        UUID,
  -- UTM parametry (z URL nebo referrer parsing)
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  utm_content     TEXT,
  utm_term        TEXT,
  -- Referrer URL (zkráceno na domain:path bez query string)
  referrer        TEXT,
  -- Odvozený kanál (z parseUtmParams + deriveChannel)
  channel         TEXT        NOT NULL DEFAULT 'direct'
    CHECK (channel IN (
      'google_ads',
      'facebook',
      'email',
      'organic_search',
      'referral',
      'direct'
    )),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE attribution.touch_points IS
  'Marketing touchpointy — každé navštívení ze sledovaného zdroje.
   Fire-and-forget INSERT (neblokuje page load). GDPR: neukládáme raw PII.
   deriveChannel pravidla: utm_source=google + utm_medium=cpc → google_ads, atd.';

COMMENT ON COLUMN attribution.touch_points.channel IS
  'Odvozený kanál: google_ads (cpc), facebook, email (newsletter),
   organic_search (google bez cpc), referral (cizí doména), direct (přímý).';

-- Aggregation query: attributions per channel za event
CREATE INDEX IF NOT EXISTS idx_attribution_tp_event_channel
  ON attribution.touch_points(event_id, channel, created_at DESC)
  WHERE event_id IS NOT NULL;

-- Session-level tracking (customer journey analysis)
CREATE INDEX IF NOT EXISTS idx_attribution_tp_session
  ON attribution.touch_points(session_id, created_at ASC);

-- User-level tracking (pro logged-in users)
CREATE INDEX IF NOT EXISTS idx_attribution_tp_user
  ON attribution.touch_points(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- attribution.conversions — dokončené konverze s attribution výsledky
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attribution.conversions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Idempotency: jedna objednávka = jeden attribution záznam
  order_id        UUID        NOT NULL UNIQUE,
  order_amount    INTEGER     NOT NULL CHECK (order_amount >= 0),
  -- Použitý attribution model
  model           TEXT        NOT NULL DEFAULT 'last_click'
    CHECK (model IN ('first_click', 'last_click', 'linear')),
  -- JSON pole attribution výsledků per touchpoint:
  -- [{ "touchPointId": "uuid", "channel": "google_ads", "weight": 0.333 }]
  -- linear model: weight rounded na 4 decimal places, součet = 1.0
  -- last touch dostane zbytek (1.0 - sum ostatních) pro přesný součet
  touch_points    JSONB       NOT NULL DEFAULT '[]',
  -- cross-schema ref na identity.users — bez FK; NULL pro anonymní konverzi
  user_id         UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE attribution.conversions IS
  'Attribution výsledky per objednávka. Uloženy při checkout completion (POST /api/attribution/conversion).
   linear model: 4 decimal places precision, last touch dostane zbytek (garantuje součet = 1.0).';

COMMENT ON COLUMN attribution.conversions.touch_points IS
  'JSON pole: [{ "touchPointId": "uuid", "channel": "...", "weight": 0.5000 }].
   Prázdné pole = direct (žádný trackovatelný touchpoint).';

CREATE INDEX IF NOT EXISTS idx_attribution_conv_user
  ON attribution.conversions(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attribution_conv_channel_stats
  ON attribution.conversions USING GIN (touch_points);

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'attribution' AND table_name = 'touch_points'),
    'CHYBA: attribution.touch_points neexistuje';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'attribution' AND table_name = 'conversions'),
    'CHYBA: attribution.conversions neexistuje';
  RAISE NOTICE 'Migrace 014 (attribution) úspěšně ověřena.';
END;
$$;

COMMIT;

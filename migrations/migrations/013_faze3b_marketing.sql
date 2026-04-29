-- =============================================================================
-- MIGRACE 013: Schéma marketing pro re-engagement modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\re-engagement\
-- Tabulky: marketing.re_engagement_campaigns, marketing.re_engagement_unsubscribes
-- GDPR: unsubscribe záznam přežívá smazání kampaní — dedicated tabulka
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS marketing;

-- ---------------------------------------------------------------------------
-- marketing.re_engagement_campaigns — orchestrace re-engagement sérií
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing.re_engagement_campaigns (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users — bez FK
  user_id               UUID          NOT NULL,
  -- Úroveň neaktivity při spuštění kampaně
  dormancy_level        TEXT          NOT NULL
    CHECK (dormancy_level IN ('at_risk', 'dormant', 'churned')),
    -- at_risk: 60–89 dní neaktivní
    -- dormant: 90–179 dní
    -- churned: 180+ dní
  campaign_started_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- Kdy byl odeslán poslední krok
  last_step_sent_at     TIMESTAMPTZ,
  -- Index aktuálního kroku v CAMPAIGN_STEPS (0 = první krok)
  current_step          INTEGER       NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  status                TEXT          NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'converted', 'unsubscribed')),
  -- Skóre odchodu při spuštění (0.0–1.0 z churn-prediction modulu)
  churn_score           NUMERIC(4, 3) CHECK (churn_score BETWEEN 0 AND 1),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketing.re_engagement_campaigns IS
  'Orchestrace re-engagement email/push sérií pro neaktivní uživatele.
   Každý uživatel smí mít max jednu aktivní kampaň (partial unique index).
   CAMPAIGN_STEPS: D+0 email, D+3 push, D+7 email.
   Konverze: první nákup po zahájení kampaně → status = converted.';

COMMENT ON COLUMN marketing.re_engagement_campaigns.dormancy_level IS
  'at_risk (60–89d), dormant (90–179d), churned (180+d).
   Určuje typ zpráv v CAMPAIGN_STEPS.';

COMMENT ON COLUMN marketing.re_engagement_campaigns.churn_score IS
  'Pravděpodobnost odchodu (0.0–1.0) z churn-prediction modulu při spuštění.
   NULL = kampain spuštěna bez ML skóre.';

COMMENT ON COLUMN marketing.re_engagement_campaigns.last_step_sent_at IS
  'Kdy byl odeslán poslední krok. Také se používá pro cooldown kontrolu:
   startCampaign() přeskakuje uživatele, pokud má poslední krok více než 30 dní zpět.';

-- Max jedna aktivní kampaň per uživatel
CREATE UNIQUE INDEX IF NOT EXISTS uq_reengagement_active_user
  ON marketing.re_engagement_campaigns(user_id)
  WHERE status = 'active';

-- Batch runner: hledá kampaně ready pro další krok
CREATE INDEX IF NOT EXISTS idx_reengagement_active
  ON marketing.re_engagement_campaigns(status, last_step_sent_at ASC)
  WHERE status = 'active';

-- Analytika: výkon per dormancy_level
CREATE INDEX IF NOT EXISTS idx_reengagement_dormancy
  ON marketing.re_engagement_campaigns(dormancy_level, status);

CREATE TRIGGER trg_reengagement_updated_at
  BEFORE UPDATE ON marketing.re_engagement_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- marketing.re_engagement_unsubscribes — GDPR opt-out (PERSISTS across campaigns)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing.re_engagement_unsubscribes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users — bez FK
  user_id           UUID        NOT NULL UNIQUE,
  unsubscribed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketing.re_engagement_unsubscribes IS
  'GDPR opt-out tabulka pro re-engagement emaily a push notifikace.
   KRITICKÉ: Tato tabulka je ODDĚLENÁ od re_engagement_campaigns.
   Záznam přežívá smazání (archivaci) kampaní — GDPR přání nemusí být ztraceno
   smazáním kampaňního záznamu. startCampaign() kontroluje tuto tabulku PŘED zahájením.';

CREATE INDEX IF NOT EXISTS idx_unsubscribes_user_id
  ON marketing.re_engagement_unsubscribes(user_id);

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'marketing' AND table_name = 're_engagement_campaigns'),
    'CHYBA: marketing.re_engagement_campaigns neexistuje';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'marketing' AND table_name = 're_engagement_unsubscribes'),
    'CHYBA: marketing.re_engagement_unsubscribes neexistuje';
  RAISE NOTICE 'Migrace 013 (marketing/re-engagement) úspěšně ověřena.';
END;
$$;

COMMIT;

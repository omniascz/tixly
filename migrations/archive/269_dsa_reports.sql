-- DSA „Nahlásit obsah" tabulka
--
-- EU Digital Services Act (Reg 2022/2065) čl. 16 vyžaduje, aby platformy
-- umožnily uživatelům snadno nahlásit nelegální obsah. Pro CZ trh:
--   - Tlačítko „Nahlásit" na public event detail
--   - Master admin queue v /platform/reports
--   - SLA: notifikace promotérovi do 24h, decize do 7 dní
--   - Statement of reasons (pokud rejected nebo akce zrušena)

BEGIN;

CREATE TABLE IF NOT EXISTS audit.content_reports (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Předmět hlášení
  event_id        UUID,        -- nullable, můžeme nahlásit i promotéra
  promoter_id     UUID,        -- nullable, můžeme nahlásit i konkrétní content
  reported_url    TEXT,        -- URL, kde byl obsah viděn

  -- Reporter
  reporter_user_id UUID,       -- nullable pro anonymní reports
  reporter_email  TEXT,        -- nullable, pro feedback
  reporter_ip     TEXT,
  reporter_ua     TEXT,

  -- Klasifikace (per DSA Art. 16(2)(c))
  category        TEXT         NOT NULL
    CHECK (category IN (
      'illegal_content',     -- protizákonný obsah
      'extremism',           -- propagace hnutí směřujících k potlačení práv
      'hate_speech',         -- nenávistné projevy
      'scam',                -- podvodná akce
      'copyright',           -- porušení autorských práv
      'impersonation',       -- vydávání se za jinou osobu
      'inappropriate',       -- nevhodné / pro děti
      'spam',                -- nevyžádané opakované akce
      'fake_event',          -- akce neexistuje / nezaplatí pořadatel
      'safety',              -- bezpečnostní hrozba
      'other'
    )),

  reason          TEXT         NOT NULL,    -- popis důvodu

  -- Workflow
  status          TEXT         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewing', 'resolved_action', 'resolved_no_action', 'dismissed_spam')),
  priority        TEXT         NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  -- Resolution
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID,
  resolution_note TEXT,
  action_taken    TEXT,        -- "akce stažena z prodeje", "promotér suspendován", "obsah upraven", "no action"

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit.content_reports IS
  'DSA Art. 16 — notice and action mechanism. Public „Nahlásit obsah" reports.';

CREATE INDEX IF NOT EXISTS idx_content_reports_status
  ON audit.content_reports (status, priority, created_at DESC)
  WHERE status IN ('pending', 'reviewing');

CREATE INDEX IF NOT EXISTS idx_content_reports_event
  ON audit.content_reports (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_reports_promoter
  ON audit.content_reports (promoter_id)
  WHERE promoter_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_content_reports_updated_at ON audit.content_reports;
CREATE TRIGGER trg_content_reports_updated_at
  BEFORE UPDATE ON audit.content_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Rate limit table (anti-spam) — max 5 reports / 24h / IP
CREATE TABLE IF NOT EXISTS audit.content_reports_rate_limit (
  ip              TEXT         PRIMARY KEY,
  count_24h       INTEGER      NOT NULL DEFAULT 1,
  last_report_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMIT;

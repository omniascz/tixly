-- =============================================================================
-- MIGRACE 012: Schéma pro audience-segmentation modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\audience-segmentation\
-- Tabulky: segmentation.segments
-- Poznámka: buildWhereClause generuje dynamický SQL dotaz do identity.users
--           a loyalty.accounts s parametrizovanými hodnotami (žádná interpolace)
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS segmentation;

-- ---------------------------------------------------------------------------
-- segmentation.segments — definice segmentů pro organizátory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS segmentation.segments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na platform.promoters — bez FK
  promoter_id       UUID        NOT NULL,
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  -- JSON definice filtru — parsovaný buildWhereClause()
  -- Struktura: { "conditions": [{ "field": "...", "operator": "...", "value": "..." }] }
  filter            JSONB       NOT NULL DEFAULT '{}',
  -- Cached počet uživatelů v segmentu (refresh při každém exportu)
  estimated_size    INTEGER     NOT NULL DEFAULT 0 CHECK (estimated_size >= 0),
  -- Kdy byl naposledy refreshnut estimated_size
  last_refreshed_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE segmentation.segments IS
  'Definice audience segmentů pro promotéry. Filter je JSON s podmínkami pro
   dynamický SQL builder (buildWhereClause). Export je omezen na max 50 000 řádků.';

COMMENT ON COLUMN segmentation.segments.filter IS
  'JSON podmínky segmentu:
   {
     "conditions": [
       { "field": "city", "operator": "eq", "value": "Praha" },
       { "field": "total_orders", "operator": "gte", "value": 3 },
       { "field": "loyalty_tier", "operator": "in", "value": ["gold", "platinum"] }
     ]
   }
   buildWhereClause() převádí na parametrizovaný SQL — žádná string interpolace hodnot.';

COMMENT ON COLUMN segmentation.segments.estimated_size IS
  'Odhadovaný počet uživatelů v segmentu. Aktualizován při každém volání exportSegment().';

CREATE INDEX IF NOT EXISTS idx_segments_promoter_id
  ON segmentation.segments(promoter_id, created_at DESC);

CREATE TRIGGER trg_segments_updated_at
  BEFORE UPDATE ON segmentation.segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- segmentation.export_jobs — tracking exportních úloh (pro async export)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS segmentation.export_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id      UUID        NOT NULL REFERENCES segmentation.segments(id) ON DELETE CASCADE,
  promoter_id     UUID        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  row_count       INTEGER     CHECK (row_count >= 0),
  file_url        TEXT,       -- URL ke stažení (S3/GCS pre-signed URL)
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE segmentation.export_jobs IS
  'Tracking asynchronních exportních úloh. Výsledek dostupný přes file_url (pre-signed URL, TTL 1h).
   Limit exportu: max 50 000 řádků per job.';

CREATE INDEX IF NOT EXISTS idx_export_jobs_segment_id
  ON segmentation.export_jobs(segment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_export_jobs_pending
  ON segmentation.export_jobs(created_at ASC)
  WHERE status IN ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'segmentation' AND table_name = 'segments'
  ), 'CHYBA: segmentation.segments neexistuje';
  RAISE NOTICE 'Migrace 012 (segmentation) úspěšně ověřena.';
END;
$$;

COMMIT;

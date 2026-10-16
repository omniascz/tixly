--
-- 472_royalty_agreements_currency.sql
--   lineups.royalty_agreements: chybejici sloupec `currency`
--
-- ── Co bylo zmereno ──────────────────────────────────────────────────────────
-- /api/admin/artist-payouts/calculate cte ze smlouvy o podilu sloupec
-- `a.currency`. Tabulka lineups.royalty_agreements zadnou menu nema — mena je
-- jen na lineups.artist_payouts (text DEFAULT 'CZK'). Dotaz proto skonci chybou
-- `column a.currency does not exist` a vypocet vyplat umelcum nefunguje vubec,
-- za zadnych okolnosti.
--
-- ── Proc doplnit sloupec, a ne osekat dotaz ──────────────────────────────────
-- Mena ve smlouve je vecne spravne: honorar se sjednava v konkretni mene a
-- vyplata z ni musi vychazet. Az se zacne prodavat v eurech, bez meny ve smlouve
-- by se honorar pocital v mene platformy misto v mene dohody.
--
-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Existujici smlouvy dostanou menu poradatele (platform.promoters.primary_currency).
-- Kdyz poradatel neexistuje (nemelo by nastat, je tam FK), padne se na 'CZK'.
--

BEGIN;

ALTER TABLE lineups.royalty_agreements
  ADD COLUMN IF NOT EXISTS currency text;

UPDATE lineups.royalty_agreements a
   SET currency = COALESCE(
         (SELECT p.primary_currency FROM platform.promoters p WHERE p.id = a.promoter_id),
         'CZK'
       )
 WHERE a.currency IS NULL;

ALTER TABLE lineups.royalty_agreements
  ALTER COLUMN currency SET DEFAULT 'CZK',
  ALTER COLUMN currency SET NOT NULL;

-- Trojpismenny ISO 4217 kod. Zamerne bez vyctu men — vycet by se musel menit
-- s kazdym novym trhem (viz stejna past u platform.fee_schedules).
ALTER TABLE lineups.royalty_agreements
  DROP CONSTRAINT IF EXISTS royalty_agreements_currency_check;
ALTER TABLE lineups.royalty_agreements
  ADD CONSTRAINT royalty_agreements_currency_check
  CHECK (currency ~ '^[A-Z]{3}$');

COMMENT ON COLUMN lineups.royalty_agreements.currency IS
  'Mena, ve ktere je honorar sjednan (ISO 4217). Vyplata umelci z ni vychazi.';

COMMIT;

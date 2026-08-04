--
-- 456_drop_base64url_defaults.sql — zrušit DEFAULT, který nefunguje NIKDE
--
-- ── Co je špatně ─────────────────────────────────────────────────────────────
-- Tři sloupce mají `DEFAULT encode(gen_random_bytes(n), 'base64url')`.
-- Kódování `base64url` přibylo do `encode()` až v **PostgreSQL 19**
-- (commit e1d91718) a ta **zatím nevyšla** — výraz tedy nefunguje na žádné
-- existující verzi Postgresu. Není to otázka upgradu (FINDINGS §35).
--
-- Důsledek: do těch tří tabulek NELZE VLOŽIT ŘÁDEK. Každý INSERT, který
-- token nedodá, skončí na `22023 unrecognized encoding: "base64url"`.
-- Mrtvé jsou tím tři zákaznické cesty:
--   marketing.ticket_alerts        → hlídací pes na lístky
--   orders.party_split_sessions    → rozdělení platby ve skupině
--   orders.ticket_transfers        → P2P převod lístku
--
-- ── Proč DROP DEFAULT, a ne oprava výrazu ────────────────────────────────────
-- `encode(…, 'base64')` by dalo jiný abecedu (`+`, `/`, `=`), což jsou znaky,
-- které se v URL musí escapovat — a všechny tři tokeny se v URL používají
-- (`/party-split/[token]`, `/tickets/transfer/[token]`). Nahrazovat je v SQL
-- (`translate`) jde, ale výsledek by se choval jinak než `base64url` v Node.
-- Token proto generuje aplikace: `crypto.randomBytes(n).toString('base64url')`
-- — táž abeceda, táž délka, jedno místo pravdy.
--
-- Sloupce zůstávají `NOT NULL` a `UNIQUE` — jen bez defaultu. Kdyby je někdo
-- zapomněl dodat, dostane `23502`, tedy hlasitou chybu, ne tichý token.
--
-- ⚠️ POŘADÍ: nasadit SPOLU s kódem, který token dodává. Samotná migrace
-- promění `22023` na `23502` — cesta bude pořád rozbitá, jen jinak.
--
-- NENASAZENO NA PRODUKCI.
--

BEGIN;

ALTER TABLE marketing.ticket_alerts        ALTER COLUMN token          DROP DEFAULT;
ALTER TABLE orders.party_split_sessions    ALTER COLUMN share_token    DROP DEFAULT;
ALTER TABLE orders.ticket_transfers        ALTER COLUMN transfer_token DROP DEFAULT;

COMMIT;

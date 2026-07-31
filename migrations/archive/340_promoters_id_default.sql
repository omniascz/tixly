-- 340_promoters_id_default.sql
--
-- BUG FIX: platform.promoters.id byl `uuid NOT NULL` BEZ defaultu, zatímco
-- všechny ostatní tabulky mají `DEFAULT gen_random_uuid()`. Existující
-- promotéři byli naseedováni s explicitním id, takže to nikdy nepropuklo —
-- ale self-registrace promotéra (POST /api/auth/register-promoter) INSERTuje
-- bez id a spoléhá na default → padala na NOT NULL (HTTP 500) v dev I produkci.
--
-- Sjednocuje chování s identity.users.id a zbytkem schématu.

ALTER TABLE platform.promoters ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 344_users_promoter_insert.sql
--
-- BUG FIX: POS prodej (walk-in pokladna) běží v promotér kontextu a vytváří
-- anonymního walk-in kupce v identity.users. Jenže p_users_write WITH CHECK
-- povolí INSERT jen service/platform-admin/self → promotér ho nevloží → RLS
-- violation → POS sale HTTP 500.
--
-- Promotér vytvářející walk-in zákazníka u kasy je legitimní operace. Přidáváme
-- INSERT-ONLY policy pro promotér kontext (negranuje UPDATE/DELETE cizích userů).
-- Read na identity.users už je beztak USING true (žádná row-privacy na úrovni tabulky).

CREATE POLICY p_users_promoter_insert ON identity.users
  FOR INSERT WITH CHECK (app_current_promoter_id() IS NOT NULL);

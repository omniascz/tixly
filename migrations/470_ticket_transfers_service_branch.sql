--
-- 470_ticket_transfers_service_branch.sql — R-40
--   orders.ticket_transfers: SELECT policy nema servisni vetev
--
-- ── Diagnoza (FINDINGS §163) ─────────────────────────────────────────────────
-- `tickets/transfer/[token]` vracela 404, i kdyz radek v tabulce BYL. Bisect
-- pres pet JOINu ukazal, ze viníkem NENI zadny z nich — radek zmizel uz
-- u PRVNI tabulky:
--     owner (bypassrls)          rowCount=1  ve vsech sesti krocich
--     tixly_app + app.role=system rowCount=0  ve vsech sesti krocich
--
-- Duvod: existuji DVE tabulky `ticket_transfers`.
--     tickets.ticket_transfers  -> policy `p_scope` (FOR ALL, app_is_service())
--     orders.ticket_transfers   -> `_insert`, `_update`, a jedina SELECT policy
--                                  `ticket_transfers_sender`:
--                                    from_user_id = app_current_user_id()
--                                    OR app.is_platform_admin
-- Routa cte `orders.*`, ale bezi v SERVISNIM kontextu (§98, zamcene rozhodnuti
-- „verejne routy -> servisni kontext"), kde `app_current_user_id()` je NULL.
-- Zadna vetev tedy neplatila a RLS radek odfiltrovala JESTE PRED JOINy.
--
-- ⚠️ Je to tataz trida jako R-30: SELECT policy bez servisni vetve. A zaroven
-- tataz trida jako §139 (kolize jmen) — dve tabulky stejneho jmena v ruznych
-- schematech, kde ochranu ma jen jedna.
--
-- ── Co tahle migrace pridava ────────────────────────────────────────────────
-- Servisni vetev, protoze routa v servisnim kontextu bezet MA — prijemce
-- prevodu jeste neni prihlaseny, takze uzivatelska vetev by nefungovala.
-- Vetev PRIJEMCE (`to_email`) pridavam take: bez ni by prihlaseny prijemce
-- svuj vlastni prevod nevidel, coz je duvod, proc POST vracel 500.
-- `ticket_transfers_sender` zustava beze zmeny — odesilatel vidi dal.
--
BEGIN;

DROP POLICY IF EXISTS p_ticket_transfers_service ON orders.ticket_transfers;
CREATE POLICY p_ticket_transfers_service ON orders.ticket_transfers
  FOR SELECT
  USING (
    public.app_is_service()
    OR public.app_is_platform_admin()
    OR (to_email IS NOT NULL AND to_email = (
          SELECT u.email FROM identity.users u WHERE u.id = public.app_current_user_id()))
  );

COMMIT;

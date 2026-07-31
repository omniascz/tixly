-- 349_venues_public_read.sql
--
-- BUG FIX: veřejné stránky (landing, /events, detail akce) zobrazovaly u všech
-- akcí místo konání "Online", i když akce mají reálný sál (Divadlo Stará
-- střelnice, Klub Underground…). Příčina: catalog.venues měl jen tenant
-- (promotér/admin) + service policy, žádnou veřejnou. Pod ENFORCED RLS tak
-- anonymní návštěvník venue NEVIDĚL → LEFT JOIN vrátil NULL → COALESCE 'Online'.
--
-- Název/město/adresa sálu jsou VEŘEJNÁ informace (jsou na vstupence i na stránce
-- akce). Přidáváme public SELECT policy — ale jen pro sály, které hostí aspoň
-- jednu published akci (minimální expozice; rozpracované sály zůstávají skryté).
-- Zápis (create/edit) dál řídí promotér-tenant policy.

CREATE POLICY p_venues_public_read ON catalog.venues
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM catalog.events e
      WHERE e.venue_id = venues.id AND e.status = 'published'
    )
  );

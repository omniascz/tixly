--
-- 469_broadcasts_target_event.sql — E11
--   communications.broadcasts.target: doplnit 'event' do CHECK vyctu
--
-- ── Proc migrace, a ne zuzeni zod ────────────────────────────────────────────
-- Pravidlo bylo: kdyz UI volbu NENABIZI, zuzit zod; kdyz nabizi, rozsirit CHECK.
-- UI ji NABIZI, a ne omylem — je to plnohodnotna, pojmenovana moznost:
--
--   src/app/admin/broadcasts/new/page.tsx:33  TARGET_OPTIONS = [
--     { value: 'all',            label: 'Všichni zákazníci …' },
--     { value: 'buyers_only',    label: 'Pouze kupující přes Tixly' },
--     { value: 'contacts_only',  label: 'Pouze importovaná databáze' },
--     { value: 'subscribers',    label: 'Pouze předplatitelé' },
--     { value: 'event',          label: 'Zákazníci konkrétní akce' },   <-- tady
--   ];
--
-- Podporne dukazy, ze to neni zapomenuty radek v UI:
--   • `type Target` (page.tsx:13) tu hodnotu obsahuje
--   • UI si vynucuje vyber akce: `if (target === 'event' && !eventId) …` (:123)
--   • routa to validuje take: `eventId required for target=event` (route.ts:61)
--   • tabulka MA sloupec `event_id` — bez cileni na akci by nemel smysl
--
-- Cela cesta je tedy postavena kolem teto hodnoty; chybi jen v CHECK vyctu.
--
-- ⚠️ Rozdil proti D5: tam se vycet NEROZSIRIL, protoze `event_moderation_log`
-- je designovany pro strojovou moderaci a lidsky admin do nej nepatri —
-- hodnota byla CIZI SVETU tabulky. Tady je to naopak: 'event' do sveta
-- broadcastu patri a chybi jen v jednom miste.
--

BEGIN;

ALTER TABLE communications.broadcasts DROP CONSTRAINT IF EXISTS broadcasts_target_check;
ALTER TABLE communications.broadcasts ADD CONSTRAINT broadcasts_target_check
  CHECK (target = ANY (ARRAY[
    'all'::text,
    'buyers_only'::text,
    'contacts_only'::text,
    'subscribers'::text,
    'event'::text
  ]));

COMMIT;

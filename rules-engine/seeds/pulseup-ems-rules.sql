-- =============================================================================
-- Seed: PulseUp EMS-style rules
--
-- This creates the same business logic that PulseUp had hardcoded, but now
-- fully editable by the promoter in admin:
--
--   STORNO:     min 24 hodin předem
--   PŘESUN:     min 30 minut předem + přesunový klíč (Po→Pá, Út→Pá, St→Po, Čt→Út, Pá→St)
--
-- To use: replace :PROMOTER_ID with the actual UUID of the PulseUp promoter.
--
-- Day numbering (JS convention): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
--
-- These are EXAMPLES. Any promoter can create completely different rules via
-- the rules API (POST /api/reservations/rules). No code changes needed.
-- =============================================================================

-- :PROMOTER_ID should be replaced with the actual promoter UUID
-- Example: SET session my.promoter_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

-- =========================================================================
-- CANCEL POLICY: Storno min 24h předem
-- =========================================================================

INSERT INTO reservations.rules
  (promoter_id, name, description, rule_type, trigger_event, priority, is_active, stop_on_match)
VALUES
  (:PROMOTER_ID,
   'Storno: povoleno 24h+ předem',
   'Klient může zrušit rezervaci nejpozději 24 hodin před začátkem.',
   'cancel_policy', 'on_cancel', 10, true, true);

INSERT INTO reservations.rule_conditions (rule_id, condition_type, operator, value_a, sort_order)
SELECT id, 'advance_hours', 'gte', '24', 0
  FROM reservations.rules WHERE name = 'Storno: povoleno 24h+ předem' AND promoter_id = :PROMOTER_ID;

INSERT INTO reservations.rule_actions (rule_id, action_type, action_message, sort_order)
SELECT id, 'allow', 'Storno povoleno.', 0
  FROM reservations.rules WHERE name = 'Storno: povoleno 24h+ předem' AND promoter_id = :PROMOTER_ID;

-- Block rule for <24h (lower priority, evaluated if above doesn't match)
INSERT INTO reservations.rules
  (promoter_id, name, description, rule_type, trigger_event, priority, is_active, stop_on_match)
VALUES
  (:PROMOTER_ID,
   'Storno: blokace <24h',
   'Zamítne storno pokud do začátku zbývá méně než 24 hodin.',
   'cancel_policy', 'on_cancel', 5, true, true);

INSERT INTO reservations.rule_conditions (rule_id, condition_type, operator, value_a, sort_order)
SELECT id, 'advance_hours', 'lt', '24', 0
  FROM reservations.rules WHERE name = 'Storno: blokace <24h' AND promoter_id = :PROMOTER_ID;

INSERT INTO reservations.rule_actions (rule_id, action_type, action_message, sort_order)
SELECT id, 'block', 'Rezervaci nelze zrušit — limit 24 hodin před začátkem byl překročen.', 0
  FROM reservations.rules WHERE name = 'Storno: blokace <24h' AND promoter_id = :PROMOTER_ID;


-- =========================================================================
-- RESCHEDULE POLICY: Min 30 minut + přesunový klíč
-- =========================================================================

-- 1. Time limit: must be ≥0.5h before slot start
INSERT INTO reservations.rules
  (promoter_id, name, description, rule_type, trigger_event, priority, is_active, stop_on_match)
VALUES
  (:PROMOTER_ID,
   'Přesun: blokace <30min',
   'Zamítne přesun pokud do začátku zbývá méně než 30 minut.',
   'reschedule_policy', 'on_reschedule', 100, true, true);

INSERT INTO reservations.rule_conditions (rule_id, condition_type, operator, value_a, sort_order)
SELECT id, 'advance_hours', 'lt', '0.5', 0
  FROM reservations.rules WHERE name = 'Přesun: blokace <30min' AND promoter_id = :PROMOTER_ID;

INSERT INTO reservations.rule_actions (rule_id, action_type, action_message, sort_order)
SELECT id, 'block', 'Přesun nelze provést — limit 30 minut před začátkem byl překročen.', 0
  FROM reservations.rules WHERE name = 'Přesun: blokace <30min' AND promoter_id = :PROMOTER_ID;


-- 2. Day mapping rules (přesunový klíč):
--    Po(1) → Pá(5)
--    Út(2) → Pá(5)
--    St(3) → Po(1)
--    Čt(4) → Út(2)
--    Pá(5) → St(3)

-- Po → Pá
INSERT INTO reservations.rules
  (promoter_id, name, description, rule_type, trigger_event, priority, is_active, stop_on_match)
VALUES
  (:PROMOTER_ID,
   'Přesun: Po → Pá',
   'Pondělní lekce lze přesunout pouze na pátek.',
   'reschedule_policy', 'on_reschedule', 50, true, true);

INSERT INTO reservations.rule_conditions (rule_id, condition_type, operator, value_a, value_b, sort_order)
SELECT id, 'reschedule_day_mapping', 'eq', '1', '5', 0
  FROM reservations.rules WHERE name = 'Přesun: Po → Pá' AND promoter_id = :PROMOTER_ID;

INSERT INTO reservations.rule_actions (rule_id, action_type, action_message, sort_order)
SELECT id, 'allow', 'Přesun povolen (Po → Pá).', 0
  FROM reservations.rules WHERE name = 'Přesun: Po → Pá' AND promoter_id = :PROMOTER_ID;

-- Út → Pá
INSERT INTO reservations.rules
  (promoter_id, name, description, rule_type, trigger_event, priority, is_active, stop_on_match)
VALUES
  (:PROMOTER_ID,
   'Přesun: Út → Pá',
   'Úterní lekce lze přesunout pouze na pátek.',
   'reschedule_policy', 'on_reschedule', 50, true, true);

INSERT INTO reservations.rule_conditions (rule_id, condition_type, operator, value_a, value_b, sort_order)
SELECT id, 'reschedule_day_mapping', 'eq', '2', '5', 0
  FROM reservations.rules WHERE name = 'Přesun: Út → Pá' AND promoter_id = :PROMOTER_ID;

INSERT INTO reservations.rule_actions (rule_id, action_type, action_message, sort_order)
SELECT id, 'allow', 'Přesun povolen (Út → Pá).', 0
  FROM reservations.rules WHERE name = 'Přesun: Út → Pá' AND promoter_id = :PROMOTER_ID;

-- St → Po
INSERT INTO reservations.rules
  (promoter_id, name, description, rule_type, trigger_event, priority, is_active, stop_on_match)
VALUES
  (:PROMOTER_ID,
   'Přesun: St → Po',
   'Středeční lekce lze přesunout pouze na pondělí.',
   'reschedule_policy', 'on_reschedule', 50, true, true);

INSERT INTO reservations.rule_conditions (rule_id, condition_type, operator, value_a, value_b, sort_order)
SELECT id, 'reschedule_day_mapping', 'eq', '3', '1', 0
  FROM reservations.rules WHERE name = 'Přesun: St → Po' AND promoter_id = :PROMOTER_ID;

INSERT INTO reservations.rule_actions (rule_id, action_type, action_message, sort_order)
SELECT id, 'allow', 'Přesun povolen (St → Po).', 0
  FROM reservations.rules WHERE name = 'Přesun: St → Po' AND promoter_id = :PROMOTER_ID;

-- Čt → Út
INSERT INTO reservations.rules
  (promoter_id, name, description, rule_type, trigger_event, priority, is_active, stop_on_match)
VALUES
  (:PROMOTER_ID,
   'Přesun: Čt → Út',
   'Čtvrteční lekce lze přesunout pouze na úterý.',
   'reschedule_policy', 'on_reschedule', 50, true, true);

INSERT INTO reservations.rule_conditions (rule_id, condition_type, operator, value_a, value_b, sort_order)
SELECT id, 'reschedule_day_mapping', 'eq', '4', '2', 0
  FROM reservations.rules WHERE name = 'Přesun: Čt → Út' AND promoter_id = :PROMOTER_ID;

INSERT INTO reservations.rule_actions (rule_id, action_type, action_message, sort_order)
SELECT id, 'allow', 'Přesun povolen (Čt → Út).', 0
  FROM reservations.rules WHERE name = 'Přesun: Čt → Út' AND promoter_id = :PROMOTER_ID;

-- Pá → St
INSERT INTO reservations.rules
  (promoter_id, name, description, rule_type, trigger_event, priority, is_active, stop_on_match)
VALUES
  (:PROMOTER_ID,
   'Přesun: Pá → St',
   'Páteční lekce lze přesunout pouze na středu.',
   'reschedule_policy', 'on_reschedule', 50, true, true);

INSERT INTO reservations.rule_conditions (rule_id, condition_type, operator, value_a, value_b, sort_order)
SELECT id, 'reschedule_day_mapping', 'eq', '5', '3', 0
  FROM reservations.rules WHERE name = 'Přesun: Pá → St' AND promoter_id = :PROMOTER_ID;

INSERT INTO reservations.rule_actions (rule_id, action_type, action_message, sort_order)
SELECT id, 'allow', 'Přesun povolen (Pá → St).', 0
  FROM reservations.rules WHERE name = 'Přesun: Pá → St' AND promoter_id = :PROMOTER_ID;

-- 3. Catch-all: block any reschedule not matching the above day rules
INSERT INTO reservations.rules
  (promoter_id, name, description, rule_type, trigger_event, priority, is_active, stop_on_match)
VALUES
  (:PROMOTER_ID,
   'Přesun: nepovolený den (catch-all)',
   'Blokuje přesun na den, který není v přesunovém klíči.',
   'reschedule_policy', 'on_reschedule', 1, true, true);

INSERT INTO reservations.rule_conditions (rule_id, condition_type, operator, value_a, sort_order)
SELECT id, 'always', 'eq', 'true', 0
  FROM reservations.rules WHERE name = 'Přesun: nepovolený den (catch-all)' AND promoter_id = :PROMOTER_ID;

INSERT INTO reservations.rule_actions (rule_id, action_type, action_message, sort_order)
SELECT id, 'block', 'Přesun na zvolený den není povolen pravidlem přesunového klíče.', 0
  FROM reservations.rules WHERE name = 'Přesun: nepovolený den (catch-all)' AND promoter_id = :PROMOTER_ID;

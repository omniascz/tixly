-- =============================================================================
-- 077_rules_reschedule_cancel.sql
-- Extend rules engine for generic reschedule/cancel/attendance policies.
--
-- New rule types:   reschedule_policy, cancel_policy, attendance_policy
-- New trigger:      on_reschedule
-- New conditions:   reschedule_day_mapping, source_day_of_week, target_day_of_week
-- New action types: refund_credit, mark_no_show
--
-- This makes storno limits, přesun klíč, and attendance rules fully
-- admin-configurable per promoter — no hardcoded business logic.
-- =============================================================================

-- 1. Expand rule_type CHECK
ALTER TABLE reservations.rules
  DROP CONSTRAINT IF EXISTS rules_rule_type_check;

ALTER TABLE reservations.rules
  ADD CONSTRAINT rules_rule_type_check CHECK (rule_type IN (
    'booking_window','advance_notice','user_limit','capacity',
    'time_restriction','approval','discount','surcharge',
    'verification','blackout',
    'reschedule_policy','cancel_policy','attendance_policy'
  ));

-- 2. Expand trigger_event CHECK
ALTER TABLE reservations.rules
  DROP CONSTRAINT IF EXISTS rules_trigger_event_check;

ALTER TABLE reservations.rules
  ADD CONSTRAINT rules_trigger_event_check CHECK (trigger_event IN (
    'before_hold','before_confirm','on_cancel','on_complete',
    'on_reschedule','on_attendance'
  ));

-- 3. Expand condition_type CHECK
ALTER TABLE reservations.rule_conditions
  DROP CONSTRAINT IF EXISTS rule_conditions_condition_type_check;

ALTER TABLE reservations.rule_conditions
  ADD CONSTRAINT rule_conditions_condition_type_check CHECK (condition_type IN (
    'day_of_week','time_of_day','advance_hours','user_role',
    'quantity','user_booking_count','service_type','branch',
    'date_range','always',
    'reschedule_day_mapping','source_day_of_week','target_day_of_week'
  ));

-- 4. Expand action_type CHECK
ALTER TABLE reservations.rule_actions
  DROP CONSTRAINT IF EXISTS rule_actions_action_type_check;

ALTER TABLE reservations.rule_actions
  ADD CONSTRAINT rule_actions_action_type_check CHECK (action_type IN (
    'block','allow','require_approval','apply_discount',
    'apply_surcharge','set_limit','send_notification','add_tag',
    'refund_credit','mark_no_show'
  ));

-- 5. Add COMMENT documentation for new types
COMMENT ON TABLE reservations.rules IS
  'Generic per-promoter business rules. Evaluated by rules-engine on booking, cancel, reschedule, attendance events.';

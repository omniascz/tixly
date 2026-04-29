import type { RuleDB } from './rule.service';
import type { RuleCondition, RuleAction, RuleType, TriggerEvent, ConditionType, ConditionOperator, ActionType } from './rule.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvaluationContext {
  userId: string;
  promoterId: string;
  slotId: string;
  serviceId?: string;
  branchId?: string;
  quantity: number;
  advanceHours: number;      // hours until slot starts
  dayOfWeek: number;         // 0-6, 0=Sunday (source day for reschedule)
  timeOfDay: string;         // "HH:MM"
  userRole?: string;         // 'member', 'vip', 'guest', etc.
  userBookingCount?: number; // existing bookings for this service
  // Reschedule-specific context:
  targetDayOfWeek?: number;  // 0-6, 0=Sunday — the day being moved TO
  triggerEvent?: string;     // which event triggered evaluation
}

export interface EvaluationResult {
  allowed: boolean;
  requiresApproval: boolean;
  discountBasisPoints: number;   // 0 = no discount, 1000 = 10%
  surchargeBasisPoints: number;
  blockedByRule?: string;        // rule name that blocked
  blockedMessage?: string;
  appliedRules: string[];        // names of rules that fired
}

interface RuleWithConditionsAndActions {
  id: string;
  promoter_id: string;
  branch_id: string | null;
  service_id: string | null;
  name: string;
  rule_type: RuleType;
  trigger_event: TriggerEvent;
  priority: number;
  is_active: boolean;
  stop_on_match: boolean;
  conditions: RuleConditionRow[];
  actions: RuleActionRow[];
}

interface RuleConditionRow {
  id: string;
  rule_id: string;
  condition_type: ConditionType;
  operator: ConditionOperator;
  value_a: string;
  value_b: string | null;
  sort_order: number;
}

interface RuleActionRow {
  id: string;
  rule_id: string;
  action_type: ActionType;
  action_value: string | null;
  action_message: string | null;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Pure condition evaluator (no DB)
// ---------------------------------------------------------------------------

export function evaluateCondition(
  condition: RuleCondition | RuleConditionRow,
  context: EvaluationContext,
): boolean {
  const { operator } = condition;
  const valueA = 'valueA' in condition ? condition.valueA : condition.value_a;
  const valueB = 'valueB' in condition ? condition.valueB : condition.value_b;
  const conditionType = 'conditionType' in condition ? condition.conditionType : condition.condition_type;

  switch (conditionType) {
    case 'always':
      return true;

    case 'day_of_week': {
      const days = valueA.split(',').map(d => parseInt(d.trim(), 10));
      if (operator === 'in') return days.includes(context.dayOfWeek);
      if (operator === 'not_in') return !days.includes(context.dayOfWeek);
      if (operator === 'eq') return context.dayOfWeek === parseInt(valueA, 10);
      if (operator === 'neq') return context.dayOfWeek !== parseInt(valueA, 10);
      return false;
    }

    case 'time_of_day': {
      const target = context.timeOfDay;
      if (operator === 'between' && valueB) {
        return target >= valueA && target <= valueB;
      }
      return compareValues(target, operator, valueA);
    }

    case 'advance_hours': {
      const val = parseFloat(valueA);
      if (operator === 'between' && valueB) {
        return context.advanceHours >= val && context.advanceHours <= parseFloat(valueB);
      }
      return compareNumeric(context.advanceHours, operator, val);
    }

    case 'user_role': {
      const role = context.userRole ?? '';
      if (operator === 'in') {
        const roles = valueA.split(',').map(r => r.trim());
        return roles.includes(role);
      }
      if (operator === 'not_in') {
        const roles = valueA.split(',').map(r => r.trim());
        return !roles.includes(role);
      }
      if (operator === 'eq') return role === valueA;
      if (operator === 'neq') return role !== valueA;
      return false;
    }

    case 'quantity': {
      const val = parseInt(valueA, 10);
      if (operator === 'between' && valueB) {
        return context.quantity >= val && context.quantity <= parseInt(valueB, 10);
      }
      return compareNumeric(context.quantity, operator, val);
    }

    case 'user_booking_count': {
      const count = context.userBookingCount ?? 0;
      const val = parseInt(valueA, 10);
      if (operator === 'between' && valueB) {
        return count >= val && count <= parseInt(valueB, 10);
      }
      return compareNumeric(count, operator, val);
    }

    case 'service_type':
    case 'branch':
    case 'date_range': {
      // Generic string comparison
      const field =
        conditionType === 'branch' ? context.branchId ?? '' :
        conditionType === 'service_type' ? context.serviceId ?? '' :
        '';
      if (operator === 'eq') return field === valueA;
      if (operator === 'neq') return field !== valueA;
      if (operator === 'in') return valueA.split(',').map(v => v.trim()).includes(field);
      if (operator === 'not_in') return !valueA.split(',').map(v => v.trim()).includes(field);
      return false;
    }

    // -----------------------------------------------------------------
    // Reschedule-specific conditions
    // -----------------------------------------------------------------

    case 'source_day_of_week': {
      // Checks the day of the ORIGINAL slot (context.dayOfWeek).
      // Same logic as day_of_week but semantically for reschedule source.
      const days = valueA.split(',').map(d => parseInt(d.trim(), 10));
      if (operator === 'in') return days.includes(context.dayOfWeek);
      if (operator === 'not_in') return !days.includes(context.dayOfWeek);
      if (operator === 'eq') return context.dayOfWeek === parseInt(valueA, 10);
      return false;
    }

    case 'target_day_of_week': {
      // Checks the day of the TARGET slot (context.targetDayOfWeek).
      const target = context.targetDayOfWeek;
      if (target === undefined) return false;
      const days = valueA.split(',').map(d => parseInt(d.trim(), 10));
      if (operator === 'in') return days.includes(target);
      if (operator === 'not_in') return !days.includes(target);
      if (operator === 'eq') return target === parseInt(valueA, 10);
      return false;
    }

    case 'reschedule_day_mapping': {
      // Combined source→target check.
      // valueA = source day (1 = Monday), valueB = comma-separated allowed target days.
      // Operator must be 'eq' (source matches) + target in allowed list.
      // Example: valueA="1", valueB="5" → Monday can move to Friday.
      const sourceDay = parseInt(valueA, 10);
      if (context.dayOfWeek !== sourceDay) return false;
      if (!valueB) return false;
      const allowedTargets = valueB.split(',').map(d => parseInt(d.trim(), 10));
      return context.targetDayOfWeek !== undefined && allowedTargets.includes(context.targetDayOfWeek);
    }

    default:
      return false;
  }
}

function compareNumeric(target: number, operator: ConditionOperator, value: number): boolean {
  switch (operator) {
    case 'eq': return target === value;
    case 'neq': return target !== value;
    case 'gt': return target > value;
    case 'gte': return target >= value;
    case 'lt': return target < value;
    case 'lte': return target <= value;
    default: return false;
  }
}

function compareValues(target: string, operator: ConditionOperator, value: string): boolean {
  switch (operator) {
    case 'eq': return target === value;
    case 'neq': return target !== value;
    case 'gt': return target > value;
    case 'gte': return target >= value;
    case 'lt': return target < value;
    case 'lte': return target <= value;
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Pure action executor (modifies result in place)
// ---------------------------------------------------------------------------

export function executeAction(
  action: RuleAction | RuleActionRow,
  ruleName: string,
  result: EvaluationResult,
): void {
  const actionType = 'actionType' in action ? action.actionType : action.action_type;
  const actionValue = 'actionValue' in action ? action.actionValue : action.action_value;
  const actionMessage = 'actionMessage' in action ? action.actionMessage : action.action_message;

  switch (actionType) {
    case 'block':
      result.allowed = false;
      result.blockedByRule = ruleName;
      result.blockedMessage = actionMessage ?? undefined;
      break;

    case 'allow':
      result.allowed = true;
      result.blockedByRule = undefined;
      result.blockedMessage = undefined;
      break;

    case 'require_approval':
      result.requiresApproval = true;
      break;

    case 'apply_discount':
      result.discountBasisPoints += actionValue ? parseInt(actionValue, 10) : 0;
      break;

    case 'apply_surcharge':
      result.surchargeBasisPoints += actionValue ? parseInt(actionValue, 10) : 0;
      break;

    case 'set_limit':
    case 'send_notification':
    case 'add_tag':
      // Future: handle these action types
      break;
  }
}

// ---------------------------------------------------------------------------
// Main evaluation engine
// ---------------------------------------------------------------------------

export async function evaluateRules(
  context: EvaluationContext,
  db: RuleDB,
  triggerEventFilter?: string,
): Promise<EvaluationResult> {
  const effectiveTrigger = triggerEventFilter ?? context.triggerEvent;
  // Fetch active rules for this promoter+service+branch with conditions+actions
  const { rows } = await db.query<RuleWithConditionsAndActions>(
    `SELECT r.*,
            COALESCE(
              json_agg(DISTINCT jsonb_build_object(
                'id', rc.id, 'rule_id', rc.rule_id,
                'condition_type', rc.condition_type, 'operator', rc.operator,
                'value_a', rc.value_a, 'value_b', rc.value_b, 'sort_order', rc.sort_order
              )) FILTER (WHERE rc.id IS NOT NULL), '[]'
            ) AS conditions,
            COALESCE(
              json_agg(DISTINCT jsonb_build_object(
                'id', ra.id, 'rule_id', ra.rule_id,
                'action_type', ra.action_type, 'action_value', ra.action_value,
                'action_message', ra.action_message, 'sort_order', ra.sort_order
              )) FILTER (WHERE ra.id IS NOT NULL), '[]'
            ) AS actions
     FROM reservations.rules r
     LEFT JOIN reservations.rule_conditions rc ON rc.rule_id = r.id
     LEFT JOIN reservations.rule_actions ra ON ra.rule_id = r.id
     WHERE r.promoter_id = $1
       AND r.is_active = true
       AND (r.branch_id IS NULL OR r.branch_id = $2)
       AND (r.service_id IS NULL OR r.service_id = $3)
       AND ($4::text IS NULL OR r.trigger_event = $4)
     GROUP BY r.id
     ORDER BY r.priority DESC, r.created_at ASC`,
    [context.promoterId, context.branchId ?? null, context.serviceId ?? null, effectiveTrigger ?? null],
  );

  const result: EvaluationResult = {
    allowed: true,
    requiresApproval: false,
    discountBasisPoints: 0,
    surchargeBasisPoints: 0,
    appliedRules: [],
  };

  for (const rule of rows) {
    const conditions: RuleConditionRow[] = Array.isArray(rule.conditions) ? rule.conditions : [];
    const actions: RuleActionRow[] = Array.isArray(rule.actions) ? rule.actions : [];

    // Evaluate all conditions (AND logic)
    const allMatch = conditions.length === 0
      ? true
      : conditions.every(c => evaluateCondition(c as RuleConditionRow, context));

    if (!allMatch) continue;

    // Fire actions
    result.appliedRules.push(rule.name);
    for (const action of actions) {
      executeAction(action as RuleActionRow, rule.name, result);
    }

    // Log evaluation (execute — no query increment)
    const evalResult = !result.allowed ? 'blocked' :
      result.requiresApproval ? 'approved' :
      result.discountBasisPoints > 0 ? 'discounted' : 'passed';

    await db.execute(
      `INSERT INTO reservations.rule_evaluations
         (rule_id, user_id, slot_id, result, matched_conditions, applied_action)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        rule.id,
        context.userId,
        context.slotId,
        evalResult,
        JSON.stringify(conditions.map(c => c.id)),
        actions[0]?.action_type ?? null,
      ],
    );

    if (rule.stop_on_match) break;
  }

  return result;
}

import { RuleError } from '../lib/rules-errors';

// ---------------------------------------------------------------------------
// DB interface
// ---------------------------------------------------------------------------

export interface RuleDB {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  execute: (sql: string, params?: unknown[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuleType =
  | 'booking_window'
  | 'advance_notice'
  | 'user_limit'
  | 'capacity'
  | 'time_restriction'
  | 'approval'
  | 'discount'
  | 'surcharge'
  | 'verification'
  | 'blackout'
  | 'reschedule_policy'
  | 'cancel_policy'
  | 'attendance_policy';

export type TriggerEvent = 'before_hold' | 'before_confirm' | 'on_cancel' | 'on_complete' | 'on_reschedule' | 'on_attendance';

export type ConditionType =
  | 'day_of_week'
  | 'time_of_day'
  | 'advance_hours'
  | 'user_role'
  | 'quantity'
  | 'user_booking_count'
  | 'service_type'
  | 'branch'
  | 'date_range'
  | 'always'
  | 'reschedule_day_mapping'
  | 'source_day_of_week'
  | 'target_day_of_week';

export type ConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'between';

export type ActionType =
  | 'block'
  | 'allow'
  | 'require_approval'
  | 'apply_discount'
  | 'apply_surcharge'
  | 'set_limit'
  | 'send_notification'
  | 'add_tag'
  | 'refund_credit'
  | 'mark_no_show';

export interface RuleInput {
  branchId?: string | null;
  serviceId?: string | null;
  name: string;
  description?: string | null;
  ruleType: RuleType;
  triggerEvent?: TriggerEvent;
  priority?: number;
  isActive?: boolean;
  stopOnMatch?: boolean;
}

export interface RuleUpdateInput {
  branchId?: string | null;
  serviceId?: string | null;
  name?: string;
  description?: string | null;
  ruleType?: RuleType;
  triggerEvent?: TriggerEvent;
  priority?: number;
  isActive?: boolean;
  stopOnMatch?: boolean;
}

export interface RuleFilters {
  branchId?: string;
  serviceId?: string;
  ruleType?: RuleType;
  isActive?: boolean;
}

export interface ConditionInput {
  conditionType: ConditionType;
  operator: ConditionOperator;
  valueA: string;
  valueB?: string | null;
  sortOrder?: number;
}

export interface ActionInput {
  actionType: ActionType;
  actionValue?: string | null;
  actionMessage?: string | null;
  sortOrder?: number;
}

export interface RuleCondition {
  id: string;
  ruleId: string;
  conditionType: ConditionType;
  operator: ConditionOperator;
  valueA: string;
  valueB: string | null;
  sortOrder: number;
}

export interface RuleAction {
  id: string;
  ruleId: string;
  actionType: ActionType;
  actionValue: string | null;
  actionMessage: string | null;
  sortOrder: number;
}

export interface Rule {
  id: string;
  promoterId: string;
  branchId: string | null;
  serviceId: string | null;
  name: string;
  description: string | null;
  ruleType: RuleType;
  triggerEvent: TriggerEvent;
  priority: number;
  isActive: boolean;
  stopOnMatch: boolean;
  createdAt: string;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface RuleRow {
  id: string;
  promoter_id: string;
  branch_id: string | null;
  service_id: string | null;
  name: string;
  description: string | null;
  rule_type: RuleType;
  trigger_event: TriggerEvent;
  priority: number;
  is_active: boolean;
  stop_on_match: boolean;
  created_at: string;
}

interface ConditionRow {
  id: string;
  rule_id: string;
  condition_type: ConditionType;
  operator: ConditionOperator;
  value_a: string;
  value_b: string | null;
  sort_order: number;
}

interface ActionRow {
  id: string;
  rule_id: string;
  action_type: ActionType;
  action_value: string | null;
  action_message: string | null;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapRule(row: RuleRow): Rule {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    branchId: row.branch_id,
    serviceId: row.service_id,
    name: row.name,
    description: row.description,
    ruleType: row.rule_type,
    triggerEvent: row.trigger_event,
    priority: Number(row.priority),
    isActive: row.is_active,
    stopOnMatch: row.stop_on_match,
    createdAt: row.created_at,
  };
}

function mapCondition(row: ConditionRow): RuleCondition {
  return {
    id: row.id,
    ruleId: row.rule_id,
    conditionType: row.condition_type,
    operator: row.operator,
    valueA: row.value_a,
    valueB: row.value_b,
    sortOrder: Number(row.sort_order),
  };
}

function mapAction(row: ActionRow): RuleAction {
  return {
    id: row.id,
    ruleId: row.rule_id,
    actionType: row.action_type,
    actionValue: row.action_value,
    actionMessage: row.action_message,
    sortOrder: Number(row.sort_order),
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createRule(
  promoterId: string,
  input: RuleInput,
  db: RuleDB,
): Promise<Rule> {
  await db.execute(
    `INSERT INTO reservations.rules
       (promoter_id, branch_id, service_id, name, description, rule_type,
        trigger_event, priority, is_active, stop_on_match)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      promoterId,
      input.branchId ?? null,
      input.serviceId ?? null,
      input.name,
      input.description ?? null,
      input.ruleType,
      input.triggerEvent ?? 'before_hold',
      input.priority ?? 0,
      input.isActive ?? true,
      input.stopOnMatch ?? false,
    ],
  );

  const { rows } = await db.query<RuleRow>(
    `SELECT * FROM reservations.rules WHERE promoter_id = $1 AND name = $2`,
    [promoterId, input.name],
  );

  if (!rows[0]) {
    throw new RuleError('RULE_DUPLICATE');
  }

  return mapRule(rows[0]);
}

export async function getRule(ruleId: string, db: RuleDB): Promise<Rule> {
  const { rows } = await db.query<RuleRow & { conditions: ConditionRow[]; actions: ActionRow[] }>(
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
     WHERE r.id = $1
     GROUP BY r.id`,
    [ruleId],
  );

  if (!rows[0]) {
    throw new RuleError('RULE_NOT_FOUND');
  }

  const row = rows[0];
  const rule = mapRule(row);
  const rawConditions = Array.isArray(row.conditions) ? row.conditions : [];
  const rawActions = Array.isArray(row.actions) ? row.actions : [];

  rule.conditions = rawConditions.map((c: ConditionRow) => mapCondition(c));
  rule.actions = rawActions.map((a: ActionRow) => mapAction(a));

  return rule;
}

export async function listRules(
  promoterId: string,
  filters: RuleFilters,
  db: RuleDB,
): Promise<Rule[]> {
  const conditions: string[] = ['r.promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.branchId !== undefined) {
    conditions.push(`r.branch_id = $${idx++}`);
    params.push(filters.branchId);
  }
  if (filters.serviceId !== undefined) {
    conditions.push(`r.service_id = $${idx++}`);
    params.push(filters.serviceId);
  }
  if (filters.ruleType !== undefined) {
    conditions.push(`r.rule_type = $${idx++}`);
    params.push(filters.ruleType);
  }
  if (filters.isActive !== undefined) {
    conditions.push(`r.is_active = $${idx++}`);
    params.push(filters.isActive);
  }

  const { rows } = await db.query<RuleRow>(
    `SELECT r.* FROM reservations.rules r
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.priority DESC, r.created_at ASC`,
    params,
  );

  return rows.map(mapRule);
}

export async function updateRule(
  ruleId: string,
  input: RuleUpdateInput,
  db: RuleDB,
): Promise<Rule> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) { sets.push(`name = $${idx++}`); params.push(input.name); }
  if (input.description !== undefined) { sets.push(`description = $${idx++}`); params.push(input.description); }
  if (input.branchId !== undefined) { sets.push(`branch_id = $${idx++}`); params.push(input.branchId); }
  if (input.serviceId !== undefined) { sets.push(`service_id = $${idx++}`); params.push(input.serviceId); }
  if (input.ruleType !== undefined) { sets.push(`rule_type = $${idx++}`); params.push(input.ruleType); }
  if (input.triggerEvent !== undefined) { sets.push(`trigger_event = $${idx++}`); params.push(input.triggerEvent); }
  if (input.priority !== undefined) { sets.push(`priority = $${idx++}`); params.push(input.priority); }
  if (input.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(input.isActive); }
  if (input.stopOnMatch !== undefined) { sets.push(`stop_on_match = $${idx++}`); params.push(input.stopOnMatch); }

  if (sets.length === 0) {
    return getRule(ruleId, db);
  }

  params.push(ruleId);
  await db.execute(
    `UPDATE reservations.rules SET ${sets.join(', ')} WHERE id = $${idx}`,
    params,
  );

  const { rows } = await db.query<RuleRow>(
    `SELECT * FROM reservations.rules WHERE id = $1`,
    [ruleId],
  );

  if (!rows[0]) {
    throw new RuleError('RULE_NOT_FOUND');
  }

  return mapRule(rows[0]);
}

export async function deleteRule(ruleId: string, db: RuleDB): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.rules WHERE id = $1`,
    [ruleId],
  );
}

export async function addCondition(
  ruleId: string,
  input: ConditionInput,
  db: RuleDB,
): Promise<RuleCondition> {
  await db.execute(
    `INSERT INTO reservations.rule_conditions
       (rule_id, condition_type, operator, value_a, value_b, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      ruleId,
      input.conditionType,
      input.operator,
      input.valueA,
      input.valueB ?? null,
      input.sortOrder ?? 0,
    ],
  );

  const { rows } = await db.query<ConditionRow>(
    `SELECT * FROM reservations.rule_conditions
     WHERE rule_id = $1 AND condition_type = $2 AND value_a = $3
     ORDER BY sort_order DESC LIMIT 1`,
    [ruleId, input.conditionType, input.valueA],
  );

  if (!rows[0]) {
    throw new RuleError('CONDITION_NOT_FOUND');
  }

  return mapCondition(rows[0]);
}

export async function removeCondition(conditionId: string, db: RuleDB): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.rule_conditions WHERE id = $1`,
    [conditionId],
  );
}

export async function addAction(
  ruleId: string,
  input: ActionInput,
  db: RuleDB,
): Promise<RuleAction> {
  await db.execute(
    `INSERT INTO reservations.rule_actions
       (rule_id, action_type, action_value, action_message, sort_order)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      ruleId,
      input.actionType,
      input.actionValue ?? null,
      input.actionMessage ?? null,
      input.sortOrder ?? 0,
    ],
  );

  const { rows } = await db.query<ActionRow>(
    `SELECT * FROM reservations.rule_actions
     WHERE rule_id = $1 AND action_type = $2
     ORDER BY sort_order DESC LIMIT 1`,
    [ruleId, input.actionType],
  );

  if (!rows[0]) {
    throw new RuleError('ACTION_NOT_FOUND');
  }

  return mapAction(rows[0]);
}

export async function removeAction(actionId: string, db: RuleDB): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.rule_actions WHERE id = $1`,
    [actionId],
  );
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleError, isRuleError } from '../lib/rules-errors';
import {
  createRule,
  getRule,
  listRules,
  updateRule,
  deleteRule,
  addCondition,
  removeCondition,
  addAction,
  removeAction,
} from '../services/rule.service';
import {
  evaluateCondition,
  executeAction,
  evaluateRules,
  type EvaluationContext,
  type EvaluationResult,
} from '../services/rule-evaluator.service';
import {
  createApprovalRequest,
  getApprovalRequest,
  listPendingApprovals,
  approveRequest,
  rejectRequest,
  expireOldRequests,
} from '../services/approval.service';

// ---------------------------------------------------------------------------
// makeDb helper — query() increments index; execute() does NOT
// ---------------------------------------------------------------------------

function makeDb(responses: unknown[][] = []) {
  let i = 0;
  return {
    query: vi.fn(async () => ({ rows: responses[i++] ?? [] })),
    execute: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROMOTER_ID = 'promoter-uuid-0001';
const RULE_ID = 'rule-uuid-0001';
const RULE_ID_2 = 'rule-uuid-0002';
const CONDITION_ID = 'condition-uuid-0001';
const ACTION_ID = 'action-uuid-0001';
const USER_ID = 'user-uuid-0001';
const SLOT_ID = 'slot-uuid-0001';
const SERVICE_ID = 'service-uuid-0001';
const BRANCH_ID = 'branch-uuid-0001';
const REVIEWER_ID = 'reviewer-uuid-0001';
const REQUEST_ID = 'request-uuid-0001';

const RULE_ROW = {
  id: RULE_ID,
  promoter_id: PROMOTER_ID,
  branch_id: null,
  service_id: SERVICE_ID,
  name: 'Advance Notice Rule',
  description: 'Require 24h advance booking',
  rule_type: 'advance_notice',
  trigger_event: 'before_hold',
  priority: 10,
  is_active: true,
  stop_on_match: false,
  created_at: '2026-04-07T10:00:00.000Z',
};

const RULE_ROW_2 = {
  ...RULE_ROW,
  id: RULE_ID_2,
  name: 'VIP Booking Window',
  rule_type: 'booking_window',
  priority: 20,
};

const CONDITION_ROW = {
  id: CONDITION_ID,
  rule_id: RULE_ID,
  condition_type: 'advance_hours',
  operator: 'lt',
  value_a: '24',
  value_b: null,
  sort_order: 0,
};

const ACTION_ROW = {
  id: ACTION_ID,
  rule_id: RULE_ID,
  action_type: 'block',
  action_value: null,
  action_message: 'Must book at least 24 hours in advance.',
  sort_order: 0,
};

const APPROVAL_ROW = {
  id: REQUEST_ID,
  rule_id: RULE_ID,
  booking_id: null,
  slot_id: SLOT_ID,
  user_id: USER_ID,
  promoter_id: PROMOTER_ID,
  status: 'pending',
  request_data: { quantity: 3 },
  reviewer_id: null,
  reviewer_notes: null,
  requested_at: '2026-04-07T10:00:00.000Z',
  reviewed_at: null,
  expires_at: '2026-04-09T10:00:00.000Z',
  rule_name: 'Group Approval Rule',
  rule_type: 'approval',
};

const BASE_CONTEXT: EvaluationContext = {
  userId: USER_ID,
  promoterId: PROMOTER_ID,
  slotId: SLOT_ID,
  serviceId: SERVICE_ID,
  branchId: BRANCH_ID,
  quantity: 1,
  advanceHours: 48,
  dayOfWeek: 1, // Monday
  timeOfDay: '14:00',
  userRole: 'member',
  userBookingCount: 0,
};

// ---------------------------------------------------------------------------
// Rule CRUD
// ---------------------------------------------------------------------------

describe('Rule CRUD', () => {
  it('1. createRule — valid', async () => {
    const db = makeDb([[RULE_ROW]]);
    const rule = await createRule(PROMOTER_ID, {
      name: 'Advance Notice Rule',
      ruleType: 'advance_notice',
      serviceId: SERVICE_ID,
      priority: 10,
    }, db);

    expect(rule.id).toBe(RULE_ID);
    expect(rule.name).toBe('Advance Notice Rule');
    expect(rule.ruleType).toBe('advance_notice');
    expect(rule.priority).toBe(10);
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('2. createRule — duplicate → RULE_DUPLICATE', async () => {
    // query returns empty rows → simulates duplicate (insert succeeded but select finds nothing)
    const db = makeDb([[]]); // empty result after insert
    try {
      await createRule(PROMOTER_ID, { name: 'Advance Notice Rule', ruleType: 'advance_notice' }, db);
      expect.fail('should throw');
    } catch (err) {
      expect(isRuleError(err)).toBe(true);
      expect((err as RuleError).code).toBe('RULE_DUPLICATE');
    }
  });

  it('3. getRule — with conditions + actions', async () => {
    const ruleWithRelations = {
      ...RULE_ROW,
      conditions: [CONDITION_ROW],
      actions: [ACTION_ROW],
    };
    const db = makeDb([[ruleWithRelations]]);
    const rule = await getRule(RULE_ID, db);

    expect(rule.id).toBe(RULE_ID);
    expect(rule.conditions).toHaveLength(1);
    expect(rule.actions).toHaveLength(1);
    expect(rule.conditions![0].conditionType).toBe('advance_hours');
    expect(rule.actions![0].actionType).toBe('block');
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('4. listRules — filter by rule_type', async () => {
    const db = makeDb([[RULE_ROW]]);
    const rules = await listRules(PROMOTER_ID, { ruleType: 'advance_notice' }, db);

    expect(rules).toHaveLength(1);
    expect(rules[0].ruleType).toBe('advance_notice');
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('5. listRules — filter by is_active, ordered by priority', async () => {
    const db = makeDb([[RULE_ROW_2, RULE_ROW]]); // already ordered by priority DESC
    const rules = await listRules(PROMOTER_ID, { isActive: true }, db);

    expect(rules).toHaveLength(2);
    expect(rules[0].priority).toBe(20);
    expect(rules[1].priority).toBe(10);
  });

  it('6. updateRule — partial', async () => {
    const updatedRow = { ...RULE_ROW, is_active: false };
    const db = makeDb([[updatedRow]]);
    const rule = await updateRule(RULE_ID, { isActive: false }, db);

    expect(rule.isActive).toBe(false);
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('7. deleteRule — removes rule', async () => {
    const db = makeDb([]);
    await deleteRule(RULE_ID, db);

    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM reservations.rules'),
      [RULE_ID],
    );
  });

  it('8. addCondition — valid', async () => {
    const db = makeDb([[CONDITION_ROW]]);
    const condition = await addCondition(RULE_ID, {
      conditionType: 'advance_hours',
      operator: 'lt',
      valueA: '24',
    }, db);

    expect(condition.id).toBe(CONDITION_ID);
    expect(condition.conditionType).toBe('advance_hours');
    expect(condition.operator).toBe('lt');
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('9. removeCondition — deletes', async () => {
    const db = makeDb([]);
    await removeCondition(CONDITION_ID, db);

    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM reservations.rule_conditions'),
      [CONDITION_ID],
    );
  });

  it('10. addAction — valid', async () => {
    const db = makeDb([[ACTION_ROW]]);
    const action = await addAction(RULE_ID, {
      actionType: 'block',
      actionMessage: 'Must book at least 24 hours in advance.',
    }, db);

    expect(action.id).toBe(ACTION_ID);
    expect(action.actionType).toBe('block');
    expect(action.actionMessage).toBe('Must book at least 24 hours in advance.');
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('11. removeAction — deletes', async () => {
    const db = makeDb([]);
    await removeAction(ACTION_ID, db);

    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM reservations.rule_actions'),
      [ACTION_ID],
    );
  });
});

// ---------------------------------------------------------------------------
// Condition evaluation (pure functions — no DB)
// ---------------------------------------------------------------------------

describe('Condition evaluation (pure)', () => {
  it('12. day_of_week IN [1,2,3] — Monday matches', () => {
    const condition = {
      id: 'c1', ruleId: RULE_ID,
      conditionType: 'day_of_week' as const,
      operator: 'in' as const,
      valueA: '1,2,3',
      valueB: null,
      sortOrder: 0,
    };
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, dayOfWeek: 1 })).toBe(true);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, dayOfWeek: 4 })).toBe(false);
  });

  it('13. day_of_week NOT_IN [6,0] — weekend (Saturday/Sunday) does not match', () => {
    const condition = {
      id: 'c2', ruleId: RULE_ID,
      conditionType: 'day_of_week' as const,
      operator: 'not_in' as const,
      valueA: '6,0',
      valueB: null,
      sortOrder: 0,
    };
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, dayOfWeek: 6 })).toBe(false);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, dayOfWeek: 0 })).toBe(false);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, dayOfWeek: 3 })).toBe(true);
  });

  it('14. advance_hours GTE 24 — 48h passes', () => {
    const condition = {
      id: 'c3', ruleId: RULE_ID,
      conditionType: 'advance_hours' as const,
      operator: 'gte' as const,
      valueA: '24',
      valueB: null,
      sortOrder: 0,
    };
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, advanceHours: 48 })).toBe(true);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, advanceHours: 24 })).toBe(true);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, advanceHours: 12 })).toBe(false);
  });

  it('15. advance_hours LT 24 — 2h fails (condition passes, meaning booking window violation)', () => {
    const condition = {
      id: 'c4', ruleId: RULE_ID,
      conditionType: 'advance_hours' as const,
      operator: 'lt' as const,
      valueA: '24',
      valueB: null,
      sortOrder: 0,
    };
    // 2h < 24h → condition true (violation detected)
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, advanceHours: 2 })).toBe(true);
    // 48h is NOT < 24h → condition false (no violation)
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, advanceHours: 48 })).toBe(false);
  });

  it('16. quantity GTE 3 — group booking matches', () => {
    const condition = {
      id: 'c5', ruleId: RULE_ID,
      conditionType: 'quantity' as const,
      operator: 'gte' as const,
      valueA: '3',
      valueB: null,
      sortOrder: 0,
    };
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, quantity: 3 })).toBe(true);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, quantity: 5 })).toBe(true);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, quantity: 2 })).toBe(false);
  });

  it('17. user_role EQ vip — matches', () => {
    const condition = {
      id: 'c6', ruleId: RULE_ID,
      conditionType: 'user_role' as const,
      operator: 'eq' as const,
      valueA: 'vip',
      valueB: null,
      sortOrder: 0,
    };
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, userRole: 'vip' })).toBe(true);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, userRole: 'member' })).toBe(false);
  });

  it('18. always — always returns true', () => {
    const condition = {
      id: 'c7', ruleId: RULE_ID,
      conditionType: 'always' as const,
      operator: 'eq' as const,
      valueA: 'true',
      valueB: null,
      sortOrder: 0,
    };
    expect(evaluateCondition(condition, BASE_CONTEXT)).toBe(true);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, userRole: 'guest', quantity: 0 })).toBe(true);
  });

  it('19. between time range — 14:00 is between 12:00 and 18:00', () => {
    const condition = {
      id: 'c8', ruleId: RULE_ID,
      conditionType: 'time_of_day' as const,
      operator: 'between' as const,
      valueA: '12:00',
      valueB: '18:00',
      sortOrder: 0,
    };
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, timeOfDay: '14:00' })).toBe(true);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, timeOfDay: '19:00' })).toBe(false);
    expect(evaluateCondition(condition, { ...BASE_CONTEXT, timeOfDay: '11:59' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule evaluation (full engine with DB)
// ---------------------------------------------------------------------------

describe('Rule evaluation (full engine)', () => {
  it('20. evaluateRules — no rules → allowed=true, no discount', async () => {
    const db = makeDb([[]]); // empty rules
    const result = await evaluateRules(BASE_CONTEXT, db);

    expect(result.allowed).toBe(true);
    expect(result.discountBasisPoints).toBe(0);
    expect(result.requiresApproval).toBe(false);
    expect(result.appliedRules).toHaveLength(0);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('21. evaluateRules — block rule matches → allowed=false, blockedByRule set', async () => {
    const ruleWithBlock = {
      ...RULE_ROW,
      conditions: [{ ...CONDITION_ROW, condition_type: 'advance_hours', operator: 'lt', value_a: '24' }],
      actions: [{ ...ACTION_ROW, action_type: 'block', action_message: 'Too late to book!' }],
    };
    const db = makeDb([[ruleWithBlock]]);
    const context = { ...BASE_CONTEXT, advanceHours: 2 }; // 2h < 24h → condition fires
    const result = await evaluateRules(context, db);

    expect(result.allowed).toBe(false);
    expect(result.blockedByRule).toBe('Advance Notice Rule');
    expect(result.blockedMessage).toBe('Too late to book!');
    expect(result.appliedRules).toContain('Advance Notice Rule');
  });

  it('22. evaluateRules — block rule conditions don\'t match → allowed=true', async () => {
    const ruleWithBlock = {
      ...RULE_ROW,
      conditions: [{ ...CONDITION_ROW, condition_type: 'advance_hours', operator: 'lt', value_a: '24' }],
      actions: [{ ...ACTION_ROW, action_type: 'block' }],
    };
    const db = makeDb([[ruleWithBlock]]);
    const context = { ...BASE_CONTEXT, advanceHours: 48 }; // 48h is NOT < 24h → condition false
    const result = await evaluateRules(context, db);

    expect(result.allowed).toBe(true);
    expect(result.blockedByRule).toBeUndefined();
    expect(result.appliedRules).toHaveLength(0);
  });

  it('23. evaluateRules — discount rule matches → discountBasisPoints set', async () => {
    const discountRule = {
      ...RULE_ROW,
      name: 'Early Bird Discount',
      rule_type: 'discount',
      conditions: [{ ...CONDITION_ROW, condition_type: 'advance_hours', operator: 'gte', value_a: '168' }],
      actions: [{ ...ACTION_ROW, action_type: 'apply_discount', action_value: '2000', action_message: null }],
    };
    const db = makeDb([[discountRule]]);
    const context = { ...BASE_CONTEXT, advanceHours: 200 }; // 200h >= 168h (7 days)
    const result = await evaluateRules(context, db);

    expect(result.allowed).toBe(true);
    expect(result.discountBasisPoints).toBe(2000); // 20%
  });

  it('24. evaluateRules — multiple discounts → summed', async () => {
    const discount1 = {
      ...RULE_ROW,
      name: 'Early Bird',
      conditions: [{ ...CONDITION_ROW, condition_type: 'always', operator: 'eq', value_a: 'true' }],
      actions: [{ ...ACTION_ROW, action_type: 'apply_discount', action_value: '1000', action_message: null }],
    };
    const discount2 = {
      ...RULE_ROW,
      id: RULE_ID_2,
      name: 'VIP Discount',
      conditions: [{ ...CONDITION_ROW, id: 'c9', condition_type: 'user_role', operator: 'eq', value_a: 'vip' }],
      actions: [{ ...ACTION_ROW, id: 'a9', action_type: 'apply_discount', action_value: '500', action_message: null }],
    };
    const db = makeDb([[discount1, discount2]]);
    const context = { ...BASE_CONTEXT, userRole: 'vip' };
    const result = await evaluateRules(context, db);

    expect(result.discountBasisPoints).toBe(1500); // 10% + 5%
    expect(result.appliedRules).toHaveLength(2);
  });

  it('25. evaluateRules — approval rule → requiresApproval=true', async () => {
    const approvalRule = {
      ...RULE_ROW,
      name: 'Group Approval Rule',
      rule_type: 'approval',
      conditions: [{ ...CONDITION_ROW, condition_type: 'quantity', operator: 'gte', value_a: '3' }],
      actions: [{ ...ACTION_ROW, action_type: 'require_approval', action_message: 'Group needs manager approval' }],
    };
    const db = makeDb([[approvalRule]]);
    const context = { ...BASE_CONTEXT, quantity: 4 };
    const result = await evaluateRules(context, db);

    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it('26. evaluateRules — stop_on_match=true → stops after first match', async () => {
    const rule1 = {
      ...RULE_ROW,
      name: 'First Rule',
      stop_on_match: true,
      priority: 20,
      conditions: [{ ...CONDITION_ROW, condition_type: 'always', operator: 'eq', value_a: 'true' }],
      actions: [{ ...ACTION_ROW, action_type: 'apply_discount', action_value: '500', action_message: null }],
    };
    const rule2 = {
      ...RULE_ROW,
      id: RULE_ID_2,
      name: 'Second Rule',
      stop_on_match: false,
      priority: 10,
      conditions: [{ ...CONDITION_ROW, id: 'c10', condition_type: 'always', operator: 'eq', value_a: 'true' }],
      actions: [{ ...ACTION_ROW, id: 'a10', action_type: 'apply_discount', action_value: '500', action_message: null }],
    };
    const db = makeDb([[rule1, rule2]]); // ordered by priority DESC
    const result = await evaluateRules(BASE_CONTEXT, db);

    // Only first rule should fire due to stop_on_match
    expect(result.discountBasisPoints).toBe(500);
    expect(result.appliedRules).toHaveLength(1);
    expect(result.appliedRules[0]).toBe('First Rule');
  });

  it('27. evaluateRules — priority ordering (higher priority evaluated first)', async () => {
    const lowPriority = {
      ...RULE_ROW,
      id: RULE_ID_2,
      name: 'Low Priority Block',
      priority: 5,
      stop_on_match: true,
      conditions: [{ ...CONDITION_ROW, id: 'c11', condition_type: 'always', operator: 'eq', value_a: 'true' }],
      actions: [{ ...ACTION_ROW, id: 'a11', action_type: 'block', action_message: 'Low priority block' }],
    };
    const highPriority = {
      ...RULE_ROW,
      name: 'High Priority Allow',
      priority: 50,
      stop_on_match: true,
      conditions: [{ ...CONDITION_ROW, condition_type: 'always', operator: 'eq', value_a: 'true' }],
      actions: [{ ...ACTION_ROW, action_type: 'allow', action_message: null }],
    };
    // DB returns high priority first (priority DESC)
    const db = makeDb([[highPriority, lowPriority]]);
    const result = await evaluateRules(BASE_CONTEXT, db);

    // High priority allow fires first and stops → allowed=true
    expect(result.allowed).toBe(true);
    expect(result.appliedRules[0]).toBe('High Priority Allow');
    expect(result.appliedRules).toHaveLength(1);
  });

  it('28. evaluateRules — allow action overrides previous block', async () => {
    const blockRule = {
      ...RULE_ROW,
      name: 'Block Rule',
      priority: 10,
      conditions: [{ ...CONDITION_ROW, condition_type: 'always', operator: 'eq', value_a: 'true' }],
      actions: [{ ...ACTION_ROW, action_type: 'block', action_message: 'Blocked' }],
    };
    const vipAllow = {
      ...RULE_ROW,
      id: RULE_ID_2,
      name: 'VIP Allow',
      priority: 5,
      conditions: [{ ...CONDITION_ROW, id: 'c12', condition_type: 'user_role', operator: 'eq', value_a: 'vip' }],
      actions: [{ ...ACTION_ROW, id: 'a12', action_type: 'allow', action_message: null }],
    };
    // Higher priority block fires first, then lower priority allow overrides
    const db = makeDb([[blockRule, vipAllow]]);
    const context = { ...BASE_CONTEXT, userRole: 'vip' };
    const result = await evaluateRules(context, db);

    expect(result.allowed).toBe(true);
    expect(result.blockedByRule).toBeUndefined();
    expect(result.appliedRules).toContain('VIP Allow');
  });
});

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

describe('Approvals', () => {
  it('29. createApprovalRequest — valid', async () => {
    const db = makeDb([[APPROVAL_ROW]]);
    const approval = await createApprovalRequest({
      ruleId: RULE_ID,
      slotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      requestData: { quantity: 3 },
    }, db);

    expect(approval.id).toBe(REQUEST_ID);
    expect(approval.status).toBe('pending');
    expect(approval.userId).toBe(USER_ID);
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('30. getApprovalRequest — with rule info', async () => {
    const db = makeDb([[APPROVAL_ROW]]);
    const approval = await getApprovalRequest(REQUEST_ID, db);

    expect(approval.id).toBe(REQUEST_ID);
    expect(approval.ruleName).toBe('Group Approval Rule');
    expect(approval.ruleType).toBe('approval');
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('31. listPendingApprovals — only pending', async () => {
    const db = makeDb([[APPROVAL_ROW, { ...APPROVAL_ROW, id: 'req-2' }]]);
    const approvals = await listPendingApprovals(PROMOTER_ID, db);

    expect(approvals).toHaveLength(2);
    expect(approvals.every(a => a.status === 'pending')).toBe(true);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('32. approveRequest — status=approved', async () => {
    const pendingRow = { ...APPROVAL_ROW, status: 'pending' };
    const approvedRow = {
      ...APPROVAL_ROW,
      status: 'approved',
      reviewer_id: REVIEWER_ID,
      reviewer_notes: 'All good',
      reviewed_at: '2026-04-07T11:00:00.000Z',
    };
    const db = makeDb([[pendingRow], [approvedRow]]);
    const approval = await approveRequest(REQUEST_ID, REVIEWER_ID, 'All good', db);

    expect(approval.status).toBe('approved');
    expect(approval.reviewerId).toBe(REVIEWER_ID);
    expect(approval.reviewerNotes).toBe('All good');
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('33. rejectRequest — status=rejected', async () => {
    const pendingRow = { ...APPROVAL_ROW, status: 'pending' };
    const rejectedRow = {
      ...APPROVAL_ROW,
      status: 'rejected',
      reviewer_id: REVIEWER_ID,
      reviewer_notes: 'Not allowed',
      reviewed_at: '2026-04-07T11:00:00.000Z',
    };
    const db = makeDb([[pendingRow], [rejectedRow]]);
    const approval = await rejectRequest(REQUEST_ID, REVIEWER_ID, 'Not allowed', db);

    expect(approval.status).toBe('rejected');
    expect(approval.reviewerId).toBe(REVIEWER_ID);
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('34. expireOldRequests — updates expired', async () => {
    const expiredRows = [
      { id: 'req-exp-1' },
      { id: 'req-exp-2' },
    ];
    const db = makeDb([expiredRows]);
    const count = await expireOldRequests(db);

    expect(count).toBe(2);
    expect(db.query).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'expired'"),
      expect.any(Array),
    );
  });

  it('35. Full flow: rule with approval → evaluateRules → createApprovalRequest → approve → booking continues', async () => {
    // Step 1: Evaluate rules — result requires approval
    const approvalRule = {
      ...RULE_ROW,
      name: 'Group Approval Rule',
      rule_type: 'approval',
      conditions: [{ ...CONDITION_ROW, condition_type: 'quantity', operator: 'gte', value_a: '3' }],
      actions: [{ ...ACTION_ROW, action_type: 'require_approval', action_message: null }],
    };
    const evalDb = makeDb([[approvalRule]]);
    const evalContext = { ...BASE_CONTEXT, quantity: 4 };
    const evalResult = await evaluateRules(evalContext, evalDb);

    expect(evalResult.allowed).toBe(true);
    expect(evalResult.requiresApproval).toBe(true);

    // Step 2: Create approval request
    const createDb = makeDb([[APPROVAL_ROW]]);
    const approvalRequest = await createApprovalRequest({
      ruleId: RULE_ID,
      slotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      requestData: { quantity: 4 },
    }, createDb);

    expect(approvalRequest.status).toBe('pending');

    // Step 3: Manager approves
    const pendingRow = { ...APPROVAL_ROW, status: 'pending' };
    const approvedRow = { ...APPROVAL_ROW, status: 'approved', reviewer_id: REVIEWER_ID };
    const approveDb = makeDb([[pendingRow], [approvedRow]]);
    const approved = await approveRequest(approvalRequest.id, REVIEWER_ID, null, approveDb);

    expect(approved.status).toBe('approved');

    // Step 4: Now booking can proceed
    expect(approved.status === 'approved').toBe(true);
  });
});

// Group Payment Service — création, invitation, acceptance, payment tracking
// Each upsert creates invites; token validation on accept; settlement calculation.

import { randomBytes } from 'crypto';
import type {
  GroupPayment,
  GroupMember,
  GroupPaymentInvite,
  CreateGroupPaymentOptions,
  AddMemberOptions,
  InviteMemberOptions,
  AcceptInviteOptions,
  RecordMemberPaymentOptions,
  SettlementReport,
  SettlementEntry,
  CalculateSplitsResult,
  GroupPaymentResponse,
  DbAdapter,
  EmailServiceAdapter,
  GroupPaymentStatus,
  GroupMemberStatus,
} from '../lib/types';
import {
  GroupPaymentNotFoundError,
  GroupPaymentInviteExpiredError,
  GroupPaymentInviteNotFoundError,
  InvalidGroupPaymentStrategyError,
  GroupPaymentStatusError,
  DuplicateGroupMemberError,
  UnauthorizedGroupPaymentError,
} from '../lib/types';

interface ServiceDeps {
  db: DbAdapter;
  email: EmailServiceAdapter;
}

// ─── Helpers ──────────────────────────────────────────────────

function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  // In production, use proper hashing. For now, simple SHA256 mock.
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── createGroupPayment ────────────────────────────────────────

/**
 * Create a new group payment and send invites to members.
 * - Calculates total from orderIds
 * - Creates GroupPayment record
 * - Adds group owner as first member
 * - Generates invite tokens for non-owner members
 * - Sends invitation emails
 */
export async function createGroupPayment(
  deps: ServiceDeps,
  groupOwnerId: string,
  options: CreateGroupPaymentOptions,
): Promise<{ groupPaymentId: string; inviteLinks: Array<{ email: string; token: string }> }> {
  if (!['equal', 'proportional', 'custom'].includes(options.strategy)) {
    throw new InvalidGroupPaymentStrategyError(options.strategy);
  }

  // Validate we have at least owner + 1 member
  if (options.memberEmails.length < 1) {
    throw new Error('Must invite at least one additional member');
  }

  return deps.db.transaction(async (db) => {
    // Get order details to calculate total
    const orders = await db.query<{ id: string; total_amount_halire: number }>(
      `SELECT id, total_amount_halire FROM orders WHERE id = ANY($1::text[])`,
      [options.orderIds],
    );

    if (orders.length !== options.orderIds.length) {
      throw new Error('One or more orders not found');
    }

    const totalAmountHalire = orders.reduce((sum, o) => sum + o.total_amount_halire, 0);

    // Create GroupPayment
    const [groupRow] = await db.query<{ id: string }>(
      `INSERT INTO orders.group_payments
         (group_owner_id, event_id, total_amount_halire, splitter_strategy, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())
       RETURNING id`,
      [groupOwnerId, options.eventId, totalAmountHalire, options.strategy],
    );

    const groupPaymentId = groupRow.id;

    // Add group owner as first member (no owed amount yet, will be calculated)
    await db.execute(
      `INSERT INTO orders.group_members
         (group_payment_id, user_id, order_id, amount_owed_halire, amount_paid_halire, status, joined_at)
       VALUES ($1, $2, $3, $4, 0, 'pending', NOW())`,
      [groupPaymentId, groupOwnerId, options.orderIds[0] || '', 0],
    );

    // Calculate splits (will set actual amounts)
    const splits = await calculateSplits(deps.db, groupPaymentId, options.strategy);

    // Update owner's owed amount
    const ownerSplit = splits.splits.find((s) => s.userId === groupOwnerId);
    if (ownerSplit) {
      await db.execute(
        `UPDATE orders.group_members
         SET amount_owed_halire = $1
         WHERE group_payment_id = $2 AND user_id = $3`,
        [ownerSplit.amountHalire, groupPaymentId, groupOwnerId],
      );
    }

    // Generate invite tokens for each non-owner email
    const inviteLinks: Array<{ email: string; token: string }> = [];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    for (const email of options.memberEmails) {
      const token = generateInviteToken();
      const tokenHash = hashToken(token);

      await db.execute(
        `INSERT INTO orders.group_invites
           (group_payment_id, to_email, token, expires_at, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [groupPaymentId, email, tokenHash, expiresAt],
      );

      inviteLinks.push({ email, token });

      // Send email in background (fire and forget)
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tixly.cz';
      const inviteLink = `${baseUrl}/groups/${groupPaymentId}/accept?token=${token}`;
      deps.email.sendGroupInvite(email, groupOwnerId, inviteLink, expiresAt).catch(() => {});
    }

    return { groupPaymentId, inviteLinks };
  });
}

// ─── addMember ─────────────────────────────────────────────────

/**
 * Add a member directly to an existing group (no invitation).
 * Only owner can call this. Member must not already be in group.
 */
export async function addMember(
  deps: ServiceDeps,
  options: AddMemberOptions,
  requestingUserId: string,
): Promise<GroupMember> {
  return deps.db.transaction(async (db) => {
    // Verify group exists and requester is owner
    const [group] = await db.query<{ group_owner_id: string; status: string }>(
      `SELECT group_owner_id, status FROM orders.group_payments WHERE id = $1`,
      [options.groupPaymentId],
    );

    if (!group) {
      throw new GroupPaymentNotFoundError('Group payment not found');
    }

    if (group.group_owner_id !== requestingUserId) {
      throw new UnauthorizedGroupPaymentError('Only group owner can add members');
    }

    // Check if user already a member
    const [existing] = await db.query<{ id: string }>(
      `SELECT id FROM orders.group_members
       WHERE group_payment_id = $1 AND user_id = $2`,
      [options.groupPaymentId, options.userId],
    );

    if (existing) {
      throw new DuplicateGroupMemberError('User is already a member of this group');
    }

    // Add member
    const [member] = await db.query<{
      id: string; amount_owed_halire: number; status: string; joined_at: Date;
    }>(
      `INSERT INTO orders.group_members
         (group_payment_id, user_id, order_id, amount_owed_halire, amount_paid_halire, status, joined_at)
       VALUES ($1, $2, $3, $4, 0, 'pending', NOW())
       RETURNING id, amount_owed_halire, status, joined_at`,
      [options.groupPaymentId, options.userId, options.orderId, options.amountOwedHalire],
    );

    return {
      id: member.id,
      groupPaymentId: options.groupPaymentId,
      userId: options.userId,
      orderId: options.orderId,
      amountOwedHalire: member.amount_owed_halire,
      amountPaidHalire: 0,
      status: member.status as GroupMemberStatus,
      joinedAt: member.joined_at,
    };
  });
}

// ─── inviteMember ─────────────────────────────────────────────

/**
 * Invite a member by email to join an existing group.
 * Only owner can call this.
 */
export async function inviteMember(
  deps: ServiceDeps,
  options: InviteMemberOptions,
  requestingUserId: string,
): Promise<{ inviteLink: string; expiresAt: Date }> {
  return deps.db.transaction(async (db) => {
    // Verify group exists and requester is owner
    const [group] = await db.query<{ group_owner_id: string }>(
      `SELECT group_owner_id FROM orders.group_payments WHERE id = $1`,
      [options.groupPaymentId],
    );

    if (!group) {
      throw new GroupPaymentNotFoundError('Group payment not found');
    }

    if (group.group_owner_id !== requestingUserId) {
      throw new UnauthorizedGroupPaymentError('Only group owner can invite members');
    }

    // Check if this email already has a pending or accepted invite
    const [existing] = await db.query<{ joined_at: Date | null }>(
      `SELECT joined_at FROM orders.group_invites
       WHERE group_payment_id = $1 AND to_email = $2 AND (joined_at IS NULL OR joined_at IS NOT NULL)`,
      [options.groupPaymentId, options.toEmail],
    );

    if (existing && existing.joined_at) {
      throw new DuplicateGroupMemberError('User has already joined this group');
    }

    // Generate new token
    const token = generateInviteToken();
    const tokenHash = hashToken(token);

    const expiresInDays = options.expiresInDays ?? 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Upsert invite (replace if already exists but not accepted)
    await db.execute(
      `INSERT INTO orders.group_invites
         (group_payment_id, to_email, token, expires_at, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (group_payment_id, to_email) WHERE joined_at IS NULL
       DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at`,
      [options.groupPaymentId, options.toEmail, tokenHash, expiresAt],
    );

    // Send email in background
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tixly.cz';
    const inviteLink = `${baseUrl}/groups/${options.groupPaymentId}/accept?token=${token}`;
    deps.email.sendGroupInvite(options.toEmail, requestingUserId, inviteLink, expiresAt).catch(() => {});

    return { inviteLink, expiresAt };
  });
}

// ─── acceptInvite ─────────────────────────────────────────────

/**
 * Accept an invite to join a group payment.
 * Validates token, checks expiration, links user to group.
 */
export async function acceptInvite(
  deps: ServiceDeps,
  options: AcceptInviteOptions,
): Promise<GroupMember> {
  return deps.db.transaction(async (db) => {
    const tokenHash = hashToken(options.token);

    // Find invite by token hash
    const [invite] = await db.query<{
      id: string;
      group_payment_id: string;
      to_email: string;
      expires_at: Date;
      joined_at: Date | null;
      joined_user_id: string | null;
    }>(
      `SELECT id, group_payment_id, to_email, expires_at, joined_at, joined_user_id
       FROM orders.group_invites WHERE token = $1`,
      [tokenHash],
    );

    if (!invite) {
      throw new GroupPaymentInviteNotFoundError('Invalid invite token');
    }

    // Check expiration
    if (new Date() > invite.expires_at) {
      throw new GroupPaymentInviteExpiredError('Invite token has expired');
    }

    // Check if already accepted
    if (invite.joined_at) {
      throw new Error('Invite has already been accepted');
    }

    // Get group to calculate member amount
    const [group] = await db.query<{ total_amount_halire: number; splitter_strategy: string }>(
      `SELECT total_amount_halire, splitter_strategy FROM orders.group_payments
       WHERE id = $1`,
      [invite.group_payment_id],
    );

    if (!group) {
      throw new GroupPaymentNotFoundError('Group payment not found');
    }

    // Check if user already a member
    const [existing] = await db.query<{ id: string }>(
      `SELECT id FROM orders.group_members
       WHERE group_payment_id = $1 AND user_id = $2`,
      [invite.group_payment_id, options.userId],
    );

    if (existing) {
      throw new DuplicateGroupMemberError('User is already a member of this group');
    }

    // Add user as member
    const amountOwed = Math.floor(group.total_amount_halire / 2); // Placeholder, will recalculate
    const [member] = await db.query<{
      id: string; amount_owed_halire: number; status: string; joined_at: Date;
    }>(
      `INSERT INTO orders.group_members
         (group_payment_id, user_id, order_id, amount_owed_halire, amount_paid_halire, status, joined_at)
       VALUES ($1, $2, $3, $4, 0, 'pending', NOW())
       RETURNING id, amount_owed_halire, status, joined_at`,
      [invite.group_payment_id, options.userId, options.orderId, amountOwed],
    );

    // Mark invite as accepted
    await db.execute(
      `UPDATE orders.group_invites
       SET joined_at = NOW(), joined_user_id = $1
       WHERE id = $2`,
      [options.userId, invite.id],
    );

    return {
      id: member.id,
      groupPaymentId: invite.group_payment_id,
      userId: options.userId,
      orderId: options.orderId,
      amountOwedHalire: member.amount_owed_halire,
      amountPaidHalire: 0,
      status: member.status as GroupMemberStatus,
      joinedAt: member.joined_at,
    };
  });
}

// ─── calculateSplits ──────────────────────────────────────────

/**
 * Calculate how much each member owes based on strategy.
 * - equal: divide total equally
 * - proportional: split by ticket prices (requires order data)
 * - custom: use existing custom amounts
 */
export async function calculateSplits(
  db: DbAdapter,
  groupPaymentId: string,
  strategy: string,
): Promise<CalculateSplitsResult> {
  // Get group and all members
  const [group] = await db.query<{
    total_amount_halire: number; splitter_strategy: string;
  }>(
    `SELECT total_amount_halire, splitter_strategy FROM orders.group_payments WHERE id = $1`,
    [groupPaymentId],
  );

  if (!group) {
    throw new GroupPaymentNotFoundError('Group payment not found');
  }

  const members = await db.query<{
    user_id: string; order_id: string; amount_owed_halire: number;
  }>(
    `SELECT user_id, order_id, amount_owed_halire FROM orders.group_members
     WHERE group_payment_id = $1`,
    [groupPaymentId],
  );

  if (members.length === 0) {
    throw new Error('Group has no members');
  }

  const splits: Array<{ userId: string; orderId: string; amountHalire: number }> = [];
  let remainingAmount = group.total_amount_halire;

  if (strategy === 'equal') {
    // Divide equally, last member gets remainder (absorbs rounding)
    const perMember = Math.floor(group.total_amount_halire / members.length);
    let rounding = 0;

    members.forEach((m, idx) => {
      const amount = idx === members.length - 1 ? remainingAmount : perMember;
      splits.push({ userId: m.user_id, orderId: m.order_id, amountHalire: amount });
      remainingAmount -= amount;
      if (idx === members.length - 1) {
        rounding = remainingAmount;
      }
    });

    return { splits, totalHalire: group.total_amount_halire, rounding };
  }

  if (strategy === 'proportional') {
    // Split by order/ticket price
    // Get order amounts
    const orderIds = members.map((m) => m.order_id).filter(Boolean);
    if (orderIds.length === 0) {
      // Fallback to equal
      return calculateSplits(db, groupPaymentId, 'equal');
    }

    const orders = await db.query<{ id: string; total_amount_halire: number }>(
      `SELECT id, total_amount_halire FROM orders WHERE id = ANY($1::text[])`,
      [orderIds],
    );

    const orderMap = new Map(orders.map((o) => [o.id, o.total_amount_halire]));
    const totalOrderAmount = Array.from(orderMap.values()).reduce((a, b) => a + b, 0);

    if (totalOrderAmount === 0) {
      // Fallback to equal
      return calculateSplits(db, groupPaymentId, 'equal');
    }

    let rounding = 0;

    members.forEach((m, idx) => {
      const orderAmount = orderMap.get(m.order_id) || 0;
      const ratio = orderAmount / totalOrderAmount;
      const amount = Math.floor(ratio * group.total_amount_halire);
      splits.push({ userId: m.user_id, orderId: m.order_id, amountHalire: amount });
      remainingAmount -= amount;

      // Last member gets remainder
      if (idx === members.length - 1) {
        splits[splits.length - 1].amountHalire += remainingAmount;
        rounding = remainingAmount;
      }
    });

    return { splits, totalHalire: group.total_amount_halire, rounding };
  }

  if (strategy === 'custom') {
    // Use existing custom amounts from group_members
    members.forEach((m) => {
      splits.push({
        userId: m.user_id,
        orderId: m.order_id,
        amountHalire: m.amount_owed_halire,
      });
    });

    return { splits, totalHalire: group.total_amount_halire };
  }

  throw new InvalidGroupPaymentStrategyError(strategy);
}

// ─── recordMemberPayment ──────────────────────────────────────

/**
 * Record a payment from a group member.
 * Can be partial or full. Updates status to 'paid' if full.
 */
export async function recordMemberPayment(
  deps: ServiceDeps,
  options: RecordMemberPaymentOptions,
): Promise<GroupMember> {
  return deps.db.transaction(async (db) => {
    // Get current member state
    const [member] = await db.query<{
      id: string; amount_owed_halire: number; amount_paid_halire: number; status: string;
    }>(
      `SELECT id, amount_owed_halire, amount_paid_halire, status
       FROM orders.group_members
       WHERE group_payment_id = $1 AND user_id = $2`,
      [options.groupPaymentId, options.userId],
    );

    if (!member) {
      throw new Error('Member not found in group');
    }

    const newPaidAmount = member.amount_paid_halire + options.amountPaidHalire;
    const newStatus = newPaidAmount >= member.amount_owed_halire ? 'paid' : 'pending';

    // Update member payment
    const [updated] = await db.query<{
      id: string; amount_owed_halire: number; amount_paid_halire: number;
      status: string; joined_at: Date; paid_at: Date | null;
    }>(
      `UPDATE orders.group_members
       SET amount_paid_halire = $1, status = $2, paid_at = CASE WHEN $2 = 'paid' THEN NOW() ELSE paid_at END
       WHERE group_payment_id = $3 AND user_id = $4
       RETURNING id, amount_owed_halire, amount_paid_halire, status, joined_at, paid_at`,
      [newPaidAmount, newStatus, options.groupPaymentId, options.userId],
    );

    return {
      id: updated.id,
      groupPaymentId: options.groupPaymentId,
      userId: options.userId,
      orderId: '', // Not returned, would need separate query
      amountOwedHalire: updated.amount_owed_halire,
      amountPaidHalire: updated.amount_paid_halire,
      status: updated.status as GroupMemberStatus,
      joinedAt: updated.joined_at,
      paidAt: updated.paid_at || undefined,
    };
  });
}

// ─── finalizeGroupPayment ──────────────────────────────────────

/**
 * Mark group as complete (paid) once all members have paid.
 * Only callable if all members have status 'paid'.
 */
export async function finalizeGroupPayment(
  deps: ServiceDeps,
  groupPaymentId: string,
  requestingUserId: string,
): Promise<void> {
  return deps.db.transaction(async (db) => {
    // Verify requester is owner
    const [group] = await db.query<{ group_owner_id: string; status: string }>(
      `SELECT group_owner_id, status FROM orders.group_payments WHERE id = $1`,
      [groupPaymentId],
    );

    if (!group) {
      throw new GroupPaymentNotFoundError('Group payment not found');
    }

    if (group.group_owner_id !== requestingUserId) {
      throw new UnauthorizedGroupPaymentError('Only group owner can finalize');
    }

    // Check all members paid
    const [unpaid] = await db.query<{ id: string }>(
      `SELECT id FROM orders.group_members
       WHERE group_payment_id = $1 AND status != 'paid'
       LIMIT 1`,
      [groupPaymentId],
    );

    if (unpaid) {
      throw new GroupPaymentStatusError('Not all members have paid yet');
    }

    // Update group status
    await db.execute(
      `UPDATE orders.group_payments
       SET status = 'paid', updated_at = NOW()
       WHERE id = $1`,
      [groupPaymentId],
    );
  });
}

// ─── getGroupPaymentStatus ────────────────────────────────────

/**
 * Get full group state including all members.
 */
export async function getGroupPaymentStatus(
  db: DbAdapter,
  groupPaymentId: string,
): Promise<GroupPaymentResponse> {
  const [group] = await db.query<{
    id: string; group_owner_id: string; event_id: string;
    total_amount_halire: number; splitter_strategy: string;
    status: string; created_at: Date;
  }>(
    `SELECT id, group_owner_id, event_id, total_amount_halire, splitter_strategy, status, created_at
     FROM orders.group_payments WHERE id = $1`,
    [groupPaymentId],
  );

  if (!group) {
    throw new GroupPaymentNotFoundError('Group payment not found');
  }

  const members = await db.query<{
    id: string; user_id: string; order_id: string;
    amount_owed_halire: number; amount_paid_halire: number;
    status: string; joined_at: Date;
  }>(
    `SELECT id, user_id, order_id, amount_owed_halire, amount_paid_halire, status, joined_at
     FROM orders.group_members WHERE group_payment_id = $1`,
    [groupPaymentId],
  );

  return {
    id: group.id,
    groupOwnerId: group.group_owner_id,
    eventId: group.event_id,
    totalAmountHalire: group.total_amount_halire,
    strategy: group.splitter_strategy as any,
    status: group.status as GroupPaymentStatus,
    members: members.map((m) => ({
      id: m.id,
      groupPaymentId: groupPaymentId,
      userId: m.user_id,
      orderId: m.order_id,
      amountOwedHalire: m.amount_owed_halire,
      amountPaidHalire: m.amount_paid_halire,
      status: m.status as GroupMemberStatus,
      joinedAt: m.joined_at,
    })),
    createdAt: group.created_at,
  };
}

// ─── settlementReport ─────────────────────────────────────────

/**
 * Generate settlement report showing balance per member.
 */
export async function settlementReport(
  db: DbAdapter,
  groupPaymentId: string,
): Promise<SettlementReport> {
  const group = await getGroupPaymentStatus(db, groupPaymentId);

  // Join with user emails (would need users table in real implementation)
  const entries: SettlementEntry[] = group.members.map((m) => ({
    memberId: m.id,
    email: '', // Would fetch from users table
    userId: m.userId,
    owedAmount: m.amountOwedHalire,
    paidAmount: m.amountPaidHalire,
    balance: m.amountOwedHalire - m.amountPaidHalire,
    status: m.status,
  }));

  return {
    groupPaymentId: group.id,
    groupOwnerId: group.groupOwnerId,
    eventId: group.eventId,
    totalAmount: group.totalAmountHalire,
    strategy: group.strategy,
    status: group.status,
    entries,
    createdAt: group.createdAt,
  };
}

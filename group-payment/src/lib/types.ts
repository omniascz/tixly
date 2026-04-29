// ============================================================
// Group Payment Splitting — Type Definitions
// ============================================================

// ─── Enums ───────────────────────────────────────────────────

export type GroupPaymentStatus = 'pending' | 'paid' | 'disputed';
export type GroupMemberStatus = 'pending' | 'paid' | 'disputed';
export type GroupPaymentStrategy = 'equal' | 'proportional' | 'custom';

// ─── Domain entities ─────────────────────────────────────────

export interface GroupPayment {
  id: string;
  groupOwnerId: string;
  eventId: string;
  totalAmountHalire: number;
  splitterStrategy: GroupPaymentStrategy;
  status: GroupPaymentStatus;
  createdAt: Date;
  updatedAt?: Date;
}

export interface GroupMember {
  id: string;
  groupPaymentId: string;
  userId: string;
  orderId: string;
  amountOwedHalire: number;
  amountPaidHalire: number;
  status: GroupMemberStatus;
  joinedAt: Date;
  paidAt?: Date;
}

export interface GroupPaymentInvite {
  id: string;
  groupPaymentId: string;
  toEmail: string;
  token: string;  // hashed token
  expiresAt: Date;
  joinedAt?: Date;
  joinedUserId?: string;
}

// ─── Command / payload types ──────────────────────────────────

export interface CreateGroupPaymentOptions {
  eventId: string;
  strategy: GroupPaymentStrategy;
  orderIds: string[];
  memberEmails: string[];
}

export interface AddMemberOptions {
  groupPaymentId: string;
  userId: string;
  orderId: string;
  amountOwedHalire: number;
}

export interface InviteMemberOptions {
  groupPaymentId: string;
  toEmail: string;
  expiresInDays?: number;
}

export interface AcceptInviteOptions {
  token: string;
  userId: string;
  orderId: string;
}

export interface RecordMemberPaymentOptions {
  groupPaymentId: string;
  userId: string;
  amountPaidHalire: number;
}

export interface SettlementEntry {
  memberId: string;
  email: string;
  userId: string;
  owedAmount: number;
  paidAmount: number;
  balance: number; // owedAmount - paidAmount
  status: GroupMemberStatus;
}

export interface SettlementReport {
  groupPaymentId: string;
  groupOwnerId: string;
  eventId: string;
  totalAmount: number;
  strategy: GroupPaymentStrategy;
  status: GroupPaymentStatus;
  entries: SettlementEntry[];
  createdAt: Date;
}

export interface GroupPaymentResponse {
  id: string;
  groupOwnerId: string;
  eventId: string;
  totalAmountHalire: number;
  strategy: GroupPaymentStrategy;
  status: GroupPaymentStatus;
  members: GroupMember[];
  createdAt: Date;
}

export interface CalculateSplitsResult {
  splits: Array<{
    userId: string;
    orderId: string;
    amountHalire: number;
  }>;
  totalHalire: number;
  rounding?: number; // last member adjustment for rounding
}

// ─── Typed errors ─────────────────────────────────────────────

export class GroupPaymentNotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'GroupPaymentNotFoundError';
  }
}

export class GroupPaymentInviteExpiredError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'GroupPaymentInviteExpiredError';
  }
}

export class GroupPaymentInviteNotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'GroupPaymentInviteNotFoundError';
  }
}

export class InvalidGroupPaymentStrategyError extends Error {
  constructor(strategy: string) {
    super(`Invalid group payment strategy: ${strategy}`);
    this.name = 'InvalidGroupPaymentStrategyError';
  }
}

export class GroupPaymentStatusError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'GroupPaymentStatusError';
  }
}

export class DuplicateGroupMemberError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DuplicateGroupMemberError';
  }
}

export class UnauthorizedGroupPaymentError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UnauthorizedGroupPaymentError';
  }
}

// ─── Port interfaces (dependency injection) ──────────────────

import type { DbAdapter as BaseDbAdapter } from '@tixly/db-adapter';

export interface DbAdapter extends BaseDbAdapter {
  /**
   * Execute a query and return exactly one row, or null.
   */
  queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;

  /**
   * Execute multiple queries within a transaction.
   */
  transaction<T>(
    callback: (db: DbAdapter) => Promise<T>,
  ): Promise<T>;
}

export interface EmailServiceAdapter {
  /**
   * Send invitation email with join link.
   */
  sendGroupInvite(
    toEmail: string,
    groupOwnerId: string,
    inviteLink: string,
    expiresAt: Date,
  ): Promise<void>;
}

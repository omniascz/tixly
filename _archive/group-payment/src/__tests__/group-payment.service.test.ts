import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createGroupPayment,
  addMember,
  inviteMember,
  acceptInvite,
  calculateSplits,
  recordMemberPayment,
  finalizeGroupPayment,
  getGroupPaymentStatus,
  settlementReport,
} from '../services/group-payment.service';
import {
  GroupPaymentNotFoundError,
  GroupPaymentInviteExpiredError,
  InvalidGroupPaymentStrategyError,
  GroupPaymentStatusError,
  DuplicateGroupMemberError,
  UnauthorizedGroupPaymentError,
} from '../lib/types';

// Mock dependencies
const mockDb = {
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn((cb) => cb(mockDb)),
};

const mockEmail = {
  sendGroupInvite: vi.fn(),
};

const deps = {
  db: mockDb,
  email: mockEmail,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockResolvedValue({ rowCount: 1 });
  mockEmail.sendGroupInvite.mockResolvedValue(undefined);
});

describe('Group Payment Service', () => {
  // ─── createGroupPayment ──────────────────────────────────────

  it('should create a group payment with equal strategy', async () => {
    const groupOwnerId = 'user-owner';
    const eventId = 'event-1';

    mockDb.query
      .mockResolvedValueOnce([{ id: 'order-1', total_amount_halire: 100000 }])  // SELECT orders
      .mockResolvedValueOnce([{ id: 'group-1' }])                               // INSERT group RETURNING
      .mockResolvedValueOnce([{ total_amount_halire: 100000, splitter_strategy: 'equal' }])  // calculateSplits: SELECT group
      .mockResolvedValueOnce([{ user_id: 'user-owner', order_id: 'order-1', amount_owed_halire: 0 }]); // calculateSplits: SELECT members

    const result = await createGroupPayment(deps, groupOwnerId, {
      eventId,
      strategy: 'equal',
      orderIds: ['order-1'],
      memberEmails: ['friend@example.com'],
    });

    expect(result.groupPaymentId).toBe('group-1');
    expect(result.inviteLinks).toHaveLength(1);
    expect(result.inviteLinks[0].email).toBe('friend@example.com');
    expect(mockEmail.sendGroupInvite).toHaveBeenCalled();
  });

  it('should reject invalid strategy', async () => {
    await expect(
      createGroupPayment(deps, 'user-owner', {
        eventId: 'event-1',
        strategy: 'invalid' as any,
        orderIds: ['order-1'],
        memberEmails: ['friend@example.com'],
      }),
    ).rejects.toThrow(InvalidGroupPaymentStrategyError);
  });

  it('should require at least one member email', async () => {
    await expect(
      createGroupPayment(deps, 'user-owner', {
        eventId: 'event-1',
        strategy: 'equal',
        orderIds: ['order-1'],
        memberEmails: [],
      }),
    ).rejects.toThrow('Must invite at least one additional member');
  });

  // ─── addMember ───────────────────────────────────────────────

  it('should add a member to existing group', async () => {
    mockDb.query
      .mockResolvedValueOnce([{ group_owner_id: 'owner-1', status: 'pending' }])
      .mockResolvedValueOnce([]) // no existing member
      .mockResolvedValueOnce([{ id: 'member-2', amount_owed_halire: 25000, status: 'pending', joined_at: new Date() }]);

    const result = await addMember(
      deps,
      {
        groupPaymentId: 'group-1',
        userId: 'user-2',
        orderId: 'order-2',
        amountOwedHalire: 25000,
      },
      'owner-1',
    );

    expect(result.userId).toBe('user-2');
    expect(result.amountOwedHalire).toBe(25000);
  });

  it('should prevent non-owner from adding members', async () => {
    mockDb.query.mockResolvedValueOnce([{ group_owner_id: 'owner-1', status: 'pending' }]);

    await expect(
      addMember(
        deps,
        {
          groupPaymentId: 'group-1',
          userId: 'user-2',
          orderId: 'order-2',
          amountOwedHalire: 25000,
        },
        'different-user',
      ),
    ).rejects.toThrow(UnauthorizedGroupPaymentError);
  });

  it('should prevent duplicate members', async () => {
    mockDb.query
      .mockResolvedValueOnce([{ group_owner_id: 'owner-1', status: 'pending' }])
      .mockResolvedValueOnce([{ id: 'member-1' }]); // existing member

    await expect(
      addMember(
        deps,
        {
          groupPaymentId: 'group-1',
          userId: 'user-1',
          orderId: 'order-1',
          amountOwedHalire: 50000,
        },
        'owner-1',
      ),
    ).rejects.toThrow(DuplicateGroupMemberError);
  });

  // ─── inviteMember ────────────────────────────────────────────

  it('should invite member by email', async () => {
    mockDb.query.mockResolvedValueOnce([{ group_owner_id: 'owner-1' }]);
    mockDb.query.mockResolvedValueOnce([]); // no existing invite

    const result = await inviteMember(
      deps,
      {
        groupPaymentId: 'group-1',
        toEmail: 'newmember@example.com',
        expiresInDays: 7,
      },
      'owner-1',
    );

    expect(result.inviteLink).toContain('token=');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(mockEmail.sendGroupInvite).toHaveBeenCalled();
  });

  it('should prevent non-owner from inviting', async () => {
    mockDb.query.mockResolvedValueOnce([{ group_owner_id: 'owner-1' }]);

    await expect(
      inviteMember(
        deps,
        {
          groupPaymentId: 'group-1',
          toEmail: 'newmember@example.com',
        },
        'different-user',
      ),
    ).rejects.toThrow(UnauthorizedGroupPaymentError);
  });

  // ─── acceptInvite ────────────────────────────────────────────

  it('should accept valid invite token', async () => {
    const token = 'test-token-32-chars-long-here--';
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');

    mockDb.query
      .mockResolvedValueOnce([
        {
          id: 'invite-1',
          group_payment_id: 'group-1',
          to_email: 'user@example.com',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          joined_at: null,
          joined_user_id: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          total_amount_halire: 100000,
          splitter_strategy: 'equal',
        },
      ])
      .mockResolvedValueOnce([]) // no existing member
      .mockResolvedValueOnce([{ id: 'member-2', amount_owed_halire: 50000, status: 'pending', joined_at: new Date() }]);

    const result = await acceptInvite(deps, {
      token,
      userId: 'user-2',
      orderId: 'order-2',
    });

    expect(result.userId).toBe('user-2');
  });

  it('should reject expired invite', async () => {
    const token = 'test-token-32-chars-long-here--';
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');

    const expiredDate = new Date(Date.now() - 1000); // 1s in the past

    mockDb.query.mockResolvedValueOnce([
      {
        id: 'invite-1',
        group_payment_id: 'group-1',
        to_email: 'user@example.com',
        expires_at: expiredDate,
        joined_at: null,
        joined_user_id: null,
      },
    ]);

    await expect(
      acceptInvite(deps, {
        token,
        userId: 'user-2',
        orderId: 'order-2',
      }),
    ).rejects.toThrow(GroupPaymentInviteExpiredError);
  });

  // ─── calculateSplits ─────────────────────────────────────────

  it('should calculate equal splits', async () => {
    mockDb.query
      .mockResolvedValueOnce([
        {
          total_amount_halire: 100000,
          splitter_strategy: 'equal',
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 'user-1', order_id: 'order-1', amount_owed_halire: 0 },
        { user_id: 'user-2', order_id: 'order-2', amount_owed_halire: 0 },
        { user_id: 'user-3', order_id: 'order-3', amount_owed_halire: 0 },
        { user_id: 'user-4', order_id: 'order-4', amount_owed_halire: 0 },
      ]);

    const result = await calculateSplits(mockDb, 'group-1', 'equal');

    expect(result.splits).toHaveLength(4);
    expect(result.splits[0].amountHalire).toBe(25000);
    expect(result.splits[1].amountHalire).toBe(25000);
    expect(result.splits[2].amountHalire).toBe(25000);
    expect(result.splits[3].amountHalire).toBe(25000);
    expect(result.totalHalire).toBe(100000);
  });

  it('should handle rounding in equal splits', async () => {
    mockDb.query
      .mockResolvedValueOnce([
        {
          total_amount_halire: 100,
          splitter_strategy: 'equal',
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 'user-1', order_id: 'order-1', amount_owed_halire: 0 },
        { user_id: 'user-2', order_id: 'order-2', amount_owed_halire: 0 },
        { user_id: 'user-3', order_id: 'order-3', amount_owed_halire: 0 },
      ]);

    const result = await calculateSplits(mockDb, 'group-1', 'equal');

    // 100 / 3 = 33.33...
    // splits: [33, 33, 34] - last member gets remainder
    expect(result.splits[0].amountHalire).toBe(33);
    expect(result.splits[1].amountHalire).toBe(33);
    expect(result.splits[2].amountHalire).toBe(34);
  });

  it('should calculate proportional splits by order amount', async () => {
    mockDb.query
      .mockResolvedValueOnce([
        {
          total_amount_halire: 100000,
          splitter_strategy: 'proportional',
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 'user-1', order_id: 'order-1', amount_owed_halire: 0 },
        { user_id: 'user-2', order_id: 'order-2', amount_owed_halire: 0 },
      ])
      .mockResolvedValueOnce([
        { id: 'order-1', total_amount_halire: 100000 },
        { id: 'order-2', total_amount_halire: 50000 },
      ]);

    const result = await calculateSplits(mockDb, 'group-1', 'proportional');

    // Ratio: 100000:50000 = 2:1
    // splits: [66666, 33334] - last member absorbs rounding
    expect(result.splits[0].amountHalire).toBe(66666);
    expect(result.splits[1].amountHalire).toBe(33334);
  });

  // ─── recordMemberPayment ──────────────────────────────────────

  it('should record partial payment', async () => {
    mockDb.query.mockResolvedValueOnce([
      {
        id: 'member-1',
        amount_owed_halire: 50000,
        amount_paid_halire: 0,
        status: 'pending',
      },
    ]);

    mockDb.query.mockResolvedValueOnce([
      {
        id: 'member-1',
        amount_owed_halire: 50000,
        amount_paid_halire: 25000,
        status: 'pending',
        joined_at: new Date(),
        paid_at: null,
      },
    ]);

    const result = await recordMemberPayment(deps, {
      groupPaymentId: 'group-1',
      userId: 'user-1',
      amountPaidHalire: 25000,
    });

    expect(result.amountPaidHalire).toBe(25000);
    expect(result.status).toBe('pending');
  });

  it('should mark member as paid when full amount received', async () => {
    mockDb.query.mockResolvedValueOnce([
      {
        id: 'member-1',
        amount_owed_halire: 50000,
        amount_paid_halire: 40000,
        status: 'pending',
      },
    ]);

    mockDb.query.mockResolvedValueOnce([
      {
        id: 'member-1',
        amount_owed_halire: 50000,
        amount_paid_halire: 50000,
        status: 'paid',
        joined_at: new Date(),
        paid_at: new Date(),
      },
    ]);

    const result = await recordMemberPayment(deps, {
      groupPaymentId: 'group-1',
      userId: 'user-1',
      amountPaidHalire: 10000,
    });

    expect(result.amountPaidHalire).toBe(50000);
    expect(result.status).toBe('paid');
    expect(result.paidAt).toBeDefined();
  });

  it('should allow overpayment', async () => {
    mockDb.query.mockResolvedValueOnce([
      {
        id: 'member-1',
        amount_owed_halire: 50000,
        amount_paid_halire: 0,
        status: 'pending',
      },
    ]);

    mockDb.query.mockResolvedValueOnce([
      {
        id: 'member-1',
        amount_owed_halire: 50000,
        amount_paid_halire: 60000,
        status: 'paid',
        joined_at: new Date(),
        paid_at: new Date(),
      },
    ]);

    const result = await recordMemberPayment(deps, {
      groupPaymentId: 'group-1',
      userId: 'user-1',
      amountPaidHalire: 60000,
    });

    expect(result.amountPaidHalire).toBe(60000);
    expect(result.status).toBe('paid');
  });

  // ─── finalizeGroupPayment ────────────────────────────────────

  it('should finalize when all members paid', async () => {
    mockDb.query
      .mockResolvedValueOnce([{ group_owner_id: 'owner-1', status: 'pending' }])
      .mockResolvedValueOnce([]); // no unpaid members

    await finalizeGroupPayment(deps, 'group-1', 'owner-1');

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orders.group_payments'),
      expect.arrayContaining(['group-1']),
    );
  });

  it('should prevent finalize if members unpaid', async () => {
    mockDb.query
      .mockResolvedValueOnce([{ group_owner_id: 'owner-1', status: 'pending' }])
      .mockResolvedValueOnce([{ id: 'member-1' }]); // unpaid member exists

    await expect(
      finalizeGroupPayment(deps, 'group-1', 'owner-1'),
    ).rejects.toThrow(GroupPaymentStatusError);
  });

  it('should prevent non-owner from finalizing', async () => {
    mockDb.query.mockResolvedValueOnce([{ group_owner_id: 'owner-1', status: 'pending' }]);

    await expect(
      finalizeGroupPayment(deps, 'group-1', 'different-user'),
    ).rejects.toThrow(UnauthorizedGroupPaymentError);
  });

  // ─── getGroupPaymentStatus ──────────────────────────────────

  it('should return full group state', async () => {
    const now = new Date();

    mockDb.query
      .mockResolvedValueOnce([
        {
          id: 'group-1',
          group_owner_id: 'owner-1',
          event_id: 'event-1',
          total_amount_halire: 100000,
          splitter_strategy: 'equal',
          status: 'pending',
          created_at: now,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'member-1',
          user_id: 'user-1',
          order_id: 'order-1',
          amount_owed_halire: 50000,
          amount_paid_halire: 25000,
          status: 'pending',
          joined_at: now,
        },
        {
          id: 'member-2',
          user_id: 'user-2',
          order_id: 'order-2',
          amount_owed_halire: 50000,
          amount_paid_halire: 50000,
          status: 'paid',
          joined_at: now,
        },
      ]);

    const result = await getGroupPaymentStatus(mockDb, 'group-1');

    expect(result.id).toBe('group-1');
    expect(result.groupOwnerId).toBe('owner-1');
    expect(result.members).toHaveLength(2);
    expect(result.members[0].status).toBe('pending');
    expect(result.members[1].status).toBe('paid');
  });

  // ─── settlementReport ────────────────────────────────────────

  it('should generate settlement report with balances', async () => {
    const now = new Date();

    mockDb.query
      .mockResolvedValueOnce([
        {
          id: 'group-1',
          group_owner_id: 'owner-1',
          event_id: 'event-1',
          total_amount_halire: 100000,
          splitter_strategy: 'equal',
          status: 'pending',
          created_at: now,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'member-1',
          user_id: 'user-1',
          order_id: 'order-1',
          amount_owed_halire: 50000,
          amount_paid_halire: 25000,
          status: 'pending',
          joined_at: now,
        },
        {
          id: 'member-2',
          user_id: 'user-2',
          order_id: 'order-2',
          amount_owed_halire: 50000,
          amount_paid_halire: 50000,
          status: 'paid',
          joined_at: now,
        },
      ]);

    const result = await settlementReport(mockDb, 'group-1');

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].balance).toBe(25000); // 50000 - 25000
    expect(result.entries[1].balance).toBe(0); // 50000 - 50000
    expect(result.status).toBe('pending');
  });
});

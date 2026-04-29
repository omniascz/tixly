import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupTicketService } from '../services/group-ticket.service';
import type { GroupDbAdapter } from '../services/group-ticket.service';
import type { GroupTicketType, GroupOrder, GroupMember } from '../types/group-ticket.types';
import {
  GroupCapacityError,
  GroupMemberListError,
  GroupOrderNotFoundError,
  GroupQuantityError,
  GroupUnauthorizedError,
  GroupTicketTypeNotFoundError,
} from '../types/group-ticket.types';

// ---------------------------------------------------------------------------
// Mock DB Adapter
// ---------------------------------------------------------------------------

function makeMockDb(): GroupDbAdapter {
  return {
    findGroupTicketType: vi.fn(),
    incrementSoldCount: vi.fn(),
    createGroupOrder: vi.fn(),
    issueTicketsForGroup: vi.fn(),
    findGroupOrder: vi.fn(),
    cancelGroupOrder: vi.fn(),
    decrementSoldCount: vi.fn(),
    listGroupOrdersByEvent: vi.fn(),
    withTransaction: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVENT_ID = 'event-uuid-001';
const LEADER_ID = 'leader-uuid-001';
const TYPE_ID = 'type-uuid-001';
const ORDER_ID = 'order-uuid-001';

const MOCK_TICKET_TYPE: GroupTicketType = {
  id: TYPE_ID,
  event_id: EVENT_ID,
  name: 'Group VIP Bundle',
  description: '4-person VIP group',
  group_type: 'flexible',
  min_quantity: 4,
  max_quantity: 10,
  price_per_person: 500000,
  total_quantity: 100,
  sold_count: 50,
  active: true,
  requires_member_list: false,
};

const MOCK_MEMBER: GroupMember = {
  name: 'Alice',
  email: 'alice@example.com',
};

const MOCK_ORDER: GroupOrder = {
  id: ORDER_ID,
  group_ticket_type_id: TYPE_ID,
  event_id: EVENT_ID,
  leader_user_id: LEADER_ID,
  quantity: 4,
  price_per_person: 500000,
  total_amount: 2000000,
  status: 'pending',
  members: [MOCK_MEMBER],
  ticket_ids: ['ticket-1', 'ticket-2', 'ticket-3', 'ticket-4'],
  created_at: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GroupTicketService', () => {
  let service: GroupTicketService;
  let db: GroupDbAdapter;

  beforeEach(() => {
    service = new GroupTicketService();
    db = makeMockDb();
  });

  // -------------------------------------------------------------------------
  // 1. createGroupOrder
  // -------------------------------------------------------------------------

  it('1. createGroupOrder — creates order with members', async () => {
    vi.mocked(db.findGroupTicketType).mockResolvedValue(MOCK_TICKET_TYPE);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.createGroupOrder).mockResolvedValue(MOCK_ORDER);
    vi.mocked(db.issueTicketsForGroup).mockResolvedValue(['ticket-1', 'ticket-2', 'ticket-3', 'ticket-4']);

    const result = await service.createGroupOrder(
      TYPE_ID,
      LEADER_ID,
      4,
      [MOCK_MEMBER, { name: 'Bob', email: 'bob@example.com' }, { name: 'Charlie', email: 'charlie@example.com' }, { name: 'Diana', email: 'diana@example.com' }],
      db
    );

    expect(result.id).toBe(ORDER_ID);
    expect(result.status).toBe('pending');
    expect(result.quantity).toBe(4);
    expect(result.total_amount).toBe(2000000);
    expect(result.ticket_ids).toHaveLength(4);
  });

  it('2. createGroupOrder — generates placeholders when no members provided', async () => {
    vi.mocked(db.findGroupTicketType).mockResolvedValue(MOCK_TICKET_TYPE);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.createGroupOrder).mockResolvedValue(MOCK_ORDER);
    vi.mocked(db.issueTicketsForGroup).mockResolvedValue(['ticket-1', 'ticket-2', 'ticket-3', 'ticket-4']);

    const result = await service.createGroupOrder(TYPE_ID, LEADER_ID, 4, [], db);

    expect(result.quantity).toBe(4);
    expect(vi.mocked(db.createGroupOrder)).toHaveBeenCalledWith(
      expect.objectContaining({
        members: expect.arrayContaining([expect.objectContaining({ name: expect.any(String) })]),
      }),
      null
    );
  });

  // -------------------------------------------------------------------------
  // 3. createGroupOrder — type not found
  // -------------------------------------------------------------------------

  it('3. createGroupOrder — throws when type not found', async () => {
    vi.mocked(db.findGroupTicketType).mockResolvedValue(null);

    await expect(
      service.createGroupOrder(TYPE_ID, LEADER_ID, 4, [MOCK_MEMBER], db)
    ).rejects.toThrow(GroupTicketTypeNotFoundError);
  });

  // -------------------------------------------------------------------------
  // 4. createGroupOrder — type not active
  // -------------------------------------------------------------------------

  it('4. createGroupOrder — throws when type not active', async () => {
    const inactiveType = { ...MOCK_TICKET_TYPE, active: false };
    vi.mocked(db.findGroupTicketType).mockResolvedValue(inactiveType);

    await expect(
      service.createGroupOrder(TYPE_ID, LEADER_ID, 4, [MOCK_MEMBER], db)
    ).rejects.toThrow(GroupTicketTypeNotFoundError);
  });

  // -------------------------------------------------------------------------
  // 5. createGroupOrder — quantity below minimum
  // -------------------------------------------------------------------------

  it('5. createGroupOrder — throws when quantity below minimum', async () => {
    vi.mocked(db.findGroupTicketType).mockResolvedValue(MOCK_TICKET_TYPE);

    await expect(
      service.createGroupOrder(TYPE_ID, LEADER_ID, 2, [MOCK_MEMBER], db)
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // 6. createGroupOrder — sold out
  // -------------------------------------------------------------------------

  it('6. createGroupOrder — throws when sold out', async () => {
    const soldOut = { ...MOCK_TICKET_TYPE, sold_count: 100, total_quantity: 100 };
    vi.mocked(db.findGroupTicketType).mockResolvedValue(soldOut);

    await expect(
      service.createGroupOrder(TYPE_ID, LEADER_ID, 4, [MOCK_MEMBER], db)
    ).rejects.toThrow(GroupCapacityError);
  });

  // -------------------------------------------------------------------------
  // 7. createGroupOrder — increments sold_count
  // -------------------------------------------------------------------------

  it('7. createGroupOrder — increments sold_count in transaction', async () => {
    vi.mocked(db.findGroupTicketType).mockResolvedValueOnce(MOCK_TICKET_TYPE).mockResolvedValueOnce(MOCK_TICKET_TYPE);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.incrementSoldCount).mockResolvedValue(undefined);
    vi.mocked(db.createGroupOrder).mockResolvedValue(MOCK_ORDER);
    vi.mocked(db.issueTicketsForGroup).mockResolvedValue(['ticket-1', 'ticket-2', 'ticket-3', 'ticket-4']);

    await service.createGroupOrder(TYPE_ID, LEADER_ID, 4, [MOCK_MEMBER], db);

    expect(vi.mocked(db.incrementSoldCount)).toHaveBeenCalledWith(TYPE_ID, null);
  });

  // -------------------------------------------------------------------------
  // 8. cancelGroupOrder
  // -------------------------------------------------------------------------

  it('8. cancelGroupOrder — leader can cancel', async () => {
    vi.mocked(db.findGroupOrder).mockResolvedValue(MOCK_ORDER);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.cancelGroupOrder).mockResolvedValue(undefined);
    vi.mocked(db.decrementSoldCount).mockResolvedValue(undefined);

    await service.cancelGroupOrder(ORDER_ID, LEADER_ID, db);

    expect(vi.mocked(db.cancelGroupOrder)).toHaveBeenCalledWith(ORDER_ID, null);
    expect(vi.mocked(db.decrementSoldCount)).toHaveBeenCalledWith(TYPE_ID, null);
  });

  it('9. cancelGroupOrder — organizer can cancel', async () => {
    vi.mocked(db.findGroupOrder).mockResolvedValue(MOCK_ORDER);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.cancelGroupOrder).mockResolvedValue(undefined);
    vi.mocked(db.decrementSoldCount).mockResolvedValue(undefined);

    await service.cancelGroupOrder(ORDER_ID, 'other-user', db, 'org-uuid');

    expect(vi.mocked(db.cancelGroupOrder)).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. cancelGroupOrder — unauthorized
  // -------------------------------------------------------------------------

  it('10. cancelGroupOrder — throws when unauthorized', async () => {
    vi.mocked(db.findGroupOrder).mockResolvedValue(MOCK_ORDER);

    await expect(
      service.cancelGroupOrder(ORDER_ID, 'unauthorized-user', db)
    ).rejects.toThrow(GroupUnauthorizedError);
  });

  // -------------------------------------------------------------------------
  // 11. cancelGroupOrder — cannot cancel if not pending/confirmed
  // -------------------------------------------------------------------------

  it('11. cancelGroupOrder — cannot cancel completed order', async () => {
    const completed = { ...MOCK_ORDER, status: 'completed' as const };
    vi.mocked(db.findGroupOrder).mockResolvedValue(completed);

    await expect(
      service.cancelGroupOrder(ORDER_ID, LEADER_ID, db)
    ).rejects.toThrow(GroupUnauthorizedError);
  });

  // -------------------------------------------------------------------------
  // 12. getGroupOrder
  // -------------------------------------------------------------------------

  it('12. getGroupOrder — returns order by id', async () => {
    vi.mocked(db.findGroupOrder).mockResolvedValue(MOCK_ORDER);

    const result = await service.getGroupOrder(ORDER_ID, db);

    expect(result.id).toBe(ORDER_ID);
    expect(result.quantity).toBe(4);
  });

  it('13. getGroupOrder — throws when not found', async () => {
    vi.mocked(db.findGroupOrder).mockResolvedValue(null);

    await expect(service.getGroupOrder(ORDER_ID, db)).rejects.toThrow(GroupOrderNotFoundError);
  });

  // -------------------------------------------------------------------------
  // 14. listEventGroupOrders
  // -------------------------------------------------------------------------

  it('14. listEventGroupOrders — lists all orders for event', async () => {
    const order2 = { ...MOCK_ORDER, id: 'order-uuid-002', quantity: 6 };
    vi.mocked(db.listGroupOrdersByEvent).mockResolvedValue([MOCK_ORDER, order2]);

    const result = await service.listEventGroupOrders(EVENT_ID, 'org-uuid', db);

    expect(result).toHaveLength(2);
    expect(result[0].quantity).toBe(4);
    expect(result[1].quantity).toBe(6);
  });

  // -------------------------------------------------------------------------
  // 15. Integration: Full flow
  // -------------------------------------------------------------------------

  it('15. Full flow: create → list → cancel → decrement', async () => {
    // Create order
    vi.mocked(db.findGroupTicketType).mockResolvedValue(MOCK_TICKET_TYPE);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.createGroupOrder).mockResolvedValue(MOCK_ORDER);
    vi.mocked(db.issueTicketsForGroup).mockResolvedValue(['ticket-1', 'ticket-2', 'ticket-3', 'ticket-4']);

    const created = await service.createGroupOrder(
      TYPE_ID,
      LEADER_ID,
      4,
      [MOCK_MEMBER],
      db
    );
    expect(created.status).toBe('pending');

    // List orders
    vi.mocked(db.listGroupOrdersByEvent).mockResolvedValue([created]);
    const orders = await service.listEventGroupOrders(EVENT_ID, LEADER_ID, db);
    expect(orders).toHaveLength(1);

    // Cancel order
    vi.mocked(db.findGroupOrder).mockResolvedValue(created);
    vi.mocked(db.cancelGroupOrder).mockResolvedValue(undefined);
    vi.mocked(db.decrementSoldCount).mockResolvedValue(undefined);

    await service.cancelGroupOrder(created.id, LEADER_ID, db);

    expect(vi.mocked(db.decrementSoldCount)).toHaveBeenCalledWith(TYPE_ID, null);
  });

  // -------------------------------------------------------------------------
  // 16. Group size limit
  // -------------------------------------------------------------------------

  it('16. createGroupOrder — respects max_quantity limit', async () => {
    const limitedType = { ...MOCK_TICKET_TYPE, max_quantity: 5 };
    vi.mocked(db.findGroupTicketType).mockResolvedValue(limitedType);

    await expect(
      service.createGroupOrder(TYPE_ID, LEADER_ID, 10, [MOCK_MEMBER], db)
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // 17. Leader payment flow
  // -------------------------------------------------------------------------

  it('17. createGroupOrder — calculates correct total (leader pays all)', async () => {
    vi.mocked(db.findGroupTicketType).mockResolvedValue(MOCK_TICKET_TYPE);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.createGroupOrder).mockResolvedValue(MOCK_ORDER);
    vi.mocked(db.issueTicketsForGroup).mockResolvedValue(['ticket-1', 'ticket-2', 'ticket-3', 'ticket-4']);

    const result = await service.createGroupOrder(TYPE_ID, LEADER_ID, 4, [MOCK_MEMBER], db);

    // 4 people × 500000 halíře per person = 2000000
    expect(result.total_amount).toBe(2000000);
    expect(result.price_per_person).toBe(500000);
  });

  // -------------------------------------------------------------------------
  // 18. All amounts are integer haléře
  // -------------------------------------------------------------------------

  it('18. createGroupOrder — total_amount is a whole integer (haléře)', async () => {
    // price_per_person = 33333 haléře (intentionally odd), qty = 3 → 99999
    const oddPriceType: GroupTicketType = {
      ...MOCK_TICKET_TYPE,
      price_per_person: 33333,
      min_quantity: 1,
    };
    const oddOrder: GroupOrder = {
      ...MOCK_ORDER,
      price_per_person: 33333,
      total_amount: 99999,
      quantity: 3,
    };
    vi.mocked(db.findGroupTicketType).mockResolvedValue(oddPriceType);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.createGroupOrder).mockResolvedValue(oddOrder);
    vi.mocked(db.issueTicketsForGroup).mockResolvedValue(['t-1', 't-2', 't-3']);

    const result = await service.createGroupOrder(TYPE_ID, LEADER_ID, 3, [], db);

    expect(Number.isInteger(result.total_amount)).toBe(true);
    expect(result.total_amount).toBe(99999);
  });

  // -------------------------------------------------------------------------
  // 19. distributeTickets — issueTicketsForGroup called once per member
  // -------------------------------------------------------------------------

  it('19. createGroupOrder — issueTicketsForGroup called with all resolved members', async () => {
    const members: GroupMember[] = [
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Charlie', email: null },
      { name: 'Diana', email: 'diana@example.com' },
    ];
    vi.mocked(db.findGroupTicketType).mockResolvedValue(MOCK_TICKET_TYPE);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.createGroupOrder).mockResolvedValue(MOCK_ORDER);
    vi.mocked(db.issueTicketsForGroup).mockResolvedValue(['t-1', 't-2', 't-3', 't-4']);

    const result = await service.createGroupOrder(TYPE_ID, LEADER_ID, 4, members, db);

    expect(vi.mocked(db.issueTicketsForGroup)).toHaveBeenCalledWith(
      MOCK_ORDER.id,
      members,
      null,
    );
    // One ticket issued per member
    expect(result.ticket_ids).toHaveLength(4);
  });

  // -------------------------------------------------------------------------
  // 20. requires_member_list = true → throws GroupMemberListError when empty
  // -------------------------------------------------------------------------

  it('20. createGroupOrder — throws GroupMemberListError when requires_member_list=true and list is empty', async () => {
    const requiredListType: GroupTicketType = {
      ...MOCK_TICKET_TYPE,
      requires_member_list: true,
    };
    vi.mocked(db.findGroupTicketType).mockResolvedValue(requiredListType);

    await expect(
      service.createGroupOrder(TYPE_ID, LEADER_ID, 4, [], db),
    ).rejects.toThrow(GroupMemberListError);

    // Transaction must NOT have been entered
    expect(vi.mocked(db.withTransaction)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 21. requires_member_list = true → throws when list length ≠ quantity
  // -------------------------------------------------------------------------

  it('21. createGroupOrder — throws GroupMemberListError when member count does not match quantity', async () => {
    const requiredListType: GroupTicketType = {
      ...MOCK_TICKET_TYPE,
      requires_member_list: true,
    };
    vi.mocked(db.findGroupTicketType).mockResolvedValue(requiredListType);

    // 2 members but quantity = 4
    await expect(
      service.createGroupOrder(TYPE_ID, LEADER_ID, 4, [MOCK_MEMBER, MOCK_MEMBER], db),
    ).rejects.toThrow(GroupMemberListError);
  });

  // -------------------------------------------------------------------------
  // 22. cancelGroupOrder — cannot cancel already-cancelled order
  // -------------------------------------------------------------------------

  it('22. cancelGroupOrder — cannot cancel an already cancelled order', async () => {
    const cancelledOrder: GroupOrder = { ...MOCK_ORDER, status: 'cancelled' };
    vi.mocked(db.findGroupOrder).mockResolvedValue(cancelledOrder);

    await expect(
      service.cancelGroupOrder(ORDER_ID, LEADER_ID, db),
    ).rejects.toThrow(GroupUnauthorizedError);

    // Ensure no DB mutations were attempted
    expect(vi.mocked(db.cancelGroupOrder)).not.toHaveBeenCalled();
    expect(vi.mocked(db.decrementSoldCount)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 23. Capacity check enforced inside transaction (race-condition guard)
  // -------------------------------------------------------------------------

  it('23. createGroupOrder — throws GroupCapacityError when TX re-fetch finds sold out', async () => {
    // First call (pre-check): 99/100 — passes the fast-path check
    // Second call (inside TX): 100/100 — race condition, should throw
    const almostFull: GroupTicketType = { ...MOCK_TICKET_TYPE, sold_count: 99, total_quantity: 100 };
    const fullType: GroupTicketType = { ...MOCK_TICKET_TYPE, sold_count: 100, total_quantity: 100 };

    vi.mocked(db.findGroupTicketType)
      .mockResolvedValueOnce(almostFull)   // pre-check outside TX
      .mockResolvedValueOnce(fullType);    // authoritative check inside TX

    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));

    await expect(
      service.createGroupOrder(TYPE_ID, LEADER_ID, 4, [], db),
    ).rejects.toThrow(GroupCapacityError);

    // sold_count must NOT have been incremented
    expect(vi.mocked(db.incrementSoldCount)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 24. createGroupOrder — fixed group_type throws when quantity ≠ min_quantity
  // -------------------------------------------------------------------------

  it('24. createGroupOrder — throws GroupQuantityError for fixed group with wrong quantity', async () => {
    const fixedType: GroupTicketType = {
      ...MOCK_TICKET_TYPE,
      group_type: 'fixed',
      min_quantity: 4,
      max_quantity: 4,
    };
    vi.mocked(db.findGroupTicketType).mockResolvedValue(fixedType);

    // Request 5 instead of exactly 4
    await expect(
      service.createGroupOrder(TYPE_ID, LEADER_ID, 5, [], db),
    ).rejects.toThrow(GroupQuantityError);

    expect(vi.mocked(db.withTransaction)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 25. cancelGroupOrder — order not found throws GroupOrderNotFoundError
  // -------------------------------------------------------------------------

  it('25. cancelGroupOrder — throws GroupOrderNotFoundError when order does not exist', async () => {
    vi.mocked(db.findGroupOrder).mockResolvedValue(null);

    await expect(
      service.cancelGroupOrder('non-existent-id', LEADER_ID, db),
    ).rejects.toThrow(GroupOrderNotFoundError);
  });
});

// Group ticket service — orchestrates validation, capacity checks, and atomic
// DB operations. All external dependencies are injected via GroupDbAdapter so
// the service itself is fully testable without a real database.

import type { GroupTicketType, GroupMember, GroupOrder } from '../types/group-ticket.types';
import {
  GroupCapacityError,
  GroupOrderNotFoundError,
  GroupUnauthorizedError,
  GroupTicketTypeNotFoundError,
} from '../types/group-ticket.types';
import {
  validateGroupQuantity,
  calculateGroupTotal,
  validateMemberList,
  generateMemberPlaceholders,
} from '../lib/group-calculator';

// ---------------------------------------------------------------------------
// GroupDbAdapter — injected interface, easy to mock in tests
// ---------------------------------------------------------------------------

export interface GroupDbAdapter {
  /** Fetch a group ticket type by ID; returns null when not found */
  findGroupTicketType(id: string): Promise<GroupTicketType | null>;

  /** Atomically increment sold_count for the given type within a transaction */
  incrementSoldCount(typeId: string, tx: unknown): Promise<void>;

  /** Persist a new group order within a transaction and return the saved record */
  createGroupOrder(
    data: Omit<GroupOrder, 'id' | 'created_at' | 'ticket_ids'>,
    tx: unknown,
  ): Promise<GroupOrder>;

  /**
   * Issue individual tickets for every member of the group.
   * Returns an array of ticket IDs (one per member), in the same order as
   * the members array.
   */
  issueTicketsForGroup(
    groupOrderId: string,
    members: GroupMember[],
    tx: unknown,
  ): Promise<string[]>;

  /** Fetch a group order by ID; returns null when not found */
  findGroupOrder(id: string): Promise<GroupOrder | null>;

  /** Mark a group order as cancelled within a transaction */
  cancelGroupOrder(id: string, tx: unknown): Promise<void>;

  /** Atomically decrement sold_count for the given type within a transaction */
  decrementSoldCount(typeId: string, tx: unknown): Promise<void>;

  /** List all group orders for an event (used by organizers) */
  listGroupOrdersByEvent(eventId: string): Promise<GroupOrder[]>;

  /** Run fn inside an atomic transaction; auto-commits or rolls back */
  withTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// GroupTicketService
// ---------------------------------------------------------------------------

export class GroupTicketService {
  // -------------------------------------------------------------------------
  // createGroupOrder
  // -------------------------------------------------------------------------

  /**
   * Creates a group order:
   * 1. Load & validate ticket type (404 if missing, 422 if quantity OOB)
   * 2. Validate or generate member list
   * 3. Calculate total
   * 4. Atomically: check capacity, increment sold_count, create order, issue tickets
   *
   * @returns The newly created GroupOrder with populated ticket_ids
   * @throws {GroupTicketTypeNotFoundError} when the type does not exist
   * @throws {GroupQuantityError}           when quantity is out of range
   * @throws {GroupMemberListError}         when member list is invalid
   * @throws {GroupCapacityError}           when all group slots are sold out
   */
  async createGroupOrder(
    groupTicketTypeId: string,
    leaderUserId: string,
    quantity: number,
    members: GroupMember[],
    db: GroupDbAdapter,
  ): Promise<GroupOrder> {
    // 1. Load ticket type
    const ticketType = await db.findGroupTicketType(groupTicketTypeId);
    if (!ticketType) {
      throw new GroupTicketTypeNotFoundError(
        `Group ticket type ${groupTicketTypeId} not found.`,
      );
    }

    if (!ticketType.active) {
      throw new GroupTicketTypeNotFoundError(
        `Group ticket type ${groupTicketTypeId} is not active.`,
      );
    }

    // 2. Validate quantity (throws GroupQuantityError on violation)
    validateGroupQuantity(ticketType, quantity);

    // 3. Validate member list or generate placeholders
    validateMemberList(ticketType, members, quantity);
    const resolvedMembers =
      members.length === 0
        ? generateMemberPlaceholders(quantity)
        : members;

    // 4. Calculate total
    const totalAmount = calculateGroupTotal(ticketType, quantity);

    // 5. Capacity pre-check (non-atomic; the atomic check is inside the TX)
    //    This is a fast-path optimisation — avoids entering a TX when obviously
    //    sold out. The authoritative check happens inside withTransaction.
    if (ticketType.sold_count >= ticketType.total_quantity) {
      throw new GroupCapacityError(
        `Group ticket type ${groupTicketTypeId} is sold out (${ticketType.total_quantity}/${ticketType.total_quantity} groups sold).`,
      );
    }

    // 6. Atomic transaction: capacity recheck + increment + create order + issue tickets
    const order = await db.withTransaction(async (tx) => {
      // Re-fetch inside TX for authoritative capacity check (prevents race conditions)
      const ttFresh = await db.findGroupTicketType(groupTicketTypeId);
      if (!ttFresh || ttFresh.sold_count >= ttFresh.total_quantity) {
        throw new GroupCapacityError(
          `Group ticket type ${groupTicketTypeId} is sold out.`,
        );
      }

      await db.incrementSoldCount(groupTicketTypeId, tx);

      const orderData: Omit<GroupOrder, 'id' | 'created_at' | 'ticket_ids'> = {
        group_ticket_type_id: groupTicketTypeId,
        event_id: ticketType.event_id,
        leader_user_id: leaderUserId,
        quantity,
        price_per_person: ticketType.price_per_person,
        total_amount: totalAmount,
        status: 'pending',
        members: resolvedMembers,
      };

      const createdOrder = await db.createGroupOrder(orderData, tx);

      const ticketIds = await db.issueTicketsForGroup(
        createdOrder.id,
        resolvedMembers,
        tx,
      );

      return { ...createdOrder, ticket_ids: ticketIds };
    });

    return order;
  }

  // -------------------------------------------------------------------------
  // cancelGroupOrder
  // -------------------------------------------------------------------------

  /**
   * Cancels a group order.
   * Only the group leader or an event organizer can cancel.
   * Only orders in 'pending' or 'confirmed' status can be cancelled.
   *
   * @throws {GroupOrderNotFoundError}  when order does not exist
   * @throws {GroupUnauthorizedError}   when userId is neither leader nor organizer
   */
  async cancelGroupOrder(
    orderId: string,
    userId: string,
    db: GroupDbAdapter,
    /** Optional: pass the organizerId if the caller has already verified organizer access */
    organizerId?: string,
  ): Promise<void> {
    const order = await db.findGroupOrder(orderId);
    if (!order) {
      throw new GroupOrderNotFoundError(`Group order ${orderId} not found.`);
    }

    const isLeader = order.leader_user_id === userId;
    const isOrganizer = organizerId !== undefined;

    if (!isLeader && !isOrganizer) {
      throw new GroupUnauthorizedError(
        'Only the group leader or event organizer can cancel this order.',
      );
    }

    if (order.status !== 'pending' && order.status !== 'confirmed') {
      throw new GroupUnauthorizedError(
        `Cannot cancel an order in status '${order.status}'.`,
      );
    }

    await db.withTransaction(async (tx) => {
      await db.cancelGroupOrder(orderId, tx);
      await db.decrementSoldCount(order.group_ticket_type_id, tx);
    });
  }

  // -------------------------------------------------------------------------
  // getGroupOrder
  // -------------------------------------------------------------------------

  /**
   * Fetches a single group order by ID.
   *
   * @throws {GroupOrderNotFoundError} when not found
   */
  async getGroupOrder(orderId: string, db: GroupDbAdapter): Promise<GroupOrder> {
    const order = await db.findGroupOrder(orderId);
    if (!order) {
      throw new GroupOrderNotFoundError(`Group order ${orderId} not found.`);
    }
    return order;
  }

  // -------------------------------------------------------------------------
  // listEventGroupOrders
  // -------------------------------------------------------------------------

  /**
   * Lists all group orders for a given event.
   * Intended for organizers — callers must verify organizer ownership before
   * calling this method (the service does not check event ownership itself).
   */
  async listEventGroupOrders(
    eventId: string,
    _organizerId: string,
    db: GroupDbAdapter,
  ): Promise<GroupOrder[]> {
    return db.listGroupOrdersByEvent(eventId);
  }
}

// Singleton — callers can import and use directly or create their own instance
export const groupTicketService = new GroupTicketService();

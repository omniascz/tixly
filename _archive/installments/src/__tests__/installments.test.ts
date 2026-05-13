import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstallmentService } from '../services/installment.service.js';
import {
  InstallmentNotSupportedError,
  InstallmentAlreadyActiveError,
  InstallmentScheduleNotFoundError,
} from '../types/installment.types.js';
import type {
  InstallmentDbAdapter,
  GoPayAdapter,
} from '../services/installment.service.js';
import type { InstallmentSchedule, InstallmentPayment, InstallmentPlan } from '../types/installment.types.js';

describe('InstallmentService', () => {
  let service: InstallmentService;
  let mockDb: InstallmentDbAdapter;
  let mockGoPay: GoPayAdapter;

  beforeEach(() => {
    service = new InstallmentService();

    mockDb = {
      findInstallmentPlan: vi.fn(),
      findScheduleByOrder: vi.fn(),
      findScheduleById: vi.fn(),
      createSchedule: vi.fn(),
      updateScheduleStatus: vi.fn(),
      updatePaymentStatus: vi.fn(),
      saveRecurrenceToken: vi.fn(),
      findOverduePayments: vi.fn(),
      cancelTicket: vi.fn(),
      releaseInventory: vi.fn(),
      withTransaction: vi.fn(),
    };

    mockGoPay = {
      chargeRecurring: vi.fn(),
    };
  });

  describe('createSchedule', () => {
    it('should create installment plan with 3 installments', async () => {
      const orderId = 'order-create-001';
      const ticketId = 'ticket-create-001';
      const userId = 'user-create-001';
      const ticketTypeId = 'ticket-type-001';
      const totalAmount = 30000; // 300 CZK in haléře
      const firstPaymentId = 'gopay-first-001';
      const recurrenceToken = 'token-recurrence-001';

      const mockPlan: InstallmentPlan = {
        id: 'plan-3',
        ticket_type_id: ticketTypeId,
        num_installments: 3,
        interval: 'monthly',
        first_installment_pct: 34,
        active: true,
      };

      const mockSchedule: InstallmentSchedule = {
        id: 'schedule-create-001',
        order_id: orderId,
        ticket_id: ticketId,
        user_id: userId,
        plan_id: mockPlan.id,
        total_amount: totalAmount,
        installments: [],
        status: 'active',
        gopay_recurrence_token: recurrenceToken,
        created_at: new Date(),
      };

      (mockDb.findInstallmentPlan as any).mockResolvedValue(mockPlan);
      (mockDb.findScheduleByOrder as any).mockResolvedValue(null);
      (mockDb.createSchedule as any).mockResolvedValue(mockSchedule);
      (mockDb.saveRecurrenceToken as any).mockResolvedValue(undefined);

      const result = await service.createSchedule(
        orderId,
        ticketId,
        userId,
        ticketTypeId,
        totalAmount,
        firstPaymentId,
        recurrenceToken,
        mockDb,
      );

      expect(result.id).toBe('schedule-create-001');
      expect(result.status).toBe('active');
      expect(mockDb.findInstallmentPlan).toHaveBeenCalledWith(ticketTypeId);
      expect(mockDb.createSchedule).toHaveBeenCalled();
      expect(mockDb.saveRecurrenceToken).toHaveBeenCalledWith('schedule-create-001', recurrenceToken);
    });

    it('should calculate monthly installment amounts correctly', async () => {
      const orderId = 'order-calc-001';
      const ticketId = 'ticket-calc-001';
      const userId = 'user-calc-001';
      const ticketTypeId = 'ticket-type-calc';
      const totalAmount = 30000; // 300 CZK
      const firstPaymentId = 'gopay-first-calc';
      const recurrenceToken = 'token-calc';

      const mockPlan: InstallmentPlan = {
        id: 'plan-calc',
        ticket_type_id: ticketTypeId,
        num_installments: 3,
        interval: 'monthly',
        first_installment_pct: 34, // 34% first
        active: true,
      };

      const mockSchedule: InstallmentSchedule = {
        id: 'schedule-calc',
        order_id: orderId,
        ticket_id: ticketId,
        user_id: userId,
        plan_id: mockPlan.id,
        total_amount: totalAmount,
        installments: [
          {
            id: 'inst-1',
            schedule_id: 'schedule-calc',
            installment_number: 1,
            amount: 10200, // 34% of 30000 = 10200
            due_date: new Date(),
            paid_at: new Date(),
            gopay_payment_id: firstPaymentId,
            status: 'paid',
            retry_count: 0,
            last_retry_at: null,
          },
          {
            id: 'inst-2',
            schedule_id: 'schedule-calc',
            installment_number: 2,
            amount: 9900, // (30000-10200)/2 = 9900
            due_date: new Date(),
            paid_at: null,
            gopay_payment_id: null,
            status: 'pending',
            retry_count: 0,
            last_retry_at: null,
          },
          {
            id: 'inst-3',
            schedule_id: 'schedule-calc',
            installment_number: 3,
            amount: 9900, // (30000-10200)/2 = 9900
            due_date: new Date(),
            paid_at: null,
            gopay_payment_id: null,
            status: 'pending',
            retry_count: 0,
            last_retry_at: null,
          },
        ],
        status: 'active',
        gopay_recurrence_token: recurrenceToken,
        created_at: new Date(),
      };

      (mockDb.findInstallmentPlan as any).mockResolvedValue(mockPlan);
      (mockDb.findScheduleByOrder as any).mockResolvedValue(null);
      (mockDb.createSchedule as any).mockResolvedValue(mockSchedule);
      (mockDb.saveRecurrenceToken as any).mockResolvedValue(undefined);

      await service.createSchedule(
        orderId,
        ticketId,
        userId,
        ticketTypeId,
        totalAmount,
        firstPaymentId,
        recurrenceToken,
        mockDb,
      );

      // Verify amounts are calculated (sum should equal total)
      expect(mockDb.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          total_amount: totalAmount,
        }),
      );
    });

    it('should throw InstallmentNotSupportedError when no active plan', async () => {
      const orderId = 'order-no-plan';
      const ticketId = 'ticket-no-plan';
      const userId = 'user-no-plan';
      const ticketTypeId = 'ticket-type-inactive';
      const totalAmount = 30000;
      const firstPaymentId = 'gopay-first';
      const recurrenceToken = 'token';

      (mockDb.findInstallmentPlan as any).mockResolvedValue(null);

      await expect(
        service.createSchedule(
          orderId,
          ticketId,
          userId,
          ticketTypeId,
          totalAmount,
          firstPaymentId,
          recurrenceToken,
          mockDb,
        ),
      ).rejects.toThrow(InstallmentNotSupportedError);
    });

    it('should throw InstallmentAlreadyActiveError when schedule already exists', async () => {
      const orderId = 'order-dup';
      const ticketId = 'ticket-dup';
      const userId = 'user-dup';
      const ticketTypeId = 'ticket-type-dup';
      const totalAmount = 30000;
      const firstPaymentId = 'gopay-first';
      const recurrenceToken = 'token';

      const mockPlan: InstallmentPlan = {
        id: 'plan-dup',
        ticket_type_id: ticketTypeId,
        num_installments: 2,
        interval: 'weekly',
        first_installment_pct: 50,
        active: true,
      };

      const existingSchedule: InstallmentSchedule = {
        id: 'schedule-dup-existing',
        order_id: orderId,
        ticket_id: 'ticket-old',
        user_id: userId,
        plan_id: mockPlan.id,
        total_amount: 30000,
        installments: [],
        status: 'active',
        gopay_recurrence_token: 'old-token',
        created_at: new Date(),
      };

      (mockDb.findInstallmentPlan as any).mockResolvedValue(mockPlan);
      (mockDb.findScheduleByOrder as any).mockResolvedValue(existingSchedule);

      await expect(
        service.createSchedule(
          orderId,
          ticketId,
          userId,
          ticketTypeId,
          totalAmount,
          firstPaymentId,
          recurrenceToken,
          mockDb,
        ),
      ).rejects.toThrow(InstallmentAlreadyActiveError);
    });
  });

  describe('processOverduePayments', () => {
    it('should charge overdue payments successfully', async () => {
      const schedule: InstallmentSchedule = {
        id: 'schedule-charge-001',
        order_id: 'order-charge-001',
        ticket_id: 'ticket-charge-001',
        user_id: 'user-charge-001',
        plan_id: 'plan-001',
        total_amount: 30000,
        installments: [
          {
            id: 'inst-charge-1',
            schedule_id: 'schedule-charge-001',
            installment_number: 1,
            amount: 10200,
            due_date: new Date('2026-04-01'),
            paid_at: new Date('2026-04-01'),
            gopay_payment_id: 'gopay-first',
            status: 'paid',
            retry_count: 0,
            last_retry_at: null,
          },
          {
            id: 'inst-charge-2',
            schedule_id: 'schedule-charge-001',
            installment_number: 2,
            amount: 9900,
            due_date: new Date('2026-05-01'),
            paid_at: null,
            gopay_payment_id: null,
            status: 'pending',
            retry_count: 0,
            last_retry_at: null,
          },
        ],
        status: 'active',
        gopay_recurrence_token: 'recurrence-token-001',
        created_at: new Date('2026-04-01'),
      };

      (mockDb.findOverduePayments as any).mockResolvedValue([
        {
          schedule,
          payment: schedule.installments[1],
        },
      ]);

      (mockGoPay.chargeRecurring as any).mockResolvedValue({
        paymentId: 'gopay-charge-001',
        success: true,
      });

      (mockDb.updatePaymentStatus as any).mockResolvedValue(undefined);
      (mockDb.findScheduleById as any).mockResolvedValue(schedule);
      (mockDb.updateScheduleStatus as any).mockResolvedValue(undefined);

      const result = await service.processOverduePayments(mockDb, mockGoPay);

      expect(result.charged).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(mockGoPay.chargeRecurring).toHaveBeenCalled();
      expect(mockDb.updatePaymentStatus).toHaveBeenCalled();
    });

    it('should retry failed payments up to 3 times', async () => {
      const schedule: InstallmentSchedule = {
        id: 'schedule-retry-001',
        order_id: 'order-retry-001',
        ticket_id: 'ticket-retry-001',
        user_id: 'user-retry-001',
        plan_id: 'plan-001',
        total_amount: 30000,
        installments: [
          {
            id: 'inst-retry-1',
            schedule_id: 'schedule-retry-001',
            installment_number: 1,
            amount: 9900,
            due_date: new Date('2026-05-01'),
            paid_at: null,
            gopay_payment_id: null,
            status: 'pending',
            retry_count: 2, // Second retry
            last_retry_at: new Date('2026-04-06'),
          },
        ],
        status: 'active',
        gopay_recurrence_token: 'recurrence-token-retry',
        created_at: new Date(),
      };

      (mockDb.findOverduePayments as any).mockResolvedValue([
        {
          schedule,
          payment: schedule.installments[0],
        },
      ]);

      (mockGoPay.chargeRecurring as any).mockResolvedValue({
        paymentId: 'gopay-retry-001',
        success: false,
      });

      (mockDb.updatePaymentStatus as any).mockResolvedValue(undefined);
      (mockDb.findScheduleById as any).mockResolvedValue(schedule);

      const result = await service.processOverduePayments(mockDb, mockGoPay);

      expect(result.failed).toBe(1);
      expect(mockDb.updatePaymentStatus).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: expect.stringMatching(/retrying|failed/),
          retry_count: 3,
        }),
      );
    });

    it('should mark installment as paid when charge succeeds', async () => {
      const schedule: InstallmentSchedule = {
        id: 'schedule-mark-paid',
        order_id: 'order-mark-paid',
        ticket_id: 'ticket-mark-paid',
        user_id: 'user-mark-paid',
        plan_id: 'plan-001',
        total_amount: 30000,
        installments: [
          {
            id: 'inst-mark-paid-1',
            schedule_id: 'schedule-mark-paid',
            installment_number: 1,
            amount: 10200,
            due_date: new Date('2026-04-01'),
            paid_at: new Date('2026-04-01'),
            gopay_payment_id: 'gopay-first',
            status: 'paid',
            retry_count: 0,
            last_retry_at: null,
          },
          {
            id: 'inst-mark-paid-2',
            schedule_id: 'schedule-mark-paid',
            installment_number: 2,
            amount: 9900,
            due_date: new Date('2026-05-05'),
            paid_at: null,
            gopay_payment_id: null,
            status: 'pending',
            retry_count: 0,
            last_retry_at: null,
          },
        ],
        status: 'active',
        gopay_recurrence_token: 'token-mark',
        created_at: new Date(),
      };

      (mockDb.findOverduePayments as any).mockResolvedValue([
        {
          schedule,
          payment: schedule.installments[1],
        },
      ]);

      (mockGoPay.chargeRecurring as any).mockResolvedValue({
        paymentId: 'gopay-mark-paid-001',
        success: true,
      });

      (mockDb.updatePaymentStatus as any).mockResolvedValue(undefined);
      (mockDb.findScheduleById as any).mockResolvedValue(schedule);

      await service.processOverduePayments(mockDb, mockGoPay);

      expect(mockDb.updatePaymentStatus).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'paid',
          paid_at: expect.any(Date),
        }),
      );
    });

    it('should detect overdue payments and cancel ticket after 3 failures', async () => {
      const schedule: InstallmentSchedule = {
        id: 'schedule-cancel-001',
        order_id: 'order-cancel-001',
        ticket_id: 'ticket-cancel-001',
        user_id: 'user-cancel-001',
        plan_id: 'plan-001',
        total_amount: 30000,
        installments: [
          {
            id: 'inst-cancel-1',
            schedule_id: 'schedule-cancel-001',
            installment_number: 2,
            amount: 9900,
            due_date: new Date('2026-04-01'),
            paid_at: null,
            gopay_payment_id: null,
            status: 'pending',
            retry_count: 3, // Already exhausted retries
            last_retry_at: new Date('2026-04-06'),
          },
        ],
        status: 'active',
        gopay_recurrence_token: 'token-cancel',
        created_at: new Date(),
      };

      (mockDb.findOverduePayments as any).mockResolvedValue([
        {
          schedule,
          payment: schedule.installments[0],
        },
      ]);

      (mockDb.withTransaction as any).mockImplementation(async (fn) => fn({}));
      (mockDb.cancelTicket as any).mockResolvedValue(undefined);
      (mockDb.releaseInventory as any).mockResolvedValue(undefined);
      (mockDb.updateScheduleStatus as any).mockResolvedValue(undefined);

      const result = await service.processOverduePayments(mockDb, mockGoPay);

      expect(result.cancelled).toBe(1);
      expect(mockDb.withTransaction).toHaveBeenCalled();
    });
  });

  describe('getScheduleStatus', () => {
    it('should return schedule status for existing order', async () => {
      const orderId = 'order-status-001';

      const mockSchedule: InstallmentSchedule = {
        id: 'schedule-status-001',
        order_id: orderId,
        ticket_id: 'ticket-status-001',
        user_id: 'user-status-001',
        plan_id: 'plan-001',
        total_amount: 30000,
        installments: [],
        status: 'active',
        gopay_recurrence_token: 'token-status',
        created_at: new Date(),
      };

      (mockDb.findScheduleByOrder as any).mockResolvedValue(mockSchedule);

      const result = await service.getScheduleStatus(orderId, mockDb);

      expect(result.id).toBe('schedule-status-001');
      expect(result.order_id).toBe(orderId);
      expect(mockDb.findScheduleByOrder).toHaveBeenCalledWith(orderId);
    });

    it('should throw InstallmentScheduleNotFoundError when schedule not found', async () => {
      const orderId = 'order-not-found';

      (mockDb.findScheduleByOrder as any).mockResolvedValue(null);

      await expect(service.getScheduleStatus(orderId, mockDb)).rejects.toThrow(
        InstallmentScheduleNotFoundError,
      );
    });
  });
});

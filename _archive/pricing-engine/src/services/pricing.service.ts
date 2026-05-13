import type {
  PriceCalculation,
  PricingRule,
  TicketType,
  PhaseTransitionEvent,
  PricingPhase,
  AuditLogEntry,
} from '../types/pricing';
import {
  resolveActivePhase,
  calculateDemandFactor,
  calculateFinalPrice,
  getNextPhase,
} from '../lib/pricing-calculator';

// ---------------------------------------------------------------------------
// Adapter interfaces — injected, never imported directly from DB/Redis libs
// ---------------------------------------------------------------------------

export interface DbAdapter {
  getTicketType(ticketTypeId: string): Promise<TicketType | null>;
  getPricingRules(ticketTypeId: string): Promise<PricingRule[]>;
  getCurrentPhaseForTicketType(
    ticketTypeId: string,
  ): Promise<PricingPhase | null>;
  setCurrentPhase(
    ticketTypeId: string,
    phase: PricingPhase,
  ): Promise<void>;
  getActiveTicketTypesForUpcomingEvents(
    withinHours: number,
  ): Promise<TicketType[]>;
  getEventWebhookUrl(eventId: string): Promise<string | null>;
  insertAuditLog(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<void>;
}

export interface CacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface EventBusAdapter {
  emit(topic: string, payload: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// PricingService
// ---------------------------------------------------------------------------

export class PricingService {
  constructor(
    private readonly db: DbAdapter,
    private readonly cache: CacheAdapter,
    private readonly eventBus: EventBusAdapter,
  ) {}

  // -------------------------------------------------------------------------
  // getCurrentPrice
  // -------------------------------------------------------------------------

  async getCurrentPrice(ticketTypeId: string): Promise<PriceCalculation> {
    const cacheKey = `pricing:current:${ticketTypeId}`;

    const cached = await this.cache.get(cacheKey);
    if (cached !== null) {
      return this.deserializePriceCalculation(cached);
    }

    const [ticketType, rules] = await Promise.all([
      this.db.getTicketType(ticketTypeId),
      this.db.getPricingRules(ticketTypeId),
    ]);

    if (ticketType === null) {
      throw new Error(`TicketType not found: ${ticketTypeId}`);
    }

    const now = new Date();
    const soldQty = ticketType.totalQty - ticketType.remainingQty;
    const activeRule = resolveActivePhase(rules, soldQty, ticketType.totalQty, now);

    if (activeRule === null) {
      throw new Error(
        `No active pricing rule for ticketType: ${ticketTypeId}`,
      );
    }

    const demandFactor = calculateDemandFactor(
      soldQty,
      ticketType.totalQty,
      activeRule,
    );
    const finalPrice = calculateFinalPrice(activeRule.price, demandFactor);
    const soldPercent =
      ticketType.totalQty > 0 ? soldQty / ticketType.totalQty : 0;

    const nextPhaseInfo = getNextPhase(
      rules,
      activeRule.phase,
      soldQty,
      ticketType.totalQty,
      now,
    );

    const calculation: PriceCalculation = {
      ticketTypeId,
      basePrice: ticketType.basePrice,
      currentPhase: activeRule.phase,
      phasePrice: activeRule.price,
      demandFactor,
      finalPrice,
      soldPercent,
      nextPhase: nextPhaseInfo?.phase ?? null,
      nextPhaseAt:
        nextPhaseInfo !== null
          ? {
              ...(nextPhaseInfo.date !== undefined
                ? { date: nextPhaseInfo.date }
                : {}),
              ...(nextPhaseInfo.qty !== undefined
                ? { qty: nextPhaseInfo.qty }
                : {}),
            }
          : null,
    };

    await this.cache.set(cacheKey, this.serializePriceCalculation(calculation), 60);
    return calculation;
  }

  // -------------------------------------------------------------------------
  // getPriceForOrder
  // -------------------------------------------------------------------------

  async getPriceForOrder(
    ticketTypeId: string,
    quantity: number,
  ): Promise<{
    unitPrice: number;
    totalPrice: number;
    calculation: PriceCalculation;
  }> {
    const ticketType = await this.db.getTicketType(ticketTypeId);
    if (ticketType === null) {
      throw new Error(`TicketType not found: ${ticketTypeId}`);
    }

    if (ticketType.remainingQty < quantity) {
      throw new Error(
        `Insufficient availability: requested ${quantity}, remaining ${ticketType.remainingQty}`,
      );
    }

    if (quantity > ticketType.maxPerUser) {
      throw new Error(
        `Exceeds max per user: requested ${quantity}, max ${ticketType.maxPerUser}`,
      );
    }

    // Price is locked at the moment of order — getCurrentPrice uses cache so
    // repeated calls within 60s return the same price (idempotent for retries).
    const calculation = await this.getCurrentPrice(ticketTypeId);

    return {
      unitPrice: calculation.finalPrice,
      totalPrice: calculation.finalPrice * quantity,
      calculation,
    };
  }

  // -------------------------------------------------------------------------
  // checkAndTransitionPhases
  // -------------------------------------------------------------------------

  async checkAndTransitionPhases(
    ticketTypeId: string,
  ): Promise<PhaseTransitionEvent | null> {
    const [ticketType, rules] = await Promise.all([
      this.db.getTicketType(ticketTypeId),
      this.db.getPricingRules(ticketTypeId),
    ]);

    if (ticketType === null) return null;

    const now = new Date();
    const soldQty = ticketType.totalQty - ticketType.remainingQty;
    const activeRule = resolveActivePhase(rules, soldQty, ticketType.totalQty, now);

    if (activeRule === null) return null;

    const currentStoredPhase = await this.db.getCurrentPhaseForTicketType(ticketTypeId);

    // Idempotent: no change if phase is already up to date
    if (currentStoredPhase === activeRule.phase) return null;

    // Determine trigger type
    const dateTriggered =
      activeRule.thresholdDate !== null && activeRule.thresholdDate <= now;
    const qtyTriggered =
      activeRule.thresholdQty !== null && soldQty >= activeRule.thresholdQty;

    let triggeredBy: PhaseTransitionEvent['triggeredBy'];
    if (dateTriggered && qtyTriggered) {
      // Qty takes precedence if both triggered simultaneously (sold out fast)
      triggeredBy = 'quantity';
    } else if (qtyTriggered) {
      triggeredBy = 'quantity';
    } else {
      triggeredBy = 'date';
    }

    const event: PhaseTransitionEvent = {
      ticketTypeId,
      eventId: ticketType.eventId,
      fromPhase: currentStoredPhase,
      toPhase: activeRule.phase,
      triggeredBy,
      transitionedAt: now,
    };

    // Persist new phase
    await this.db.setCurrentPhase(ticketTypeId, activeRule.phase);

    // Audit log
    await this.db.insertAuditLog({
      tableName: 'pricing_rules',
      recordId: activeRule.id,
      action: 'phase_transition',
      payload: {
        ticketTypeId,
        fromPhase: currentStoredPhase,
        toPhase: activeRule.phase,
        triggeredBy,
        transitionedAt: now.toISOString(),
      },
    });

    // Invalidate cache
    await this.cache.del(`pricing:current:${ticketTypeId}`);

    // Emit Kafka event
    await this.eventBus.emit('pricing.phase_changed', event);

    return event;
  }

  // -------------------------------------------------------------------------
  // Cache helpers
  // -------------------------------------------------------------------------

  private serializePriceCalculation(calc: PriceCalculation): string {
    return JSON.stringify({
      ...calc,
      nextPhaseAt: calc.nextPhaseAt
        ? {
            date: calc.nextPhaseAt.date?.toISOString(),
            qty: calc.nextPhaseAt.qty,
          }
        : null,
    });
  }

  private deserializePriceCalculation(raw: string): PriceCalculation {
    const parsed = JSON.parse(raw) as {
      ticketTypeId: string;
      basePrice: number;
      currentPhase: PricingPhase;
      phasePrice: number;
      demandFactor: number;
      finalPrice: number;
      soldPercent: number;
      nextPhase: PricingPhase | null;
      nextPhaseAt: { date?: string; qty?: number } | null;
    };

    return {
      ...parsed,
      nextPhaseAt: parsed.nextPhaseAt
        ? {
            ...(parsed.nextPhaseAt.date !== undefined
              ? { date: new Date(parsed.nextPhaseAt.date) }
              : {}),
            ...(parsed.nextPhaseAt.qty !== undefined
              ? { qty: parsed.nextPhaseAt.qty }
              : {}),
          }
        : null,
    };
  }
}

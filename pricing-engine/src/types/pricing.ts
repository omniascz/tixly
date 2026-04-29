export type PricingPhase = 'early_bird' | 'regular' | 'late' | 'door';

export interface PricingRule {
  id: string;
  ticketTypeId: string;
  phase: PricingPhase;
  price: number;
  thresholdQty: number | null;
  thresholdDate: Date | null;
  demandFactorMin: number;
  demandFactorMax: number;
  priority: number;
  active: boolean;
}

export interface PriceCalculation {
  ticketTypeId: string;
  basePrice: number;
  currentPhase: PricingPhase;
  phasePrice: number;
  demandFactor: number;
  finalPrice: number;
  soldPercent: number;
  nextPhase: PricingPhase | null;
  nextPhaseAt: { date?: Date; qty?: number } | null;
}

export interface PhaseTransitionEvent {
  ticketTypeId: string;
  eventId: string;
  fromPhase: PricingPhase | null;
  toPhase: PricingPhase;
  triggeredBy: 'date' | 'quantity' | 'manual';
  transitionedAt: Date;
}

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  kind: string;
  basePrice: number;
  totalQty: number;
  remainingQty: number;
  maxPerUser: number;
  zone: string | null;
}

export interface AuditLogEntry {
  id?: string;
  tableName: string;
  recordId: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt?: Date;
}

export interface PriceHistoryEntry {
  timestamp: Date;
  price: number;
  phase: PricingPhase;
  trigger: string;
}

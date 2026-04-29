// =============================================================================
// Break-even analýza + Revenue forecast — Feature #62
//
// Promotér vidí: při jaké obsazenosti je v zisku, simulace cenových scénářů,
// doporučená minimální cena vstupenky.
//
// Všechny částky v INTEGER halíře (100 halířů = 1 CZK).
// Výpočet je read-only — žádné DB mutace.
// =============================================================================

import type { ServiceDeps } from '../lib/service-container.js';
import { EventManagementError } from '../lib/event-errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BreakevenInput {
  /** Pevné náklady: pronájem sálu, technika, marketing (halíře) */
  fixedCostsHalire: number;
  /** Variabilní náklady na vstupenku: bezpečnost, catering na osobu (halíře) */
  variableCostPerTicketHalire: number;
}

export interface OccupancyScenario {
  /** Obsazenost v procentech (0–100) */
  occupancyPct: number;
  /** Počet prodaných vstupenek */
  ticketsSold: number;
  /** Celkové příjmy (halíře) */
  revenueHalire: number;
  /** Celkové náklady (halíře) */
  totalCostsHalire: number;
  /** Zisk / ztráta (halíře, může být záporný) */
  profitHalire: number;
  /** True pokud je akce v zisku */
  isProfitable: boolean;
}

export interface BreakevenResult {
  /** Kapacita akce (součet kapacit ticket types) */
  totalCapacity: number;
  /** Průměrná cena vstupenky váhovaná kapacitou (halíře) */
  weightedAvgPriceHalire: number;
  /** Obsazenost (%) nutná pro pokrytí nákladů */
  breakEvenOccupancyPct: number;
  /** Počet vstupenek nutný pro pokrytí nákladů */
  breakEvenTickets: number;
  /** Minimální doporučená cena vstupenky pro 80% obsazenost (halíře) */
  recommendedMinPriceHalire: number;
  /** Scénáře: 40 %, 50 %, 60 %, 70 %, 80 %, 90 %, 100 % */
  scenarios: OccupancyScenario[];
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface TicketTypeRow {
  id: string;
  price_halire: number;
  capacity: number | null;
}

interface EventRow {
  id: string;
  promoter_id: string;
  capacity: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcScenario(
  pct: number,
  totalCapacity: number,
  weightedAvgPrice: number,
  fixedCosts: number,
  variableCostPerTicket: number,
): OccupancyScenario {
  const ticketsSold = Math.round((pct / 100) * totalCapacity);
  const revenueHalire = Math.round(ticketsSold * weightedAvgPrice);
  const totalCostsHalire = fixedCosts + ticketsSold * variableCostPerTicket;
  const profitHalire = revenueHalire - totalCostsHalire;
  return {
    occupancyPct: pct,
    ticketsSold,
    revenueHalire,
    totalCostsHalire,
    profitHalire,
    isProfitable: profitHalire >= 0,
  };
}

// ---------------------------------------------------------------------------
// Service function
// ---------------------------------------------------------------------------

export async function calculateBreakeven(
  eventId: string,
  promoterId: string,
  input: BreakevenInput,
  deps: ServiceDeps,
): Promise<BreakevenResult> {
  if (!Number.isInteger(input.fixedCostsHalire) || input.fixedCostsHalire < 0) {
    throw new EventManagementError('VALIDATION_ERROR', 'fixedCostsHalire must be a non-negative integer');
  }
  if (!Number.isInteger(input.variableCostPerTicketHalire) || input.variableCostPerTicketHalire < 0) {
    throw new EventManagementError('VALIDATION_ERROR', 'variableCostPerTicketHalire must be a non-negative integer');
  }

  // Load event (verify ownership + get event-level capacity)
  const eventRows = await deps.db.query<EventRow>(
    `SELECT id, promoter_id, capacity
     FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  if (eventRows.length === 0) {
    throw new EventManagementError('EVENT_NOT_FOUND', `Event ${eventId} not found`);
  }
  const event = eventRows[0];

  // Load ticket types
  const typeRows = await deps.db.query<TicketTypeRow>(
    `SELECT id, price_halire, capacity
     FROM catalog.ticket_types
     WHERE event_id = $1 AND is_active = true`,
    [eventId],
  );
  if (typeRows.length === 0) {
    throw new EventManagementError('VALIDATION_ERROR', 'Event has no active ticket types — cannot calculate break-even');
  }

  // Determine effective capacity per type
  // If ticket_type.capacity is null → shares event capacity equally
  const eventCap = event.capacity ?? 0;
  const nullCapTypes = typeRows.filter((t) => t.capacity === null).length;
  const perTypeShareCap = nullCapTypes > 0 && eventCap > 0
    ? Math.floor(eventCap / nullCapTypes)
    : 0;

  let totalCapacity = 0;
  let weightedPriceSum = 0;

  for (const t of typeRows) {
    const cap = t.capacity ?? perTypeShareCap;
    totalCapacity += cap;
    weightedPriceSum += cap * t.price_halire;
  }

  if (totalCapacity === 0) {
    throw new EventManagementError('VALIDATION_ERROR', 'Cannot determine event capacity — set capacity on event or ticket types');
  }

  const weightedAvgPriceHalire = weightedPriceSum / totalCapacity;
  const { fixedCostsHalire, variableCostPerTicketHalire } = input;

  // Break-even: fixedCosts + tickets × variableCost = tickets × avgPrice
  //   → tickets = fixedCosts / (avgPrice - variableCost)
  const marginPerTicket = weightedAvgPriceHalire - variableCostPerTicketHalire;
  if (marginPerTicket <= 0) {
    throw new EventManagementError(
      'VALIDATION_ERROR',
      'Variable cost per ticket exceeds or equals average ticket price — no break-even possible at current pricing',
    );
  }

  const breakEvenTickets = Math.ceil(fixedCostsHalire / marginPerTicket);
  const breakEvenOccupancyPct = Math.min(100, (breakEvenTickets / totalCapacity) * 100);

  // Recommended min price: price needed to break even at 80 % occupancy
  const targetTickets80 = Math.round(0.8 * totalCapacity);
  // fixedCosts + target × varCost = target × recommendedPrice
  // → recommendedPrice = (fixedCosts + target × varCost) / target
  const recommendedMinPriceHalire = Math.ceil(
    (fixedCostsHalire + targetTickets80 * variableCostPerTicketHalire) / targetTickets80,
  );

  const scenarios = [40, 50, 60, 70, 80, 90, 100].map((pct) =>
    calcScenario(pct, totalCapacity, weightedAvgPriceHalire, fixedCostsHalire, variableCostPerTicketHalire),
  );

  return {
    totalCapacity,
    weightedAvgPriceHalire: Math.round(weightedAvgPriceHalire),
    breakEvenOccupancyPct: Math.round(breakEvenOccupancyPct * 10) / 10,
    breakEvenTickets,
    recommendedMinPriceHalire,
    scenarios,
  };
}

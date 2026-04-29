import type { FeeSchedule, FeeCalculation, OrderFeeResult } from '../types/fees';
import { FeeError } from './fee-errors';

type ScheduleInput = Pick<FeeSchedule, 'id' | 'percentageFee' | 'fixedFee' | 'minFee' | 'maxFee'>;

/**
 * Výpočet platformního poplatku pro JEDNU položku (vstupenku).
 * Pure funkce — žádné side effects, plně testovatelná.
 *
 * Algoritmus:
 *   percentageAmount = Math.round(ticketPrice * schedule.percentageFee / 10000)
 *   rawFee = percentageAmount + schedule.fixedFee
 *   platformFee = clamp(rawFee, schedule.minFee ?? 0, schedule.maxFee ?? Infinity)
 *   promoterAmount = ticketPrice - platformFee
 *
 * Pozn: promoterAmount může být záporný pokud fixní fee > cena vstupenky.
 */
export function calculateFeeForItem(
  ticketPrice: number,
  schedule: ScheduleInput,
): FeeCalculation {
  if (!Number.isInteger(ticketPrice) || ticketPrice < 0) {
    throw new FeeError('INVALID_PRICE', `ticketPrice musí být nezáporné celé číslo, dostali jsme: ${ticketPrice}`);
  }

  const percentageAmount = Math.round((ticketPrice * schedule.percentageFee) / 10000);
  const fixedAmount = schedule.fixedFee;
  const rawFee = percentageAmount + fixedAmount;

  const minFee = schedule.minFee ?? 0;
  const maxFee = schedule.maxFee ?? Infinity;

  const platformFee = Math.min(Math.max(rawFee, minFee), maxFee);
  const promoterAmount = ticketPrice - platformFee;

  return {
    ticketPrice,
    percentageAmount,
    fixedAmount,
    rawFee,
    platformFee,
    promoterAmount,
    feeScheduleId: schedule.id,
    appliedPercentage: schedule.percentageFee,
  };
}

export interface OrderLineItem {
  price: number;      // haléře — cena jedné vstupenky
  quantity: number;   // počet kusů
}

/**
 * Výpočet fee pro celou objednávku (více položek s různými cenami a množstvími).
 * Volá calculateFeeForItem pro každý kus zvlášť (price × quantity rozložit na jednotlivé kusy).
 */
export function calculateFeeForOrder(
  lineItems: OrderLineItem[],
  schedule: ScheduleInput,
): OrderFeeResult {
  const allCalculations: FeeCalculation[] = [];

  for (const item of lineItems) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new FeeError('INVALID_PRICE', `quantity musí být kladné celé číslo, dostali jsme: ${item.quantity}`);
    }
    for (let i = 0; i < item.quantity; i++) {
      allCalculations.push(calculateFeeForItem(item.price, schedule));
    }
  }

  const totalPlatformFee = allCalculations.reduce((sum, c) => sum + c.platformFee, 0);
  const totalPromoterPayout = allCalculations.reduce((sum, c) => sum + c.promoterAmount, 0);
  const totalGrossRevenue = allCalculations.reduce((sum, c) => sum + c.ticketPrice, 0);

  return {
    lineItems: allCalculations,
    totalPlatformFee,
    totalPromoterPayout,
    totalGrossRevenue,
    feeScheduleId: schedule.id,
  };
}

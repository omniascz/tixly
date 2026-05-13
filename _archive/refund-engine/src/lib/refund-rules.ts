import type { Order, RefundPolicy, RefundEligibility } from './types.js';

export function evaluateRefundRules(order: Order, policy: RefundPolicy | null): RefundEligibility {
  // 1. Cancelled event → vždy povolí plný refund
  if (order.status === 'event_cancelled') {
    return { eligible: true, maxRefundableHalire: order.totalAmountHalire };
  }

  // 2. Order není paid → nelze refundovat
  if (order.status !== 'paid') {
    return { eligible: false, reason: 'Order is not in paid status' };
  }

  // 3. Bez policy → použij default (14 dní dle EU law)
  const windowDays = policy?.refundWindowDays ?? 14;
  const orderDate = new Date(order.createdAt);
  const now = new Date();
  const diffMs = now.getTime() - orderDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > windowDays) {
    return { eligible: false, reason: `Refund window of ${windowDays} days has expired` };
  }

  // 4. Check allowCustomerRefunds
  if (policy && !policy.allowCustomerRefunds) {
    return { eligible: false, reason: 'Customer refunds not allowed by promoter policy' };
  }

  const maxPercentage = policy?.maxRefundPercentage ?? 100;
  const maxRefundableHalire = Math.floor(order.totalAmountHalire * maxPercentage / 100);

  return { eligible: true, maxRefundableHalire };
}

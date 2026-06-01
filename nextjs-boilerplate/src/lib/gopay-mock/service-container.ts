import { db as rlsDb } from '@/lib/db/rls-pool';
import { createGopayPayment, GopayPaymentService } from './gopay-payment.service';

// RLS Fáze 2: sdílené context-aware db() místo vlastního Pool. Mock-gopay routes
// běží v service kontextu → query zdědí app.role z ALS.
export interface GopayServiceDeps {
  db: ReturnType<typeof rlsDb>;
  paymentService: GopayPaymentService;
}

let cached: GopayServiceDeps | null = null;

export function getServiceDeps(): GopayServiceDeps {
  if (cached) return cached;
  cached = {
    db: rlsDb(),
    paymentService: createGopayPayment(),
  };
  return cached;
}

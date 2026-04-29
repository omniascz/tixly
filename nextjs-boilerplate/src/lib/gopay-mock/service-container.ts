import { Pool } from 'pg';
import { createGopayPayment, GopayPaymentService } from './gopay-payment.service';

export interface GopayServiceDeps {
  db: Pool;
  paymentService: GopayPaymentService;
}

let cached: GopayServiceDeps | null = null;

export function getServiceDeps(): GopayServiceDeps {
  if (cached) return cached;
  cached = {
    db: new Pool({ connectionString: process.env.DATABASE_URL }),
    paymentService: createGopayPayment(),
  };
  return cached;
}

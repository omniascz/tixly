/**
 * Benefit payment provider handlers registry.
 *
 * Pluxee koupil Sodexo Benefits CZ v 2023 — checkout/route.ts re-mapuje
 * `paymentMethod === 'sodexo'` → `provider = 'pluxee'` před voláním
 * createBenefitPayment(). Tady už není separate 'sodexo' handler nutný.
 *
 * Doplnění real handler = (1) get vendor sandbox docs, (2) validovat
 * payload tvar (curl proti sandbox), (3) sandbox E2E test, (4) production
 * env vars (přes GoPay/promotér portal).
 */
export { createPluxeePayment, verifyPluxeeCallback } from './pluxee';
export {
  createBenefitPlusPayment,
  verifyBenefitPlusCallback,
} from './benefit-plus';
export { createEdenredPayment, verifyEdenredCallback } from './edenred';
export {
  createGalleryBetaPayment,
  verifyGalleryBetaCallback,
} from './gallery-beta';
export { createMultisportPayment, verifyMultisportCallback } from './multisport';

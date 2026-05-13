// =============================================================================
// Phone validator — thin wrapper over @shared/sms-sender
// =============================================================================

import { validatePhone, stripPlus as sharedStripPlus } from '@shared/sms-sender';
import { SmsError } from './sms-errors.js';

/**
 * Validates E.164 format. Returns normalized form (with leading +) or throws SMS_INVALID_PHONE.
 */
export function validateAndNormalizePhone(phone: string): string {
  try {
    return validatePhone(phone);
  } catch {
    throw new SmsError('SMS_INVALID_PHONE');
  }
}

/**
 * Strips leading + (BulkGate wants number without +).
 */
export { sharedStripPlus as stripPlus };

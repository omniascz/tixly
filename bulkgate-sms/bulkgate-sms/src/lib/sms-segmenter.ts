// =============================================================================
// SMS segmenter — thin wrapper over @shared/sms-sender
// =============================================================================

import { countSegments, isWithinLimit } from '@shared/sms-sender';

/**
 * Returns the number of SMS segments the text occupies.
 */
export { countSegments as countSmsSegments };

/**
 * True if text fits within `maxSegments` (default 10).
 */
export { isWithinLimit as isWithinSmsLimit };

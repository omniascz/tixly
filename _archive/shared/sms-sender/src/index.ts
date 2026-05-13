// Phone validation
export { validatePhone, stripPlus, normalizePhone } from './phone.js';

// SMS segmentation
export {
  countSegments,
  isWithinLimit,
  needsUnicode,
  isGsm7,
  gsm7Length,
} from './segmenter.js';

// BulkGate client
export {
  BulkGateClient,
  BulkGateError,
  loadBulkGateConfig,
  BULKGATE_ERROR_CODES,
  DLR_STATUS_MAP,
} from './bulkgate.js';

export type {
  BulkGateConfig,
  BulkGateSendResult,
  BulkGateBulkResult,
} from './bulkgate.js';

export { AnalyticsScripts } from './components/AnalyticsScripts.js';
export { trackEvent } from './lib/track-event.js';
export { loadTrackingConfig } from './lib/load-config.js';
export { META_EVENT_MAP, mapToMetaEvent } from './lib/event-mapping.js';
export type {
  TrackingConfig,
  StandardEventName,
  EventPayload,
  EventItem,
} from './types/tracking.js';

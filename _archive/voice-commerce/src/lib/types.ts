// ============================================================
// Voice Commerce — Type Definitions
// Platform-agnostic intent model. Each voice platform
// (Alexa, Google Assistant, Siri Shortcuts) maps its native
// request format to VoiceRequest, and the response is mapped
// back by the platform adapter.
// ============================================================

// ─── Platforms ───────────────────────────────────────────────

export type VoicePlatform = 'alexa' | 'google_assistant' | 'siri_shortcuts';

// ─── Intents ─────────────────────────────────────────────────

export type IntentName =
  | 'SearchEvents'
  | 'GetEventDetails'
  | 'AddToCart'
  | 'Checkout'
  | 'CheckOrderStatus'
  | 'ListMyTickets'
  | 'CancelOrder'
  | 'AMAZON.HelpIntent'
  | 'AMAZON.CancelIntent'
  | 'AMAZON.StopIntent'
  | 'LaunchRequest';

// ─── Slot (extracted entity from voice input) ────────────────

export interface VoiceSlot {
  name: string;
  value: string | null;
  /** Resolved canonical value (e.g. after entity resolution) */
  resolved?: string;
}

// ─── Normalized incoming voice request ───────────────────────

export interface VoiceRequest {
  platform: VoicePlatform;
  /** Platform-specific session/conversation id */
  sessionId: string;
  /** Authenticated Tixly user id (resolved from account linking) */
  userId?: string;
  intent: IntentName;
  slots: Record<string, VoiceSlot>;
  /** Raw locale from platform (e.g. "cs-CZ", "en-US") */
  locale: string;
  /** True on session start (LaunchRequest / first turn) */
  isNewSession: boolean;
}

// ─── Response card (shown on screens/visual devices) ─────────

export interface VoiceCard {
  title: string;
  content: string;
  imageUrl?: string;
}

// ─── Normalized outgoing voice response ──────────────────────

export interface VoiceResponse {
  /** Text-to-speech output */
  speech: string;
  /** Reprompt if user doesn't respond */
  reprompt?: string;
  /** Optional rich card for screen devices */
  card?: VoiceCard;
  /** Whether to close the session after this response */
  endSession: boolean;
  /** Optional data payload to pass back to platform */
  data?: Record<string, unknown>;
}

// ─── Session state (stored in cache between turns) ───────────

export interface VoiceSession {
  sessionId: string;
  userId?: string;
  platform: VoicePlatform;
  /** Pending cart: eventId + quantity added via voice */
  pendingCart?: { eventId: string; eventName: string; quantity: number; priceHalire: number };
  /** Last intent for context */
  lastIntent?: IntentName;
  lastUpdated: Date;
}

// ─── Domain objects from event/ticket search ─────────────────

export interface VoiceEventResult {
  id: string;
  name: string;
  dateStart: Date;
  venue: string;
  city: string;
  lowestPriceHalire: number;
  availableTickets: number;
}

export interface VoiceOrderSummary {
  orderId: string;
  status: string;
  eventName: string;
  ticketCount: number;
  totalHalire: number;
}

// ─── Adapters ────────────────────────────────────────────────

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

// ─── Errors ──────────────────────────────────────────────────

export class VoiceAuthRequiredError extends Error {
  constructor() {
    super('Account linking required to complete this action');
    this.name = 'VoiceAuthRequiredError';
  }
}

export class VoiceIntentNotFoundError extends Error {
  constructor(intent: string) {
    super(`Unknown voice intent: ${intent}`);
    this.name = 'VoiceIntentNotFoundError';
  }
}

export class VoiceSlotMissingError extends Error {
  constructor(slotName: string) {
    super(`Required slot missing: ${slotName}`);
    this.name = 'VoiceSlotMissingError';
  }
}

export class VoiceCartEmptyError extends Error {
  constructor() {
    super('No items in voice cart');
    this.name = 'VoiceCartEmptyError';
  }
}

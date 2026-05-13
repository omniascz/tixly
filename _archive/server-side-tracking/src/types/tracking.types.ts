export enum TrackingPlatform {
  Meta = 'meta',
  TikTok = 'tiktok',
}

// ─── Kafka Events ────────────────────────────────────────────────────────────

export interface OrderCompletedKafkaEvent {
  orderId: string;
  eventId: string;
  eventName: string;
  totalAmount: number;
  currency: string;
  quantity: number;
  eventPageUrl: string;
  userEmail: string;
  userPhone?: string;
  userFirstName?: string;
  userLastName?: string;
  userIp: string;
  userAgent: string;
  fbcCookie?: string;
  fbpCookie?: string;
  sessionId: string;
  occurredAt: string; // ISO 8601
}

export interface PageViewedKafkaEvent {
  sessionId: string;
  eventId: string;        // the ticketing event UUID (not Kafka event)
  eventName: string;
  pageType: string;       // 'event_detail' | 'home' | 'category' | ...
  pageUrl: string;
  minTicketPrice?: number;
  currency: string;
  userEmail?: string;
  userPhone?: string;
  userIp: string;
  userAgent: string;
  fbcCookie?: string;
  fbpCookie?: string;
  occurredAt: string;
}

export interface OrderCreatedKafkaEvent {
  orderId: string;
  eventId: string;
  eventName: string;
  totalAmount: number;
  currency: string;
  quantity: number;
  eventPageUrl: string;
  userEmail: string;
  userPhone?: string;
  userFirstName?: string;
  userLastName?: string;
  userIp: string;
  userAgent: string;
  fbcCookie?: string;
  fbpCookie?: string;
  sessionId: string;
  occurredAt: string;
}

// ─── Hashed User Data ─────────────────────────────────────────────────────────

export interface UserData {
  hashedEmail?: string;
  hashedPhone?: string;
  hashedFirstName?: string;
  hashedLastName?: string;
  clientIpAddress: string;
  clientUserAgent: string;
  fbcCookie?: string;
  fbpCookie?: string;
}

// ─── Meta Payloads ───────────────────────────────────────────────────────────

export interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  client_ip_address: string;
  client_user_agent: string;
  fbc?: string;
  fbp?: string;
}

export interface MetaPurchaseCustomData {
  currency: string;
  value: number;
  content_ids: string[];
  content_type: 'product';
  content_name: string;
  num_items: number;
}

export interface MetaViewContentCustomData {
  content_ids: string[];
  content_type: 'product';
  content_name: string;
  currency: string;
  value: number;
}

export interface MetaInitiateCheckoutCustomData {
  currency: string;
  value: number;
  content_ids: string[];
  content_type: 'product';
  content_name: string;
  num_items: number;
}

export interface MetaEventData {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: 'website';
  user_data: MetaUserData;
  custom_data: MetaPurchaseCustomData | MetaViewContentCustomData | MetaInitiateCheckoutCustomData;
}

export interface MetaPurchasePayload {
  data: MetaEventData[];
  access_token: string;
  test_event_code?: string;
}

export interface MetaViewContentPayload {
  data: MetaEventData[];
  access_token: string;
  test_event_code?: string;
}

// ─── TikTok Payloads ─────────────────────────────────────────────────────────

export interface TikTokUser {
  email?: string;
  phone_number?: string;
}

export interface TikTokPage {
  url: string;
}

export interface TikTokContext {
  user: TikTokUser;
  page: TikTokPage;
  ip: string;
  user_agent: string;
}

export interface TikTokProperties {
  currency: string;
  value: number;
  content_id?: string;
  content_type?: string;
  content_name?: string;
  quantity?: number;
}

export interface TikTokPurchasePayload {
  pixel_code: string;
  event: string;
  event_time: number;
  event_id: string;
  context: TikTokContext;
  properties: TikTokProperties;
  access_token: string;
}

export type TikTokEventPayload = TikTokPurchasePayload;

// ─── Tracking Result ─────────────────────────────────────────────────────────

export interface TrackingResult {
  platform: TrackingPlatform;
  eventId: string;
  eventName: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  skippedAsDuplicate?: boolean;
}

// ─── Retry Config ────────────────────────────────────────────────────────────

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

// ─── Typed Errors ────────────────────────────────────────────────────────────

export class TrackingApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly platform: TrackingPlatform,
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = 'TrackingApiError';
  }
}

export class DuplicateEventError extends Error {
  constructor(
    public readonly platform: TrackingPlatform,
    public readonly eventId: string,
  ) {
    super(`Duplicate event ${eventId} for platform ${platform}`);
    this.name = 'DuplicateEventError';
  }
}

export class PayloadBuildError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PayloadBuildError';
  }
}

// ─── Dependency Interfaces ───────────────────────────────────────────────────

export interface HttpResponse {
  status: number;
  body: string;
}

export interface HttpClient {
  post(url: string, payload: object, headers?: Record<string, string>): Promise<HttpResponse>;
}

export interface DbAdapter {
  insertSentEvent(params: {
    platform: TrackingPlatform;
    eventName: string;
    eventId: string;
    payload: object;
    responseStatus: number;
    responseBody: string;
    attempts: number;
  }): Promise<void>;

  insertFailedEvent(params: {
    platform: TrackingPlatform;
    eventName: string;
    eventId: string;
    payload: object;
    lastError: string;
    attempts: number;
  }): Promise<void>;

  getFailedEventsForRetry(): Promise<FailedEventRow[]>;

  deleteFailedEvent(id: string): Promise<void>;

  incrementFailedEventAttempts(id: string, retryAfterDays: number): Promise<void>;
}

export interface FailedEventRow {
  id: string;
  platform: TrackingPlatform;
  eventName: string;
  eventId: string;
  payload: object;
  lastError: string;
  attempts: number;
}

export interface RedisAdapter {
  exists(key: string): Promise<boolean>;
  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface ServiceDeps {
  httpClient: HttpClient;
  db: DbAdapter;
  redis: RedisAdapter;
  logger: Logger;
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

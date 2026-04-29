export type TriggerEvent = 'event.published' | 'order.completed' | 'attendee.checked_in' | 'order.refunded';
export type ActionType = 'createContact' | 'sendSlackNotification' | 'addToGoogleSheets';
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

export interface WebhookSubscription {
  id: string;
  organizerId: string;
  targetUrl: string;
  triggerEvent: TriggerEvent;
  secret: string;          // HMAC signing secret
  isActive: boolean;
  createdAt: Date;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  responseCode: number | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface ZapierAction {
  id: string;
  organizerId: string;
  actionType: ActionType;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
}

export interface ActionInput {
  organizerId: string;
  actionType: ActionType;
  config: Record<string, unknown>;
}

export interface SubscriptionInput {
  organizerId: string;
  targetUrl: string;
  triggerEvent: TriggerEvent;
  secret: string;
}

export class ZapierError extends Error {
  constructor(
    public readonly code: 'SUBSCRIPTION_NOT_FOUND' | 'INVALID_SIGNATURE' | 'DELIVERY_FAILED' | 'ACTION_NOT_FOUND' | 'INVALID_ACTION_CONFIG',
    message: string,
  ) {
    super(message);
    this.name = 'ZapierError';
  }
}

export interface HttpAdapter {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; ok: boolean }>;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  http: HttpAdapter;
}

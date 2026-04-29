// ---------------------------------------------------------------------------
// Webhooks — Error codes
// ---------------------------------------------------------------------------

export type WebhookErrorCode =
  | 'ENDPOINT_NOT_FOUND'   // 404
  | 'ENDPOINT_DUPLICATE'   // 409
  | 'INVALID_EVENT_TYPE'   // 422
  | 'DELIVERY_NOT_FOUND'   // 404
  | 'SIGNATURE_INVALID';   // 400

const HTTP_STATUS: Record<WebhookErrorCode, number> = {
  ENDPOINT_NOT_FOUND: 404,
  ENDPOINT_DUPLICATE: 409,
  INVALID_EVENT_TYPE: 422,
  DELIVERY_NOT_FOUND: 404,
  SIGNATURE_INVALID: 400,
};

const DEFAULT_MESSAGES: Record<WebhookErrorCode, string> = {
  ENDPOINT_NOT_FOUND: 'Webhook endpoint not found.',
  ENDPOINT_DUPLICATE: 'A webhook endpoint with this URL already exists for this promoter.',
  INVALID_EVENT_TYPE: 'One or more event types are not valid.',
  DELIVERY_NOT_FOUND: 'Webhook delivery not found.',
  SIGNATURE_INVALID: 'Webhook signature is invalid.',
};

export class WebhookError extends Error {
  public readonly code: WebhookErrorCode;
  public readonly statusCode: number;

  constructor(code: WebhookErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'WebhookError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, WebhookError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isWebhookError(err: unknown): err is WebhookError {
  return err instanceof WebhookError;
}

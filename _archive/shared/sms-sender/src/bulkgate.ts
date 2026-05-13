/**
 * BulkGate HTTP client — shared across Mailforge and Tixly.
 *
 * Endpoints:
 *   POST /simple/transactional  — single SMS
 *   POST /advanced/transactional — bulk SMS
 *
 * Docs: https://help.bulkgate.com/docs/en/http-simple-transactional-sms.html
 */

import { stripPlus } from './phone.js';
import { needsUnicode } from './segmenter.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BulkGateConfig {
  /** BulkGate application ID. */
  applicationId: string | number;
  /** BulkGate application token. */
  applicationToken: string;
  /** API base URL. Default: https://portal.bulkgate.com/api/1.0 */
  apiBaseUrl?: string;
  /** Sender ID type. Default: 'gText' */
  senderId?: string;
  /** Sender display name. Max 11 chars for alphanumeric. */
  senderIdValue?: string;
  /** Base URL for DLR callback (delivery reports). */
  dlrBaseUrl?: string;
  /** Request timeout in ms. Default: 30000 */
  timeoutMs?: number;
}

export interface BulkGateSendResult {
  /** BulkGate SMS ID. */
  smsId: string;
  /** Delivery status from BulkGate. */
  status: string;
  /** Cost in provider currency (EUR). */
  price: number | null;
}

export interface BulkGateBulkResult {
  /** Phone numbers that were accepted. */
  accepted: string[];
  /** Phone numbers that were rejected with reasons. */
  rejected: Array<{ phone: string; reason: string }>;
}

/** BulkGate error codes mapped to error info. */
export const BULKGATE_ERROR_CODES: Record<number, { code: string; retryable: boolean }> = {
  13: { code: 'INVALID_NUMBER', retryable: false },
  14: { code: 'BLACKLISTED', retryable: false },
  20: { code: 'INSUFFICIENT_CREDITS', retryable: true },
  28: { code: 'DAILY_LIMIT', retryable: true },
  30: { code: 'SENDER_BLOCKED', retryable: false },
};

/** DLR status mapping: BulkGate status → normalized status. */
export const DLR_STATUS_MAP: Record<string, string> = {
  delivered: 'delivered',
  undelivered: 'failed',
  expired: 'failed',
  rejected: 'failed',
  accepted: 'sent',
  buffered: 'queued',
};

// ─── API response types ──────────────────────────────────────────────────────

interface SimpleResponse {
  data?: {
    sms_id?: string;
    status?: string;
    price?: string | number;
    currency?: string;
    country?: string;
    number?: string;
    error?: string;
    error_code?: number;
    credit?: number;
    channel?: string;
  };
  error?: string;
}

interface AdvancedResponse {
  data?: {
    response?: Array<{
      status?: string;
      sms_id?: string;
      number?: string;
      error?: string;
      price?: number;
    }>;
  };
  error?: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://portal.bulkgate.com/api/1.0';

export class BulkGateClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: BulkGateConfig) {
    this.baseUrl = config.apiBaseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  /**
   * Send a single SMS via /simple/transactional.
   */
  async sendSingle(phone: string, text: string): Promise<BulkGateSendResult> {
    const payload: Record<string, unknown> = {
      application_id: this.config.applicationId,
      application_token: this.config.applicationToken,
      number: stripPlus(phone),
      text,
      unicode: needsUnicode(text) ? 1 : 0,
    };

    if (this.config.senderId) {
      payload.sender_id = this.config.senderId;
    }
    if (this.config.senderIdValue) {
      payload.sender_id_value = this.config.senderIdValue.slice(0, 11);
    }
    if (this.config.dlrBaseUrl) {
      payload.dlr_url = this.config.dlrBaseUrl;
    }

    const response = await this.post('/simple/transactional', payload);
    const parsed = response as SimpleResponse;
    const data = parsed.data;

    if (!data || (data.status !== 'accepted' && !data.sms_id)) {
      const errorCode = data?.error_code;
      const mapped = errorCode !== undefined
        ? (BULKGATE_ERROR_CODES[errorCode] ?? null)
        : null;

      throw new BulkGateError(
        mapped?.code ?? 'PROVIDER_ERROR',
        data?.error ?? parsed.error ?? 'BulkGate rejected the message',
        mapped?.retryable ?? false,
        data,
      );
    }

    const price = data.price != null ? parseFloat(String(data.price)) : null;

    return {
      smsId: data.sms_id!,
      status: data.status ?? 'sent',
      price: price !== null && !isNaN(price) ? price : null,
    };
  }

  /**
   * Send bulk SMS via /advanced/transactional.
   */
  async sendBulk(phones: string[], text: string): Promise<BulkGateBulkResult> {
    if (phones.length === 0) {
      return { accepted: [], rejected: [] };
    }

    const payload = {
      application_id: this.config.applicationId,
      application_token: this.config.applicationToken,
      messages: phones.map((phone) => ({
        number: stripPlus(phone),
        text,
        unicode: needsUnicode(text) ? 1 : 0,
        ...(this.config.senderId && { sender_id: this.config.senderId }),
        ...(this.config.senderIdValue && { sender_id_value: this.config.senderIdValue.slice(0, 11) }),
      })),
    };

    const response = await this.post('/advanced/transactional', payload);
    const parsed = response as AdvancedResponse;

    const accepted: string[] = [];
    const rejected: Array<{ phone: string; reason: string }> = [];
    const responseArr = parsed.data?.response ?? [];

    for (let i = 0; i < phones.length; i++) {
      const phone = phones[i]!;
      const item = responseArr[i];
      if (item && (item.status === 'accepted' || item.status === 'sent' || item.sms_id)) {
        accepted.push(phone);
      } else {
        rejected.push({
          phone,
          reason: item?.error ?? item?.status ?? 'provider_error',
        });
      }
    }

    return { accepted, rejected };
  }

  /**
   * Low-level POST helper.
   */
  private async post(path: string, body: unknown): Promise<unknown> {
    let httpResp: Response;
    try {
      httpResp = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new BulkGateError(
        'NETWORK_ERROR',
        (err as Error).message,
        true,
      );
    }

    const rawText = await httpResp.text();

    if (!httpResp.ok) {
      throw BulkGateError.fromHttpStatus(httpResp.status, rawText);
    }

    try {
      return JSON.parse(rawText);
    } catch {
      throw new BulkGateError('PROVIDER_ERROR', `Invalid JSON response: ${rawText.slice(0, 200)}`, false);
    }
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class BulkGateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly providerData?: unknown,
  ) {
    super(message);
    this.name = 'BulkGateError';
  }

  static fromHttpStatus(status: number, body: string): BulkGateError {
    if (status === 401 || status === 403) {
      return new BulkGateError('NOT_CONFIGURED', `BulkGate auth failed (${status})`, false, body);
    }
    if (status === 402) {
      return new BulkGateError('INSUFFICIENT_CREDITS', 'BulkGate insufficient credits', true, body);
    }
    if (status === 429) {
      return new BulkGateError('RATE_LIMITED', 'BulkGate rate limited', true, body);
    }
    return new BulkGateError(
      'PROVIDER_ERROR',
      `BulkGate HTTP ${status}: ${body.slice(0, 200)}`,
      status >= 500,
      body,
    );
  }
}

// ─── Config loader ─────────────────────────────────────────────────────────���─

/**
 * Load BulkGate config from environment variables.
 * Returns null if not configured (missing APP_ID or APP_TOKEN).
 */
export function loadBulkGateConfig(): BulkGateConfig | null {
  const appId = process.env.BULKGATE_APP_ID;
  const appToken = process.env.BULKGATE_APP_TOKEN;

  if (!appId || !appToken) {
    return null;
  }

  return {
    applicationId: appId,
    applicationToken: appToken,
    apiBaseUrl: process.env.BULKGATE_API_BASE_URL ?? DEFAULT_BASE_URL,
    senderId: process.env.BULKGATE_SENDER_ID ?? 'gText',
    senderIdValue: process.env.BULKGATE_SENDER_ID_VALUE,
  };
}

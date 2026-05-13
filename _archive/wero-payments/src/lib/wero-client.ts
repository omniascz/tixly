// =============================================================================
// Wero HTTP Client — low-level wrapper nad Wero SEPA Instant API
//
// REST API s OAuth2 client_credentials flow. Timing-safe signature validation.
// DEV režim: stubnuté odpovědi a logování.
// =============================================================================

import crypto from 'crypto';
import type { WeroWebhook } from '../types/wero.js';
import { WeroError } from './wero-errors.js';

interface WeroConfig {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;  // e.g., https://api.wero.io
  webhookSecret: string;  // HMAC-SHA256 webhook signature secret
  isConfigured: boolean;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface WeroInitiatePaymentResponse {
  redirectUrl: string;
  paymentId: string;
  status: string;
}

export interface WeroGetPaymentResponse {
  id: string;
  status: string;
  orderId: string;
  amount: number;
  iban: string;
  errorCode?: string;
  errorMessage?: string;
}

export class WeroHttpClient {
  private cachedToken: CachedToken | null = null;
  private config: WeroConfig;

  constructor(clientId: string, clientSecret: string, config?: Partial<WeroConfig>) {
    this.config = {
      clientId,
      clientSecret,
      apiBaseUrl: config?.apiBaseUrl ?? process.env.WERO_API_BASE_URL ?? 'https://api.wero.io',
      webhookSecret: config?.webhookSecret ?? process.env.WERO_WEBHOOK_SECRET ?? '',
      isConfigured: !!(clientId && clientSecret && config?.webhookSecret),
    };
  }

  // -------------------------------------------------------------------------
  // OAuth2 access token (client_credentials)
  // -------------------------------------------------------------------------
  private async getAccessToken(): Promise<string> {
    if (!this.config.isConfigured) {
      throw new WeroError('WERO_NOT_CONFIGURED');
    }

    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - now > 60_000) {
      return this.cachedToken.token;
    }

    const basicAuth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
      'utf8',
    ).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'payment-initiate',
    }).toString();

    let response: Response;
    try {
      response = await fetch(`${this.config.apiBaseUrl}/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
      });
    } catch (err) {
      throw new WeroError(
        'WERO_AUTH_FAILED',
        `Síťová chyba při získávání Wero access tokenu: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new WeroError('WERO_AUTH_FAILED');
    }

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new WeroError('WERO_AUTH_FAILED', 'Wero nevrátilo access_token.');
    }

    const expiresInMs = (json.expires_in ?? 1800) * 1000;
    this.cachedToken = {
      token: json.access_token,
      expiresAt: now + expiresInMs,
    };

    return json.access_token;
  }

  // -------------------------------------------------------------------------
  // initiatePayment — POST /payments/initiate
  // Returns redirectUrl for user to authorize + internal paymentId
  // -------------------------------------------------------------------------
  async initiatePayment(
    orderId: string,
    amountHalire: number,
    returnUrl: string,
  ): Promise<WeroInitiatePaymentResponse> {
    if (!this.config.isConfigured) {
      console.log(
        `[wero-payments DEV] initiatePayment orderId=${orderId} amount=${amountHalire}`,
      );
      return {
        redirectUrl: `/dev/wero-stub?paymentId=dev-${Date.now()}`,
        paymentId: `dev-${Date.now()}`,
        status: 'initiated',
      };
    }

    const token = await this.getAccessToken();

    const payload = {
      orderId,
      amount: amountHalire,
      returnUrl,
      metadata: {
        source: 'tixly',
        timestamp: new Date().toISOString(),
      },
    };

    let response: Response;
    try {
      response = await fetch(`${this.config.apiBaseUrl}/payments/initiate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new WeroError(
        'WERO_API_ERROR',
        `Síťová chyba při iniciaci Wero platby: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new WeroError('WERO_API_ERROR', `Wero initiatePayment selhalo: ${text || response.status}`);
    }

    return (await response.json()) as WeroInitiatePaymentResponse;
  }

  // -------------------------------------------------------------------------
  // getPaymentStatus — GET /payments/{paymentId}
  // -------------------------------------------------------------------------
  async getPaymentStatus(paymentId: string): Promise<WeroGetPaymentResponse> {
    if (!this.config.isConfigured) {
      return {
        id: paymentId,
        status: 'confirmed',
        orderId: '',
        amount: 0,
        iban: '',
      };
    }

    const token = await this.getAccessToken();

    let response: Response;
    try {
      response = await fetch(`${this.config.apiBaseUrl}/payments/${encodeURIComponent(paymentId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      throw new WeroError(
        'WERO_API_ERROR',
        `Síťová chyba při načítání Wero platby: ${(err as Error).message}`,
      );
    }

    if (response.status === 404) {
      throw new WeroError('WERO_PAYMENT_NOT_FOUND');
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new WeroError('WERO_API_ERROR', `Wero getPayment selhalo: ${text || response.status}`);
    }

    return (await response.json()) as WeroGetPaymentResponse;
  }

  // -------------------------------------------------------------------------
  // verifySignature — Timing-safe HMAC-SHA256 signature validation
  // Wero sends: X-Wero-Signature header with HMAC-SHA256(payload, secret)
  // -------------------------------------------------------------------------
  verifySignature(payload: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex');

    // Timing-safe comparison: prevents timing attacks
    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // handleWebhook — Parse + validate webhook payload
  // -------------------------------------------------------------------------
  handleWebhook(payload: WeroWebhook, signature: string): WeroWebhook {
    const payloadStr = JSON.stringify(payload);
    if (!this.verifySignature(payloadStr, signature)) {
      throw new WeroError('WERO_INVALID_WEBHOOK_SIGNATURE');
    }
    return payload;
  }

  // Exportováno pro testy
  __clearTokenCache(): void {
    this.cachedToken = null;
  }
}

// Factory function for easy creation
export function createWeroClient(clientId: string, clientSecret: string): WeroHttpClient {
  return new WeroHttpClient(clientId, clientSecret, {
    webhookSecret: process.env.WERO_WEBHOOK_SECRET,
  });
}

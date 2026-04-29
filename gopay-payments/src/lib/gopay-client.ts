// =============================================================================
// GoPay HTTP Client — low-level wrapper nad REST API
//
// OAuth2 client_credentials flow s cache tokenu.
// DEV režim (!config.isConfigured): vrací stubnuté odpovědi a loguje.
// =============================================================================

import type { GopayConfig } from './gopay-config.js';
import { GopayError } from './gopay-errors.js';

interface CachedToken {
  token: string;
  expiresAt: number;  // epoch ms
}

export interface GopayCreatePaymentResponse {
  id: string;
  gw_url: string;
  state: string;
  payment_instrument?: string;
}

export interface GopayGetPaymentResponse {
  id: string;
  state: string;
  payment_instrument?: string;
  amount: number;
  currency: string;
}

export interface GopayRefundResponse {
  result: string;
}

export class GopayHttpClient {
  private cachedToken: CachedToken | null = null;

  constructor(private config: GopayConfig) {}

  // -------------------------------------------------------------------------
  // OAuth2 access token (client_credentials)
  // -------------------------------------------------------------------------
  async getAccessToken(): Promise<string> {
    if (!this.config.isConfigured) {
      throw new GopayError('GOPAY_NOT_CONFIGURED');
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
      scope: 'payment-create',
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
      throw new GopayError(
        'GOPAY_AUTH_FAILED',
        `Síťová chyba při získávání GoPay access tokenu: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new GopayError('GOPAY_AUTH_FAILED');
    }

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new GopayError('GOPAY_AUTH_FAILED', 'GoPay nevrátilo access_token.');
    }

    const expiresInMs = (json.expires_in ?? 1800) * 1000;
    this.cachedToken = {
      token: json.access_token,
      expiresAt: now + expiresInMs,
    };

    return json.access_token;
  }

  // -------------------------------------------------------------------------
  // createPayment — POST /payments/payment
  // -------------------------------------------------------------------------
  async createPayment(payload: object): Promise<GopayCreatePaymentResponse> {
    if (!this.config.isConfigured) {
      // eslint-disable-next-line no-console
      console.log('[gopay-payments DEV] createPayment payload:', JSON.stringify(payload, null, 2));
      return {
        id: `dev-${Date.now()}`,
        gw_url: '/dev/gopay-stub',
        state: 'CREATED',
      };
    }

    const token = await this.getAccessToken();
    const response = await fetch(`${this.config.apiBaseUrl}/payments/payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new GopayError('GOPAY_API_ERROR', `GoPay createPayment selhalo: ${text || response.status}`);
    }

    return (await response.json()) as GopayCreatePaymentResponse;
  }

  // -------------------------------------------------------------------------
  // getPayment — GET /payments/payment/{id}
  // -------------------------------------------------------------------------
  async getPayment(paymentId: string): Promise<GopayGetPaymentResponse> {
    if (!this.config.isConfigured) {
      return {
        id: paymentId,
        state: 'PAID',
        amount: 0,
        currency: 'CZK',
      };
    }

    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.config.apiBaseUrl}/payments/payment/${encodeURIComponent(paymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );

    if (response.status === 404) {
      throw new GopayError('GOPAY_PAYMENT_NOT_FOUND');
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new GopayError('GOPAY_API_ERROR', `GoPay getPayment selhalo: ${text || response.status}`);
    }

    return (await response.json()) as GopayGetPaymentResponse;
  }

  // -------------------------------------------------------------------------
  // refundPayment — POST /payments/payment/{id}/refund
  // -------------------------------------------------------------------------
  async refundPayment(paymentId: string, amountHalire: number): Promise<GopayRefundResponse> {
    if (!this.config.isConfigured) {
      // eslint-disable-next-line no-console
      console.log(`[gopay-payments DEV] refundPayment id=${paymentId} amount=${amountHalire}`);
      return { result: 'FINISHED' };
    }

    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.config.apiBaseUrl}/payments/payment/${encodeURIComponent(paymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ amount: String(amountHalire) }).toString(),
      },
    );

    if (response.status === 404) {
      throw new GopayError('GOPAY_PAYMENT_NOT_FOUND');
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new GopayError('GOPAY_API_ERROR', `GoPay refundPayment selhalo: ${text || response.status}`);
    }

    return (await response.json()) as GopayRefundResponse;
  }

  // Exportováno pro testy
  __clearTokenCache(): void {
    this.cachedToken = null;
  }
}

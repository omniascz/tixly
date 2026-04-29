/**
 * Tixly BulkGate client wrapper.
 *
 * Delegates to @shared/sms-sender BulkGateClient, adding:
 * - Dev mode fallback (console.log instead of API call)
 * - Cost in haléře (integer CZK subunit)
 */

import {
  BulkGateClient as SharedClient,
  BulkGateError,
} from '@shared/sms-sender';
import { SmsError } from './sms-errors.js';
import type { BulkgateConfig } from './bulkgate-config.js';

export interface SendSingleResult {
  smsId: string;
  status: string;
  priceHalire: number | null;
}

export interface SendBulkResult {
  accepted: string[];
  rejected: Array<{ phone: string; reason: string }>;
}

function mapSharedError(err: BulkGateError): SmsError {
  switch (err.code) {
    case 'NOT_CONFIGURED':
      return new SmsError('SMS_NOT_CONFIGURED', undefined, err);
    case 'INSUFFICIENT_CREDITS':
      return new SmsError('SMS_INSUFFICIENT_CREDIT', undefined, err);
    case 'RATE_LIMITED':
      return new SmsError('SMS_RATE_LIMITED', undefined, err);
    case 'INVALID_NUMBER':
      return new SmsError('SMS_INVALID_PHONE', undefined, err);
    default:
      return new SmsError('SMS_PROVIDER_ERROR', err.message, err);
  }
}

export class BulkgateClient {
  private readonly client: SharedClient | null;

  constructor(private config: BulkgateConfig) {
    if (config.isConfigured) {
      this.client = new SharedClient({
        applicationId: config.appId,
        applicationToken: config.appToken,
        apiBaseUrl: config.apiBaseUrl,
        senderId: config.senderId,
        senderIdValue: config.senderIdValue,
      });
    } else {
      this.client = null;
    }
  }

  /** Send a single SMS via /simple/transactional */
  async sendSingle(phone: string, text: string): Promise<SendSingleResult> {
    if (!this.client) {
      console.log(`[bulkgate-dev] would send to ${phone}: ${text}`);
      return { smsId: `dev-${Date.now()}`, status: 'sent', priceHalire: 0 };
    }

    try {
      const result = await this.client.sendSingle(phone, text);
      const priceHalire = result.price !== null
        ? Math.round(result.price * 100)
        : null;

      return {
        smsId: result.smsId,
        status: result.status,
        priceHalire,
      };
    } catch (err) {
      if (err instanceof BulkGateError) {
        throw mapSharedError(err);
      }
      throw new SmsError('SMS_PROVIDER_ERROR', 'Nepodařilo se spojit s BulkGate API.', err);
    }
  }

  /**
   * Send bulk via /advanced/transactional.
   */
  async sendBulk(phones: string[], text: string): Promise<SendBulkResult> {
    if (!this.client) {
      for (const p of phones) {
        console.log(`[bulkgate-dev] would send to ${p}: ${text}`);
      }
      return { accepted: [...phones], rejected: [] };
    }

    if (phones.length === 0) {
      return { accepted: [], rejected: [] };
    }

    try {
      return await this.client.sendBulk(phones, text);
    } catch (err) {
      if (err instanceof BulkGateError) {
        throw mapSharedError(err);
      }
      throw new SmsError('SMS_PROVIDER_ERROR', 'Nepodařilo se spojit s BulkGate API.', err);
    }
  }
}

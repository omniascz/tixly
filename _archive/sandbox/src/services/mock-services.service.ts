/**
 * Mock external services — provides deterministic fake responses for
 * payment processors, email, SMS, etc. so developers don't hit real APIs.
 *
 * Special test tokens trigger specific failure scenarios:
 *   - "tok_success"       → immediate success
 *   - "tok_declined"      → card declined
 *   - "tok_insufficient"  → insufficient funds
 *   - "tok_3ds"           → requires 3DS challenge
 *   - "tok_timeout"       → request times out
 *   - "tok_fraud"         → fraud rejection
 */
import { randomBytes } from 'crypto';
import { SandboxError } from '../lib/sandbox-errors.js';

// ---------------------------------------------------------------------------
// Payment mock
// ---------------------------------------------------------------------------

export type PaymentStatus = 'succeeded' | 'declined' | 'requires_action' | 'fraud' | 'pending';

export interface MockPaymentResult {
  id: string;
  status: PaymentStatus;
  amountHellers: number;
  currency: string;
  declineReason?: string;
  threeDsRedirectUrl?: string;
  createdAt: Date;
}

export interface MockPaymentInput {
  amountHellers: number;
  currency: string;
  cardToken: string;
  description?: string;
}

export function processMockPayment(input: MockPaymentInput): MockPaymentResult {
  if (input.amountHellers <= 0) throw new SandboxError('MOCK_REQUEST_INVALID', 'Amount must be positive.');
  if (!input.cardToken) throw new SandboxError('MOCK_REQUEST_INVALID', 'cardToken required.');

  const id = 'pay_mock_' + randomBytes(8).toString('hex');
  const base = {
    id,
    amountHellers: input.amountHellers,
    currency: input.currency,
    createdAt: new Date(),
  };

  switch (input.cardToken) {
    case 'tok_success':
      return { ...base, status: 'succeeded' };
    case 'tok_declined':
      return { ...base, status: 'declined', declineReason: 'card_declined' };
    case 'tok_insufficient':
      return { ...base, status: 'declined', declineReason: 'insufficient_funds' };
    case 'tok_3ds':
      return { ...base, status: 'requires_action', threeDsRedirectUrl: `https://sandbox.example/3ds/${id}` };
    case 'tok_fraud':
      return { ...base, status: 'fraud', declineReason: 'fraud_rejected' };
    case 'tok_timeout':
      throw new SandboxError('MOCK_REQUEST_INVALID', 'Simulated timeout.');
    default:
      // Default: success for any other token
      return { ...base, status: 'succeeded' };
  }
}

// ---------------------------------------------------------------------------
// Email mock
// ---------------------------------------------------------------------------

export interface MockEmailInput {
  to: string;
  subject: string;
  body: string;
}

export interface MockEmailResult {
  id: string;
  to: string;
  subject: string;
  sentAt: Date;
  status: 'queued' | 'sent' | 'bounced';
}

// Keep the in-memory inbox for tests. Exported so tests can inspect it.
const MOCK_INBOX = new Map<string, MockEmailResult[]>();

export function sendMockEmail(input: MockEmailInput): MockEmailResult {
  if (!input.to || !input.subject) {
    throw new SandboxError('MOCK_REQUEST_INVALID', 'to and subject required.');
  }
  const to = input.to.toLowerCase();
  const id = 'mail_mock_' + randomBytes(8).toString('hex');

  // Special: bounce@sandbox.example always bounces
  const status: MockEmailResult['status'] = to.startsWith('bounce@') ? 'bounced' : 'sent';

  const result: MockEmailResult = {
    id, to, subject: input.subject, sentAt: new Date(), status,
  };

  if (!MOCK_INBOX.has(to)) MOCK_INBOX.set(to, []);
  MOCK_INBOX.get(to)!.push(result);

  return result;
}

export function getMockInbox(email: string): MockEmailResult[] {
  return MOCK_INBOX.get(email.toLowerCase()) ?? [];
}

export function clearMockInbox(email?: string): void {
  if (email) MOCK_INBOX.delete(email.toLowerCase());
  else MOCK_INBOX.clear();
}

// ---------------------------------------------------------------------------
// SMS mock
// ---------------------------------------------------------------------------

export interface MockSmsInput {
  to: string;
  body: string;
}

export interface MockSmsResult {
  id: string;
  to: string;
  status: 'delivered' | 'failed';
  sentAt: Date;
}

const MOCK_SMS_LOG: MockSmsResult[] = [];

export function sendMockSms(input: MockSmsInput): MockSmsResult {
  if (!input.to || !input.body) {
    throw new SandboxError('MOCK_REQUEST_INVALID', 'to and body required.');
  }
  const result: MockSmsResult = {
    id: 'sms_mock_' + randomBytes(8).toString('hex'),
    to: input.to,
    status: input.to.startsWith('+0000') ? 'failed' : 'delivered',
    sentAt: new Date(),
  };
  MOCK_SMS_LOG.push(result);
  return result;
}

export function getMockSmsLog(): MockSmsResult[] {
  return [...MOCK_SMS_LOG];
}

export function clearMockSmsLog(): void {
  MOCK_SMS_LOG.length = 0;
}

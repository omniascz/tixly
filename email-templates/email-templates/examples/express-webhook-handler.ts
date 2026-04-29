/**
 * Express webhook handler for Mailgun email events
 *
 * Mailgun sends webhooks for email delivery, opens, clicks, bounces, etc.
 * This handler processes those events and updates the database accordingly.
 *
 * Setup:
 * 1. Go to Mailgun dashboard → Domain → Webhooks
 * 2. Add webhook URL: https://tixly.cz/webhooks/mailgun
 * 3. Enable: delivered, opened, clicked, failed, unsubscribed, bounced
 */

import { Request, Response, Router } from 'express';
import crypto from 'crypto';

/**
 * Mailgun webhook signature verification
 * Ensures webhook comes from Mailgun and not a third party
 */
function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  apiKey: string
): boolean {
  const hash = crypto
    .createHmac('sha256', apiKey)
    .update(timestamp + token)
    .digest('hex');

  return hash === signature;
}

/**
 * Mailgun webhook event types
 */
interface MailgunEvent {
  'event-data': {
    event: string; // 'delivered', 'opened', 'clicked', 'failed', 'unsubscribed', 'bounced'
    timestamp: number;
    id: string;
    recipient: string;
    domain: string;
    'user-variables'?: Record<string, unknown>;
    tags?: string[];
    severity?: string; // for bounces: 'temporary', 'permanent'
    reason?: string; // for bounces/failures
    'message-headers'?: Record<string, string>;
    [key: string]: unknown;
  };
  signature: {
    timestamp: string;
    token: string;
    signature: string;
  };
}

/**
 * Simulated database interface
 * Replace with actual database client (e.g., Prisma, TypeORM, Supabase)
 */
interface Database {
  emailEvents: {
    create: (data: {
      recipient: string;
      eventType: string;
      timestamp: Date;
      data: Record<string, unknown>;
    }) => Promise<void>;
  };
  users: {
    findByEmail: (email: string) => Promise<{ id: string } | null>;
    update: (id: string, data: Record<string, unknown>) => Promise<void>;
  };
  emailBounces: {
    create: (data: {
      email: string;
      reason: string;
      bounceType: 'permanent' | 'temporary';
    }) => Promise<void>;
  };
}

// Mock database - replace with real implementation
const db: Database = {
  emailEvents: {
    create: async (data) => {
      console.log(`📧 Email event: ${data.eventType} to ${data.recipient}`);
    },
  },
  users: {
    findByEmail: async (email) => {
      // Find user by email in database
      return null;
    },
    update: async (id, data) => {
      console.log(`👤 Updated user ${id}:`, data);
    },
  },
  emailBounces: {
    create: async (data) => {
      console.log(`⚠️  Email bounce: ${data.email} (${data.bounceType})`);
    },
  },
};

/**
 * Main webhook handler
 */
export async function handleMailgunWebhook(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const apiKey = process.env.MAILGUN_API_KEY || '';
    const body = req.body as MailgunEvent;
    const { timestamp, token, signature } = body.signature;

    // 1. Verify webhook signature (CRITICAL for security)
    const isValid = verifyMailgunSignature(timestamp, token, signature, apiKey);
    if (!isValid) {
      console.warn('❌ Invalid Mailgun webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // 2. Extract event data
    const eventData = body['event-data'];
    const eventType = eventData.event as string;
    const recipient = eventData.recipient as string;
    const timestamp_ms = eventData.timestamp * 1000;
    const eventDate = new Date(timestamp_ms);

    // 3. Log event
    console.log(`📬 Mailgun webhook: ${eventType} from ${recipient}`);

    // 4. Store event in database (for analytics)
    await db.emailEvents.create({
      recipient,
      eventType,
      timestamp: eventDate,
      data: eventData,
    });

    // 5. Find user and update stats
    const user = await db.users.findByEmail(recipient);

    if (user) {
      switch (eventType) {
        case 'delivered':
          // Email successfully delivered
          await db.users.update(user.id, {
            email_last_delivered: eventDate,
            email_delivery_status: 'delivered',
          });
          console.log(`✅ Delivered to ${recipient}`);
          break;

        case 'opened':
          // Email was opened by recipient
          await db.users.update(user.id, {
            email_last_opened: eventDate,
            email_opened_count: (eventData['user-variables']?.['open_count'] as number) || 1,
          });
          console.log(`👁️  Opened by ${recipient}`);
          break;

        case 'clicked':
          // Email link was clicked
          const clickedUrl = (eventData as Record<string, unknown>)['url'] as string;
          await db.users.update(user.id, {
            email_last_clicked: eventDate,
            email_clicked_count: (eventData['user-variables']?.['click_count'] as number) || 1,
            email_last_clicked_url: clickedUrl,
          });
          console.log(`🔗 Clicked link: ${clickedUrl} from ${recipient}`);
          break;

        case 'unsubscribed':
          // User unsubscribed from notifications
          await db.users.update(user.id, {
            email_notifications_enabled: false,
            email_unsubscribed_at: eventDate,
            email_unsubscribe_reason: (eventData['user-variables']?.['reason'] as string) || 'user_request',
          });
          console.log(`🔕 Unsubscribed: ${recipient}`);
          break;

        case 'bounced':
          // Email bounced (delivery failed)
          const bounceType = eventData.severity as 'temporary' | 'permanent' || 'permanent';
          const bounceReason = eventData.reason as string;

          // Record bounce
          await db.emailBounces.create({
            email: recipient,
            reason: bounceReason,
            bounceType,
          });

          // For permanent bounces, disable notifications
          if (bounceType === 'permanent') {
            await db.users.update(user.id, {
              email_notifications_enabled: false,
              email_bounced_at: eventDate,
              email_bounce_reason: bounceReason,
            });
            console.log(`❌ Permanent bounce: ${recipient} (${bounceReason})`);
          } else {
            console.log(`⚠️  Temporary bounce: ${recipient} (${bounceReason})`);
          }
          break;

        case 'failed':
          // Email sending failed (before delivery)
          const failureReason = eventData.reason as string;
          console.log(`❌ Failed to send: ${recipient} (${failureReason})`);

          await db.users.update(user.id, {
            email_last_failed_at: eventDate,
            email_last_failure_reason: failureReason,
          });
          break;

        case 'complained':
          // User marked email as spam
          await db.users.update(user.id, {
            email_notifications_enabled: false,
            email_complained_at: eventDate,
          });
          console.log(`📛 Spam complaint: ${recipient}`);
          break;
      }
    }

    // 6. Return success response to Mailgun
    res.json({ ok: true, event: eventType });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    // Always return 200 to Mailgun to prevent retries
    res.status(200).json({ error: 'Processing error' });
  }
}

/**
 * Express router setup
 */
export function createMailgunWebhookRouter(): Router {
  const router = Router();

  // POST /webhooks/mailgun
  router.post('/mailgun', handleMailgunWebhook);

  // GET /webhooks/mailgun/health - Health check for monitoring
  router.get('/mailgun/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      mailgun_api_key: process.env.MAILGUN_API_KEY ? 'configured' : 'missing',
    });
  });

  // POST /webhooks/mailgun/test - Manual test webhook
  router.post('/mailgun/test', async (req: Request, res: Response) => {
    const testWebhook: MailgunEvent = {
      'event-data': {
        event: 'delivered',
        timestamp: Math.floor(Date.now() / 1000),
        id: 'test-event-' + Date.now(),
        recipient: 'test@example.com',
        domain: process.env.MAILGUN_DOMAIN || 'tixly.cz',
        'user-variables': {
          order_id: 'ORD-TEST-001',
        },
        tags: ['test'],
      },
      signature: {
        timestamp: Math.floor(Date.now() / 1000).toString(),
        token: 'test-token-' + Date.now(),
        signature: 'test-signature',
      },
    };

    try {
      // Generate valid signature for testing
      const apiKey = process.env.MAILGUN_API_KEY || '';
      const hash = crypto
        .createHmac('sha256', apiKey)
        .update(testWebhook.signature.timestamp + testWebhook.signature.token)
        .digest('hex');

      testWebhook.signature.signature = hash;

      // Create mock request/response
      const mockReq = { body: testWebhook } as any;
      const mockRes = {
        json: (data: unknown) => {
          res.json({ status: 'test_sent', response: data });
        },
        status: (code: number) => ({
          json: (data: unknown) => {
            res.status(code).json(data);
          },
        }),
      } as any;

      await handleMailgunWebhook(mockReq, mockRes);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}

/**
 * Express middleware setup example
 *
 * app.ts:
 * import { createMailgunWebhookRouter } from './webhooks/mailgun';
 * import express from 'express';
 *
 * const app = express();
 * app.use(express.json());
 *
 * // Mount webhook router
 * const webhookRouter = createMailgunWebhookRouter();
 * app.use('/webhooks', webhookRouter);
 *
 * app.listen(3000, () => {
 *   console.log('Listening on http://localhost:3000');
 * });
 */

// Alternative: Raw Express middleware function
export function mailgunWebhookMiddleware(
  req: Request,
  res: Response,
  next: Function
): void {
  if (req.path === '/mailgun' && req.method === 'POST') {
    handleMailgunWebhook(req, res);
  } else {
    next();
  }
}

/**
 * Database schema for email event tracking
 *
 * CREATE TABLE email_events (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   recipient_email VARCHAR(255) NOT NULL,
 *   event_type VARCHAR(50) NOT NULL,
 *   created_at TIMESTAMP NOT NULL DEFAULT NOW(),
 *   data JSONB,
 *   INDEX(recipient_email),
 *   INDEX(event_type),
 *   INDEX(created_at)
 * );
 *
 * CREATE TABLE email_bounces (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   recipient_email VARCHAR(255) NOT NULL UNIQUE,
 *   bounce_type VARCHAR(20) NOT NULL, -- 'permanent', 'temporary'
 *   reason VARCHAR(255),
 *   bounced_at TIMESTAMP NOT NULL DEFAULT NOW(),
 *   INDEX(recipient_email)
 * );
 *
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_last_delivered TIMESTAMP;
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_last_opened TIMESTAMP;
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_last_clicked TIMESTAMP;
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_last_failed_at TIMESTAMP;
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_bounced_at TIMESTAMP;
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_complained_at TIMESTAMP;
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_unsubscribed_at TIMESTAMP;
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_delivery_status VARCHAR(50);
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_last_failure_reason VARCHAR(255);
 * ALTER TABLE users ADD COLUMN IF NOT EXISTS email_bounce_reason VARCHAR(255);
 */

import type { PhaseTransitionEvent, AuditLogEntry } from '../../types/pricing';
import type { PricingService, DbAdapter } from '../../services/pricing.service';

// ---------------------------------------------------------------------------
// Webhook payload
// ---------------------------------------------------------------------------

interface PhaseChangedWebhookPayload {
  event: 'phase_changed';
  ticketTypeId: string;
  eventId: string;
  fromPhase: string | null;
  toPhase: string;
  newPrice: number;
  transitionedAt: string;
}

// ---------------------------------------------------------------------------
// Retry config — exponential backoff without external dependencies
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]; // 3 attempts: 1s, 2s, 4s
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Adapter interfaces
// ---------------------------------------------------------------------------

interface WebhookLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface HttpClient {
  post(url: string, payload: unknown): Promise<{ status: number; ok: boolean }>;
}

// ---------------------------------------------------------------------------
// PhaseChangedWebhookHandler
// ---------------------------------------------------------------------------

export class PhaseChangedWebhookHandler {
  constructor(
    private readonly pricingService: PricingService,
    private readonly db: DbAdapter,
    private readonly http: HttpClient,
    private readonly logger: WebhookLogger,
  ) {}

  /**
   * Main entry point — called by Kafka consumer when a `pricing.phase_changed`
   * message arrives.
   */
  async handle(event: PhaseTransitionEvent): Promise<void> {
    const webhookUrl = await this.db.getEventWebhookUrl(event.eventId);

    if (webhookUrl === null) {
      this.logger.info('No webhook URL configured for event', {
        eventId: event.eventId,
        ticketTypeId: event.ticketTypeId,
      });
      return;
    }

    // Fetch current price to include in payload
    const priceCalc = await this.pricingService.getCurrentPrice(
      event.ticketTypeId,
    );

    const payload: PhaseChangedWebhookPayload = {
      event: 'phase_changed',
      ticketTypeId: event.ticketTypeId,
      eventId: event.eventId,
      fromPhase: event.fromPhase,
      toPhase: event.toPhase,
      newPrice: priceCalc.finalPrice,
      transitionedAt: event.transitionedAt.toISOString(),
    };

    await this.sendWithRetry(webhookUrl, payload, event);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async sendWithRetry(
    url: string,
    payload: PhaseChangedWebhookPayload,
    event: PhaseTransitionEvent,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
        this.logger.warn('Retrying webhook delivery', {
          url,
          attempt,
          delayMs,
          ticketTypeId: event.ticketTypeId,
        });
        await sleep(delayMs);
      }

      try {
        const response = await this.http.post(url, payload);

        if (response.ok) {
          this.logger.info('Webhook delivered successfully', {
            url,
            attempt: attempt + 1,
            status: response.status,
            ticketTypeId: event.ticketTypeId,
          });

          await this.auditLog(event, url, 'success', response.status, null);
          return;
        }

        lastError = new Error(
          `Webhook returned non-2xx status: ${response.status}`,
        );
        this.logger.warn('Webhook delivery failed (non-2xx)', {
          url,
          attempt: attempt + 1,
          status: response.status,
          ticketTypeId: event.ticketTypeId,
        });
      } catch (err) {
        lastError =
          err instanceof Error ? err : new Error(String(err));
        this.logger.warn('Webhook delivery error', {
          url,
          attempt: attempt + 1,
          error: lastError.message,
          ticketTypeId: event.ticketTypeId,
        });
      }
    }

    // All attempts exhausted
    this.logger.error('Webhook delivery failed after all retries', {
      url,
      maxAttempts: MAX_ATTEMPTS,
      ticketTypeId: event.ticketTypeId,
      error: lastError?.message,
    });

    await this.auditLog(event, url, 'failed', null, lastError?.message ?? 'Unknown error');
  }

  private async auditLog(
    event: PhaseTransitionEvent,
    webhookUrl: string,
    outcome: 'success' | 'failed',
    statusCode: number | null,
    errorMessage: string | null,
  ): Promise<void> {
    const entry: Omit<AuditLogEntry, 'id' | 'createdAt'> = {
      tableName: 'webhook_deliveries',
      recordId: event.ticketTypeId,
      action: `webhook_${outcome}`,
      payload: {
        eventId: event.eventId,
        ticketTypeId: event.ticketTypeId,
        fromPhase: event.fromPhase,
        toPhase: event.toPhase,
        webhookUrl,
        statusCode,
        errorMessage,
        transitionedAt: event.transitionedAt.toISOString(),
      },
    };

    try {
      await this.db.insertAuditLog(entry);
    } catch (err) {
      this.logger.error('Failed to write webhook audit log', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Default HTTP client using native fetch (Node 18+)
// ---------------------------------------------------------------------------

export const defaultHttpClient: HttpClient = {
  async post(url: string, payload: unknown) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, ok: response.ok };
  },
};

import { createHmac, randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export type WebhookEventType =
  | "order.created"
  | "order.paid"
  | "order.cancelled"
  | "order.refunded"
  | "ticket.issued"
  | "ticket.scanned"
  | "ticket.transferred"
  | "ticket.revoked"
  | "resale.listed"
  | "resale.sold"
  | "event.updated"
  | "event.cancelled";

export interface WebhookPayload {
  id: string;           // delivery UUID
  type: WebhookEventType;
  created_at: string;   // ISO8601
  data: Record<string, unknown>;
  api_version: "2026-04-06";
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  signingSecret: string; // dešifrovaný HMAC secret
  status: string;
  failureCount: number;
}

// ---------------------------------------------------------------------------
// Retry plán (exponential backoff)
// ---------------------------------------------------------------------------
const RETRY_DELAYS_MS = [
  0,              // 1. pokus — okamžitě
  60_000,         // 2. pokus — 1 minuta
  300_000,        // 3. pokus — 5 minut
  1_800_000,      // 4. pokus — 30 minut
  7_200_000,      // 5. pokus — 2 hodiny
];

const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;
const AUTO_DISABLE_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface WebhookDBAdapter {
  getEndpointsForEvent(
    promoterId: string,
    eventType: WebhookEventType
  ): Promise<WebhookEndpoint[]>;

  createDelivery(input: {
    endpointId: string;
    eventType: WebhookEventType;
    payload: WebhookPayload;
  }): Promise<string>; // returns deliveryId

  getPendingDeliveries(limit: number): Promise<
    Array<{
      id: string;
      endpointId: string;
      eventType: string;
      payload: WebhookPayload;
      attemptCount: number;
    }>
  >;

  markDelivered(deliveryId: string): Promise<void>;

  markFailed(
    deliveryId: string,
    httpStatus: number | null,
    error: string,
    nextAttemptAt: Date | null // null = abandoned
  ): Promise<void>;

  incrementEndpointFailure(endpointId: string): Promise<number>; // vrátí nový failure_count
  resetEndpointFailure(endpointId: string): Promise<void>;
  disableEndpoint(endpointId: string, reason: "auto_disabled"): Promise<void>;
}

// HTTP fetch adapter (pro testovatelnost)
export interface HttpAdapter {
  post(
    url: string,
    body: string,
    headers: Record<string, string>
  ): Promise<{ status: number; ok: boolean }>;
}

export const webhookDb = {} as WebhookDBAdapter;
export const webhookHttp = {} as HttpAdapter;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WebhookDeliveryService {
  constructor(
    private readonly db: WebhookDBAdapter,
    private readonly http: HttpAdapter
  ) {}

  /**
   * Enqueue webhook pro všechny aktivní endpointy promotéra subscribované na daný event.
   */
  async enqueue(
    promoterId: string,
    eventType: WebhookEventType,
    data: Record<string, unknown>
  ): Promise<void> {
    const endpoints = await this.db.getEndpointsForEvent(promoterId, eventType);

    const payload: WebhookPayload = {
      id: randomBytes(16).toString("hex"),
      type: eventType,
      created_at: new Date().toISOString(),
      data,
      api_version: "2026-04-06",
    };

    await Promise.all(
      endpoints.map((ep) =>
        this.db.createDelivery({ endpointId: ep.id, eventType, payload })
      )
    );
  }

  /**
   * Zpracuje dávku čekajících doručení.
   * Volá se z workeru (cron nebo polling loop).
   */
  async processBatch(limit = 100): Promise<void> {
    const deliveries = await this.db.getPendingDeliveries(limit);

    await Promise.allSettled(
      deliveries.map((delivery) => this.deliver(delivery))
    );
  }

  // -------------------------------------------------------------------------
  // Interní doručení jednoho webhooků
  // -------------------------------------------------------------------------

  private async deliver(delivery: {
    id: string;
    endpointId: string;
    eventType: string;
    payload: WebhookPayload;
    attemptCount: number;
  }): Promise<void> {
    // Načíst aktuální endpoint
    const endpoints = await this.db.getEndpointsForEvent(
      delivery.payload.data.promoter_id as string ?? "",
      delivery.eventType as WebhookEventType
    );
    const endpoint = endpoints.find((e) => e.id === delivery.endpointId);

    if (!endpoint || endpoint.status !== "active") {
      await this.db.markFailed(delivery.id, null, "endpoint_disabled", null);
      return;
    }

    const bodyStr = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhook(bodyStr, endpoint.signingSecret, timestamp);

    let httpStatus: number | null = null;
    let error: string | null = null;

    try {
      const response = await this.http.post(endpoint.url, bodyStr, {
        "Content-Type": "application/json",
        "Tixly-Signature": signature,
        "Tixly-Event": delivery.payload.type,
        "Tixly-Delivery-Id": delivery.id,
        "User-Agent": "Tixly-Webhook/1.0",
      });

      httpStatus = response.status;

      if (response.ok) {
        await Promise.all([
          this.db.markDelivered(delivery.id),
          this.db.resetEndpointFailure(endpoint.id),
        ]);
        return;
      }

      error = `HTTP ${httpStatus}`;
    } catch (err) {
      error = err instanceof Error ? err.message : "Network error";
    }

    // Neúspěch — naplánovat retry nebo abandon
    const nextAttemptIndex = delivery.attemptCount; // 0-based → po 1. pokusu = index 1
    const nextDelay = RETRY_DELAYS_MS[nextAttemptIndex] ?? null;

    const nextAttemptAt =
      nextDelay !== null && delivery.attemptCount < MAX_ATTEMPTS - 1
        ? new Date(Date.now() + nextDelay)
        : null; // null = abandon

    await this.db.markFailed(
      delivery.id,
      httpStatus,
      error ?? "unknown",
      nextAttemptAt
    );

    // Inkrementovat failure counter endpointu
    const newFailureCount = await this.db.incrementEndpointFailure(endpoint.id);
    if (newFailureCount >= AUTO_DISABLE_THRESHOLD) {
      await this.db.disableEndpoint(endpoint.id, "auto_disabled");
    }
  }
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 podpis
// ---------------------------------------------------------------------------

/**
 * Podepíše webhook payload.
 * Formát: "t=<timestamp>,v1=<hmac_hex>"
 */
export function signWebhook(
  payload: string,
  secret: string,
  timestamp: number
): string {
  const signed = `${timestamp}.${payload}`;
  const hmac = createHmac("sha256", secret).update(signed).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

/**
 * Ověří podpis (pro příjemce — použít v jejich kódu).
 * timingSafeEqual chrání před timing attacks.
 */
export function verifyWebhookSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSec = 300
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const idx = p.indexOf("=");
      return [p.slice(0, idx), p.slice(idx + 1)];
    })
  );

  const timestamp = parseInt(parts["t"] ?? "0", 10);
  if (!timestamp) return false;

  // Replay attack ochrana
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  // Timing-safe porovnání
  if (expected.length !== (parts["v1"] ?? "").length) return false;

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts["v1"] ?? "", "hex");
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

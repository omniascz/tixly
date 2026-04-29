// =============================================================================
// Webhook Delivery Worker
//
// Polling loop pro doručování webhooků z platform.webhook_deliveries.
// Spouštět jako samostatný Node.js process nebo jako Vercel Cron Job.
//
// Cron: každých 30 sekund
//   Vercel cron.json: { "crons": [{ "path": "/api/cron/webhook-worker", "schedule": "* * * * *" }] }
//   (Vercel umožňuje max 1/min — pro nižší latenci použít Railway/Fly.io worker)
// =============================================================================

import { WebhookDeliveryService, webhookDb, webhookHttp } from "../services/webhook-delivery.service";

const service = new WebhookDeliveryService(webhookDb, webhookHttp);

// ---------------------------------------------------------------------------
// Polling loop (pro standalone Node.js process)
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000; // 30 sekund
const BATCH_SIZE = 100;

let running = false;

async function runOnce(): Promise<void> {
  if (running) return; // zabraňuje souběžnému zpracování
  running = true;

  try {
    await service.processBatch(BATCH_SIZE);
  } catch (err) {
    console.error("[webhook-worker] batch error:", err);
  } finally {
    running = false;
  }
}

export function startWorker(): void {
  console.log(`[webhook-worker] starting, poll interval: ${POLL_INTERVAL_MS}ms`);
  runOnce();
  setInterval(runOnce, POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Vercel / Next.js Cron handler
// Vystavit jako /api/cron/webhook-worker s CRON_SECRET ochranou
// ---------------------------------------------------------------------------

export async function handleCronRequest(
  authHeader: string | null,
  cronSecret: string
): Promise<{ processed: boolean; error?: string }> {
  if (authHeader !== `Bearer ${cronSecret}`) {
    return { processed: false, error: "Unauthorized" };
  }

  try {
    await service.processBatch(BATCH_SIZE);
    return { processed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[webhook-worker] cron error:", message);
    return { processed: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Přímé spuštění jako Node.js skript: node webhook-delivery.worker.js
// ---------------------------------------------------------------------------
if (require.main === module) {
  startWorker();

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[webhook-worker] SIGTERM received, shutting down");
    process.exit(0);
  });
}

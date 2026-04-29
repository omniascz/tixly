/**
 * SMS Reminder Job — cron každý den v 10:00
 *
 * Najde všechny vstupenky na eventy ZÍTRA, kde ještě nebyla poslána SMS,
 * a odešle SMS reminder s čárovým kódem a URL vstupenky.
 *
 * Spuštění: node --import tsx src/jobs/sms-reminder.job.ts
 * Cron: 0 10 * * *  (každý den 10:00)
 *
 * Env vars:
 *   DATABASE_URL           - PostgreSQL connection string
 *   TWILIO_ACCOUNT_SID     - Twilio Account SID
 *   TWILIO_AUTH_TOKEN      - Twilio Auth Token
 *   TWILIO_PHONE_NUMBER    - Odesílací číslo nebo Messaging Service SID
 *   BASE_URL               - Aplikační URL, např. "https://tixly.cz"
 */

import { SmsService } from '../services/sms.service.js';
import { assignBarcodeCode } from '../services/barcode.service.js';
import type { DbAdapter, SmsReminderRow, TwilioConfig } from '../types/barcode.types.js';

// ---------------------------------------------------------------------------
// Konfigurace z ENV
// ---------------------------------------------------------------------------

function loadConfig(): TwilioConfig {
  const required = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'BASE_URL',
  ] as const;

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Chybí env proměnná: ${key}`);
    }
  }

  return {
    accountSid: process.env['TWILIO_ACCOUNT_SID']!,
    authToken: process.env['TWILIO_AUTH_TOKEN']!,
    phoneNumber: process.env['TWILIO_PHONE_NUMBER']!,
    webhookBaseUrl: process.env['BASE_URL']!,
  };
}

// ---------------------------------------------------------------------------
// SQL dotaz pro vstupenky zítřejšího dne bez SMS
// ---------------------------------------------------------------------------

/**
 * Vrátí vstupenky na eventy zítra, kde ještě nebyla poslána SMS.
 *
 * SQL:
 * SELECT t.id, t.barcode_code, t.short_code,
 *        u.phone, u.name as holder_name,
 *        e.title as event_name, e.date_start,
 *        v.name as venue_name, v.address
 * FROM tickets.tickets t
 * JOIN identity.users u ON t.owner_id = u.id
 * JOIN catalog.ticket_types tt ON t.ticket_type_id = tt.id
 * JOIN catalog.events e ON tt.event_id = e.id
 * JOIN catalog.venues v ON e.venue_id = v.id
 * LEFT JOIN tickets.sms_log sl
 *   ON sl.ticket_id = t.id AND sl.status IN ('sent', 'delivered')
 * WHERE DATE(e.date_start AT TIME ZONE 'Europe/Prague') = CURRENT_DATE + INTERVAL '1 day'
 *   AND t.status = 'valid'
 *   AND u.phone IS NOT NULL
 *   AND u.deleted_at IS NULL
 *   AND u.anonymized_at IS NULL
 *   AND sl.id IS NULL
 */

// ---------------------------------------------------------------------------
// Batch zpracování
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;

interface JobStats {
  sent: number;
  failed: number;
  skippedNoPhone: number;
  total: number;
}

/**
 * Zpracuje batch vstupenek — odešle SMS pro každou.
 * Používá Promise.allSettled pro graceful error handling.
 */
async function processBatch(
  batch: SmsReminderRow[],
  smsService: SmsService,
  db: DbAdapter,
  stats: JobStats,
  signal: AbortSignal,
): Promise<void> {
  const results = await Promise.allSettled(
    batch.map(async (row) => {
      if (signal.aborted) {
        throw new Error('Job přerušen (SIGTERM)');
      }

      // Přiřadíme barcode kódy pokud chybí
      if (!row.barcodeCode || !row.shortCode) {
        await assignBarcodeCode(row.ticketId, db);
      }

      // Odešleme SMS
      const delivery = await smsService.sendTicketReminder(row.ticketId, row.phone, db);
      return delivery;
    }),
  );

  // Zpracování výsledků
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const row = batch[i]!;

    if (result.status === 'fulfilled') {
      if (result.value.status === 'sent' || result.value.status === 'delivered') {
        stats.sent++;
        console.log(
          `[SMS] Odesláno — ticket: ${row.ticketId}, phone: ${maskPhone(row.phone)}`,
        );
      } else {
        stats.failed++;
        console.error(
          `[SMS] Selhalo — ticket: ${row.ticketId}, ` +
            `chyba: ${result.value.errorMessage ?? 'unknown'}`,
        );
      }
    } else {
      stats.failed++;
      console.error(
        `[SMS] Výjimka — ticket: ${row.ticketId}, ` +
          `chyba: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
    }
  }
}

/**
 * Maskuje telefonní číslo pro log (GDPR).
 * Příklad: +420601234567 → +420******567
 */
function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return phone.slice(0, phone.length - 6) + '***' + phone.slice(-3);
}

// ---------------------------------------------------------------------------
// Hlavní job funkce
// ---------------------------------------------------------------------------

export async function runSmsReminderJob(db: DbAdapter): Promise<JobStats> {
  const config = loadConfig();
  const smsService = new SmsService(config);

  const controller = new AbortController();
  const { signal } = controller;

  // Graceful shutdown — SIGINT (Ctrl+C) nebo SIGTERM (systemd/Docker)
  const onSignal = () => {
    console.log('[SMS Job] Přerušení — dokončuji aktuální batch...');
    controller.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const stats: JobStats = { sent: 0, failed: 0, skippedNoPhone: 0, total: 0 };

  try {
    const tickets = await db.getTicketsForSmsReminder();
    stats.total = tickets.length;

    console.log(`[SMS Job] Nalezeno ${tickets.length} vstupenek pro SMS reminder`);

    if (tickets.length === 0) {
      return stats;
    }

    // Filtrujeme vstupenky bez telefonu (DB by je neměla vrátit, ale pro jistotu)
    const withPhone = tickets.filter((t) => t.phone);
    stats.skippedNoPhone = tickets.length - withPhone.length;

    // Zpracování po batchích
    for (let i = 0; i < withPhone.length; i += BATCH_SIZE) {
      if (signal.aborted) {
        console.log('[SMS Job] Přerušeno uživatelem, konec zpracování');
        break;
      }

      const batch = withPhone.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(withPhone.length / BATCH_SIZE);

      console.log(`[SMS Job] Batch ${batchNum}/${totalBatches} (${batch.length} vstupenek)`);

      await processBatch(batch, smsService, db, stats, signal);
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  console.log(
    `[SMS Job] Dokončeno — Odesláno: ${stats.sent}, Selhalo: ${stats.failed}, ` +
      `Přeskočeno (bez tel.): ${stats.skippedNoPhone}, Celkem: ${stats.total}`,
  );

  return stats;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Spuštění pouze pokud je soubor přímo volán (ne při importu v testech)
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  (process.argv[1].endsWith('sms-reminder.job.ts') ||
    process.argv[1].endsWith('sms-reminder.job.js'));

if (isMain) {
  // V produkci zde bude reálný pg DbAdapter
  // Dynamický import pro oddělení od testů
  const { createDbAdapter } = await import('../adapters/db.adapter.js');
  const db = createDbAdapter(process.env['DATABASE_URL']!);

  runSmsReminderJob(db)
    .then((stats) => {
      process.exit(stats.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('[SMS Job] Kritická chyba:', err);
      process.exit(1);
    });
}

/**
 * Kolo 14 / krok 3 — heartbeat cronů: každý běh zapíše čas a stav; ÚSPĚŠNÝ běh i last_success_at.
 * Kontrolní job (ops-watchdog) pak hlásí crony, které neproběhly déle než 2× svůj interval (cron-schedule).
 * Nikdy nehází — heartbeat nesmí shodit samotný cron.
 */
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { cronEntry } from '@/lib/ops/cron-schedule';

export async function recordCronRun(job: string, ok: boolean, status: number, error?: string | null): Promise<void> {
  try {
    const interval = cronEntry(job)?.intervalMinutes ?? 60;
    await runWithServiceContext(() => db().query(
      `INSERT INTO monitoring.cron_heartbeats (job, interval_minutes, last_run_at, last_success_at, last_status, last_error, updated_at)
       VALUES ($1, $2, now(), CASE WHEN $3 THEN now() END, $4, $5, now())
       ON CONFLICT (job) DO UPDATE SET
         interval_minutes = EXCLUDED.interval_minutes,
         last_run_at      = now(),
         last_success_at  = CASE WHEN $3 THEN now() ELSE monitoring.cron_heartbeats.last_success_at END,
         last_status      = EXCLUDED.last_status,
         last_error       = CASE WHEN $3 THEN NULL ELSE EXCLUDED.last_error END,
         updated_at       = now()`,
      [job, interval, ok, status, ok ? null : (error ?? `HTTP ${status}`).slice(0, 1000)],
    ));
  } catch (err) {
    console.error('[heartbeat] zápis se nepodařil:', job, err);
  }
}

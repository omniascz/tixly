/**
 * Kolo 14 / krok 3 — upozornění provozu e-mailem na PLATFORM_ADMIN_EMAIL.
 *
 * Každý problém má klíč (např. 'gateway_webhook_failed:gopay', 'cron_overdue:send-reminders'). Stejný klíč pošle
 * nejvýš 1 e-mail za 30 minut (monitoring.ops_alerts — atomicky v DB, funguje i pro více instancí serveru); další
 * výskyty se jen počítají. Každý výskyt se zapíše do monitoring.ops_events (denní souhrn „Chyby").
 * E-mail jde centrálním mailerem (SMTP: Mailpit lokálně, poskytovatel v produkci; na stagingu jen allowlist).
 * Nikdy nehází — upozornění nesmí shodit operaci, při které problém vznikl.
 */
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const ALERT_THROTTLE_MINUTES = 30;

export interface OpsAlert {
  kind: string;
  key: string;
  subject: string;
  text: string;
}

/** Vrátí true, když se e-mail odeslal (nebyl potlačen omezením četnosti). */
export async function alertOps(a: OpsAlert): Promise<boolean> {
  try {
    return await runWithServiceContext(async () => {
      const claimed = (await db().query<{ key: string }>(
        `INSERT INTO monitoring.ops_alerts (key, last_sent_at, suppressed, last_detail) VALUES ($1, now(), 0, $2)
         ON CONFLICT (key) DO UPDATE
           SET last_sent_at = CASE WHEN monitoring.ops_alerts.last_sent_at < now() - make_interval(mins => $3) THEN now() ELSE monitoring.ops_alerts.last_sent_at END,
               suppressed   = CASE WHEN monitoring.ops_alerts.last_sent_at < now() - make_interval(mins => $3) THEN 0 ELSE monitoring.ops_alerts.suppressed + 1 END,
               last_detail  = EXCLUDED.last_detail
         RETURNING key, (last_sent_at = now()) AS fresh`,
        [a.key, a.text.slice(0, 2000), ALERT_THROTTLE_MINUTES],
      )).rows[0] as { key: string; fresh?: boolean } | undefined;
      const send = !!claimed?.fresh;
      await db().query(
        `INSERT INTO monitoring.ops_events (kind, key, detail, emailed) VALUES ($1, $2, $3, $4)`,
        [a.kind, a.key, a.text.slice(0, 4000), send],
      );
      if (!send) return false;
      const to = process.env.PLATFORM_ADMIN_EMAIL;
      if (!to) {
        console.warn(`[ops-alert] PLATFORM_ADMIN_EMAIL není nastavený — upozornění jen v monitoring.ops_events: ${a.key}`);
        return false;
      }
      const { sendMail } = await import('@/lib/email/mailer');
      await sendMail({
        from: `"Tixly provoz" <${process.env.EMAIL_FROM ?? 'provoz@tixly.local'}>`,
        to,
        subject: `[Tixly provoz] ${a.subject}`,
        text: `${a.text}\n\n—\nStejné upozornění se znovu pošle nejdřív za ${ALERT_THROTTLE_MINUTES} minut (klíč ${a.key}).`,
      });
      return true;
    });
  } catch (err) {
    console.error('[ops-alert] upozornění se nepodařilo zapsat/odeslat:', a.key, err);
    return false;
  }
}

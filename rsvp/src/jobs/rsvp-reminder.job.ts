/**
 * RSVP Reminder Job
 * Sends reminder emails to attendees before the event starts.
 * Queries RSVPs for events starting within the time window and marks them as sent.
 */

import type { RsvpDbAdapter } from '../services/rsvp.service.js';
import type { EmailAdapter } from '../lib/service-container.js';

export interface ReminderJobDeps {
  db: RsvpDbAdapter;
  email: EmailAdapter;
}

export interface SendRsvpRemindersResult {
  sent: number;
  failed: number;
}

/**
 * Sends RSVP reminders for events starting within the specified time window.
 *
 * @param deps Service dependencies (db, email)
 * @param hoursBeforeEvent Hours before event start to send reminders (default: 24)
 * @returns Object with sent and failed counts
 */
export async function sendRsvpReminders(
  deps: ReminderJobDeps,
  hoursBeforeEvent: number = 24,
): Promise<SendRsvpRemindersResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + (hoursBeforeEvent - 1) * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + (hoursBeforeEvent + 1) * 60 * 60 * 1000);

  // Find events starting in the window [now+hoursBeforeEvent-1h, now+hoursBeforeEvent+1h]
  // and approved RSVPs that haven't had reminders sent yet
  const rsvps = await deps.db.findRsvpsByEventTimeWindow(windowStart, windowEnd);

  let sent = 0;
  let failed = 0;

  for (const rsvp of rsvps) {
    // Skip if reminder already sent
    if (rsvp.reminder_sent_at !== null) {
      continue;
    }

    try {
      // Get event and ticket type details for the email
      const ticketType = await deps.db.findRsvpTicketType(rsvp.ticket_type_id);
      if (!ticketType) {
        failed++;
        continue;
      }

      const event = await deps.db.findEventForRsvp(rsvp.event_id);
      if (!event) {
        failed++;
        continue;
      }

      // Send reminder email in Czech with simple template
      const subject = `Připomínka: ${event.name}`;
      const html = `<p>Připomínka: akce <strong>${event.name}</strong> se koná zítra.</p>`;

      await deps.email.send(rsvp.email, subject, html);

      // Mark reminder as sent
      await deps.db.updateRsvpReminder(rsvp.id, new Date());

      sent++;
    } catch (err) {
      console.error(`Failed to send reminder for RSVP ${rsvp.id}:`, err);
      failed++;
    }
  }

  return { sent, failed };
}

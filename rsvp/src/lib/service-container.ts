/**
 * Lightweight service locator for Next.js API routes.
 * Call setServiceContainer() at application startup (or in tests to inject mocks).
 */
import { RsvpService } from '../services/rsvp.service.js';
import type { RsvpDbAdapter, RsvpOrganizerAdapter } from '../services/rsvp.service.js';
import nodemailer from 'nodemailer';

export interface EmailAdapter {
  send(to: string, subject: string, html: string): Promise<void>;
}

export interface ServiceContainer {
  db: RsvpDbAdapter;
  organizer: RsvpOrganizerAdapter;
  email: EmailAdapter;
  rsvpService: RsvpService;
}

let _container: ServiceContainer | null = null;

class NodemailerEmailAdapter implements EmailAdapter {
  private transporter: any = null;
  private from: string;

  constructor() {
    this.from = process.env.EMAIL_FROM ?? 'noreply@tixly.cz';
    const host = process.env.SMTP_HOST;
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? '587'),
        secure: false, // STARTTLS
        auth: {
          user: process.env.SMTP_USER ?? '',
          pass: process.env.SMTP_PASS ?? '',
        },
      });
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      console.log(`[email-dev] To: ${to} | Subject: ${subject}`);
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      html,
    });
  }
}

export function setServiceContainer(container: ServiceContainer): void {
  _container = container;
}

export function getServiceContainer(): ServiceContainer {
  if (_container) return _container;
  throw new Error(
    'ServiceContainer not initialised. Call setServiceContainer() at application startup.',
  );
}

export function createDefaultServiceContainer(
  db: RsvpDbAdapter,
  organizer: RsvpOrganizerAdapter,
): ServiceContainer {
  return {
    db,
    organizer,
    email: new NodemailerEmailAdapter(),
    rsvpService: new RsvpService(db, organizer),
  };
}

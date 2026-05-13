import { randomUUID } from 'crypto';
import type {
  DbAdapter,
  WizardSession,
  WizardStep,
  WizardData,
  PublishResult,
} from '../lib/types.js';
import { STEP_ORDER } from './wizard-steps.service.js';

// ─── DB row shape ─────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  promoter_id: string;
  current_step: WizardStep;
  completed_steps: WizardStep[];
  data: WizardData;
  status: 'in_progress' | 'completed' | 'abandoned';
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function rowToSession(row: SessionRow): WizardSession {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    currentStep: row.current_step,
    completedSteps: row.completed_steps,
    data: row.data,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

// ─── createWizardSession ──────────────────────────────────────────────────────

export async function createWizardSession(
  promoterId: string,
  db: DbAdapter,
): Promise<WizardSession> {
  const id = randomUUID();

  await db.execute(
    `INSERT INTO onboarding_wizard_sessions
       (id, promoter_id, current_step, completed_steps, data, status, expires_at)
     VALUES ($1, $2, 'event_basics', '{}', '{}', 'in_progress', NOW() + INTERVAL '24 hours')`,
    [id, promoterId],
  );

  const rows = await db.query<SessionRow>(
    `SELECT id, promoter_id, current_step, completed_steps, data, status,
            created_at, updated_at, expires_at
     FROM onboarding_wizard_sessions
     WHERE id = $1`,
    [id],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Nepodařilo se načíst novou wizard session.');
  }

  return rowToSession(row);
}

// ─── getWizardSession ─────────────────────────────────────────────────────────

export async function getWizardSession(
  sessionId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<WizardSession> {
  const rows = await db.query<SessionRow>(
    `SELECT id, promoter_id, current_step, completed_steps, data, status,
            created_at, updated_at, expires_at
     FROM onboarding_wizard_sessions
     WHERE id = $1`,
    [sessionId],
  );

  const row = rows[0];
  if (!row) {
    throw new Error(`Wizard session '${sessionId}' nenalezena.`);
  }

  // Tenant isolation
  if (row.promoter_id !== promoterId) {
    throw new Error('Přístup odepřen: session nepatří tomuto promotérovi.');
  }

  // Check expiration
  if (new Date(row.expires_at) <= new Date()) {
    throw new Error('Wizard session expirovala.');
  }

  return rowToSession(row);
}

// ─── publishEvent ─────────────────────────────────────────────────────────────

export async function publishEvent(
  sessionId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<PublishResult> {
  const session = await getWizardSession(sessionId, promoterId, db);

  // Must be on the last step (review_publish)
  if (session.currentStep !== 'review_publish') {
    throw new Error(
      `Nelze publikovat: wizard není na posledním kroku. Aktuální krok: '${session.currentStep}'.`,
    );
  }

  const data = session.data;

  const eventId = randomUUID();

  return db.transaction(async (tx) => {
    // Create event
    await tx.execute(
      `INSERT INTO events
         (id, promoter_id, title, description, category, image_url,
          date_start, date_end, capacity, tags, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')`,
      [
        eventId,
        promoterId,
        data.eventName ?? '',
        data.description ?? null,
        data.category ?? null,
        data.imageUrl ?? null,
        data.eventDate ?? new Date().toISOString(),
        data.eventEndDate ?? null,
        data.capacity ?? null,
        data.tags ?? [],
      ],
    );

    // Create ticket types
    const ticketTypes = data.ticketTypes ?? [];
    for (const tt of ticketTypes) {
      const ttId = randomUUID();
      await tx.execute(
        `INSERT INTO ticket_types
           (id, event_id, name, price_halire, capacity, sale_start_at, sale_end_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [
          ttId,
          eventId,
          tt.name,
          tt.priceHalire,
          tt.quantity,
          tt.salesStart ?? null,
          tt.salesEnd ?? null,
        ],
      );
    }

    // Mark wizard as completed
    await tx.execute(
      `UPDATE onboarding_wizard_sessions
       SET status = 'completed',
           data = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ ...data, createdEventId: eventId }), sessionId],
    );

    return {
      eventId,
      eventUrl: `/events/${eventId}`,
      ticketTypesCreated: ticketTypes.length,
    };
  });
}

// ─── abandonWizard ────────────────────────────────────────────────────────────

export async function abandonWizard(
  sessionId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  // Verify ownership
  await getWizardSession(sessionId, promoterId, db);

  await db.execute(
    `UPDATE onboarding_wizard_sessions
     SET status = 'abandoned',
         updated_at = NOW()
     WHERE id = $1`,
    [sessionId],
  );
}

// ─── getWizardProgress ────────────────────────────────────────────────────────

export function getWizardProgress(session: WizardSession): {
  steps: Array<{ step: WizardStep; status: 'pending' | 'completed' | 'current' }>;
  percent: number;
} {
  const steps = STEP_ORDER.map((step) => {
    let status: 'pending' | 'completed' | 'current';
    if (session.completedSteps.includes(step)) {
      status = 'completed';
    } else if (session.currentStep === step) {
      status = 'current';
    } else {
      status = 'pending';
    }
    return { step, status };
  });

  const percent = Math.round((session.completedSteps.length / STEP_ORDER.length) * 100);

  return { steps, percent };
}

// ─── cleanupExpiredSessions ───────────────────────────────────────────────────

export async function cleanupExpiredSessions(db: DbAdapter): Promise<number> {
  const rows = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM onboarding_wizard_sessions
     WHERE status = 'in_progress'
       AND expires_at <= NOW()`,
    [],
  );

  const count = parseInt(rows[0]?.count ?? '0', 10);

  if (count > 0) {
    await db.execute(
      `UPDATE onboarding_wizard_sessions
       SET status = 'abandoned',
           updated_at = NOW()
       WHERE status = 'in_progress'
         AND expires_at <= NOW()`,
      [],
    );
  }

  return count;
}

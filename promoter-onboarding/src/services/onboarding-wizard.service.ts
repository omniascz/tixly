import { randomUUID } from 'crypto';
import type { ServiceDeps } from '../lib/service-container.js';
import { OnboardingError } from '../lib/onboarding-errors.js';
import {
  WIZARD_TEMPLATES,
  type WizardTemplate,
  type WizardTemplateDefaults,
} from '../lib/wizard-templates.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const WIZARD_TTL_SECONDS = 7200; // 2 hours

function redisKey(wizardId: string): string {
  return `tixly:wizard:${wizardId}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WizardTicketType {
  name: string;
  priceHalire: number; // INTEGER halíře (1 Kč = 100 halířů)
  capacity: number;
}

export interface WizardProgressData {
  name?: string;
  description?: string;
  date?: string;       // ISO 8601
  venueName?: string;
  city?: string;
  capacity?: number;
  ticketTypes?: WizardTicketType[];
}

export interface WizardFinalData {
  name: string;
  description?: string;
  date: string;        // ISO 8601
  venueName: string;
  city: string;
  capacity: number;
  ticketTypes: WizardTicketType[];
}

interface WizardRedisPayload {
  promoterId: string;
  template: WizardTemplate;
  progress: WizardProgressData;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadWizard(
  wizardId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<WizardRedisPayload> {
  const raw = await deps.redis.get(redisKey(wizardId));
  if (raw === null) {
    throw new OnboardingError('WIZARD_NOT_FOUND');
  }

  const payload: WizardRedisPayload = JSON.parse(raw) as WizardRedisPayload;

  if (payload.promoterId !== promoterId) {
    throw new OnboardingError('WIZARD_INVALID_PROMOTER');
  }

  return payload;
}

// ── Public service functions ──────────────────────────────────────────────────

/**
 * Start a new wizard session for a promoter.
 * Stores the chosen template + empty progress in Redis (TTL 2h).
 * Returns a fresh wizardId and the template's default values.
 */
export async function startWizard(
  promoterId: string,
  template: WizardTemplate,
  deps: ServiceDeps,
): Promise<{ wizardId: string; defaults: WizardTemplateDefaults }> {
  const wizardId = randomUUID();

  const payload: WizardRedisPayload = {
    promoterId,
    template,
    progress: {},
  };

  await deps.redis.setex(redisKey(wizardId), WIZARD_TTL_SECONDS, JSON.stringify(payload));

  return {
    wizardId,
    defaults: WIZARD_TEMPLATES[template],
  };
}

/**
 * Persist partial wizard progress.
 * Merges the supplied data into the existing Redis record and resets the TTL.
 */
export async function saveWizardProgress(
  wizardId: string,
  promoterId: string,
  data: WizardProgressData,
  deps: ServiceDeps,
): Promise<void> {
  const payload = await loadWizard(wizardId, promoterId, deps);

  // Merge: later values overwrite earlier ones
  payload.progress = { ...payload.progress, ...data };

  await deps.redis.setex(redisKey(wizardId), WIZARD_TTL_SECONDS, JSON.stringify(payload));
}

/**
 * Complete the wizard.
 * Validates that all required fields are present, emits a Kafka event
 * `event.wizard.completed`, and returns a deterministic eventDraftId derived
 * from the wizardId.
 *
 * NOTE: This function does NOT write to the database directly.
 * The event-creation module is responsible for persisting the draft when it
 * consumes the Kafka event.
 */
export async function completeWizard(
  wizardId: string,
  promoterId: string,
  finalData: WizardFinalData,
  deps: ServiceDeps,
): Promise<{ eventDraftId: string }> {
  // Verify the wizard session exists and belongs to this promoter
  const payload = await loadWizard(wizardId, promoterId, deps);

  // Validate required fields (belt-and-suspenders; routes should pre-validate via Zod)
  const missingFields: string[] = [];
  if (!finalData.name?.trim()) missingFields.push('name');
  if (!finalData.date) missingFields.push('date');
  if (!finalData.venueName?.trim()) missingFields.push('venueName');
  if (!finalData.city?.trim()) missingFields.push('city');
  if (!finalData.capacity || finalData.capacity <= 0) missingFields.push('capacity');
  if (!finalData.ticketTypes || finalData.ticketTypes.length === 0) missingFields.push('ticketTypes');

  if (missingFields.length > 0) {
    throw new OnboardingError(
      'WIZARD_INCOMPLETE',
      `Required fields missing: ${missingFields.join(', ')}`,
    );
  }

  // Use a stable, derived ID so the consuming service can deduplicate
  const eventDraftId = `draft_${wizardId}`;

  await deps.kafka.send('event.wizard.completed', {
    eventDraftId,
    wizardId,
    promoterId,
    template: payload.template,
    event: {
      name: finalData.name,
      description: finalData.description ?? '',
      date: finalData.date,
      venueName: finalData.venueName,
      city: finalData.city,
      capacity: finalData.capacity,
    },
    ticketTypes: finalData.ticketTypes,
    completedAt: new Date().toISOString(),
  });

  // Clean up Redis now that the wizard is done
  await deps.redis.del(redisKey(wizardId));

  return { eventDraftId };
}

import type { DbAdapter, WizardData, WizardStep, StepSubmission, StepResult } from '../lib/types.js';
import { validateStep } from './wizard-validator.service.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const STEP_ORDER: WizardStep[] = [
  'event_basics',
  'ticket_types',
  'payment_setup',
  'event_details',
  'review_publish',
];

const SKIPPABLE_STEPS = new Set<WizardStep>(['payment_setup', 'event_details']);

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNextStep(current: WizardStep): WizardStep | null {
  const idx = STEP_ORDER.indexOf(current);
  if (idx === -1 || idx >= STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1] ?? null;
}

function getPrevStep(current: WizardStep): WizardStep | null {
  const idx = STEP_ORDER.indexOf(current);
  if (idx <= 0) return null;
  return STEP_ORDER[idx - 1] ?? null;
}

function computeProgress(completedSteps: WizardStep[]): number {
  return Math.round((completedSteps.length / STEP_ORDER.length) * 100);
}

function buildStepResult(row: SessionRow): StepResult {
  const nextStep = row.status === 'completed' ? null : getNextStep(row.current_step);
  return {
    sessionId: row.id,
    currentStep: row.current_step,
    nextStep,
    completedSteps: row.completed_steps,
    progress: computeProgress(row.completed_steps),
  };
}

async function loadSession(sessionId: string, db: DbAdapter): Promise<SessionRow> {
  const rows = await db.query<SessionRow>(
    `SELECT id, promoter_id, current_step, completed_steps, data, status,
            created_at, updated_at, expires_at
     FROM onboarding_wizard_sessions
     WHERE id = $1`,
    [sessionId],
  );

  if (!rows[0]) {
    throw new Error(`Wizard session '${sessionId}' nenalezena.`);
  }
  return rows[0];
}

// ─── submitStep ───────────────────────────────────────────────────────────────

export async function submitStep(
  sessionId: string,
  submission: StepSubmission,
  db: DbAdapter,
): Promise<StepResult> {
  const session = await loadSession(sessionId, db);

  if (session.status !== 'in_progress') {
    throw new Error('Wizard session není aktivní.');
  }

  if (session.current_step !== submission.step) {
    throw new Error(
      `Očekávaný krok je '${session.current_step}', ale odeslaný je '${submission.step}'.`,
    );
  }

  // Merge incoming data with existing session data
  const mergedData: WizardData = { ...session.data, ...(submission.data as Partial<WizardData>) };

  // Validate
  const errors = validateStep(submission.step, mergedData);
  if (Object.keys(errors).length > 0) {
    return {
      sessionId,
      currentStep: session.current_step,
      nextStep: getNextStep(session.current_step),
      completedSteps: session.completed_steps,
      progress: computeProgress(session.completed_steps),
      errors,
    };
  }

  // Mark step completed
  const completedSteps = session.completed_steps.includes(submission.step)
    ? session.completed_steps
    : [...session.completed_steps, submission.step];

  const nextStep = getNextStep(submission.step);
  const newCurrentStep: WizardStep = nextStep ?? submission.step;
  const newStatus: SessionRow['status'] = nextStep === null ? 'in_progress' : 'in_progress';

  await db.execute(
    `UPDATE onboarding_wizard_sessions
     SET current_step = $1,
         completed_steps = $2,
         data = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [newCurrentStep, completedSteps, JSON.stringify(mergedData), sessionId],
  );

  return {
    sessionId,
    currentStep: newCurrentStep,
    nextStep: nextStep !== null ? getNextStep(newCurrentStep) : null,
    completedSteps,
    progress: computeProgress(completedSteps),
  };
}

// ─── goBackStep ───────────────────────────────────────────────────────────────

export async function goBackStep(sessionId: string, db: DbAdapter): Promise<StepResult> {
  const session = await loadSession(sessionId, db);

  if (session.status !== 'in_progress') {
    throw new Error('Wizard session není aktivní.');
  }

  const prevStep = getPrevStep(session.current_step);
  if (!prevStep) {
    throw new Error('Již jste na prvním kroku, nelze jít zpět.');
  }

  await db.execute(
    `UPDATE onboarding_wizard_sessions
     SET current_step = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [prevStep, sessionId],
  );

  const updatedRow: SessionRow = { ...session, current_step: prevStep };
  return buildStepResult(updatedRow);
}

// ─── skipStep ─────────────────────────────────────────────────────────────────

export async function skipStep(sessionId: string, db: DbAdapter): Promise<StepResult> {
  const session = await loadSession(sessionId, db);

  if (session.status !== 'in_progress') {
    throw new Error('Wizard session není aktivní.');
  }

  if (!SKIPPABLE_STEPS.has(session.current_step)) {
    throw new Error(`Krok '${session.current_step}' nelze přeskočit.`);
  }

  const nextStep = getNextStep(session.current_step);
  if (!nextStep) {
    throw new Error('Nelze přeskočit poslední krok.');
  }

  await db.execute(
    `UPDATE onboarding_wizard_sessions
     SET current_step = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [nextStep, sessionId],
  );

  const updatedRow: SessionRow = { ...session, current_step: nextStep };
  return buildStepResult(updatedRow);
}

// funnel.types.ts — Typy pro conversion funnel tracking

export type FunnelStep =
  | 'view'
  | 'cart'
  | 'checkout'
  | 'paid'
  | 'ticket_issued';

/** Pořadí kroků funnelu od prvního po poslední */
export const FUNNEL_STEPS: FunnelStep[] = [
  'view',
  'cart',
  'checkout',
  'paid',
  'ticket_issued',
];

/**
 * FunnelEvent — zaznamenaná událost v checkoutu.
 * userId je nullable (anonymní tracking — GDPR: sessionId neobsahuje PII).
 */
export interface FunnelEvent {
  id: string;
  sessionId: string;
  /** Nullable — anonymní uživatelé (pre-login). Žádná PII. */
  userId: string | null;
  eventId: string;
  step: FunnelStep;
  /** Libovolná doplňující data (JSONB v DB) */
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Statistiky jednoho kroku funnelu */
export interface FunnelStepStats {
  step: FunnelStep;
  count: number;
  dropOffCount: number;
  /** Procento uživatelů kteří opustili funnel na tomto kroku (0–100, 2 des. místa) */
  dropOffRate: number;
}

/** Kompletní report funnelu pro danou akci a časové období */
export interface FunnelReport {
  eventId: string;
  period: {
    from: Date;
    to: Date;
  };
  steps: FunnelStepStats[];
  /** Podíl uživatelů kteří dokončili celý funnel (first step → last step), 0–100 */
  overallConversionRate: number;
}

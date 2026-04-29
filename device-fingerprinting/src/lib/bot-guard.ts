import { assessDevice, assessRisk, type DeviceDeps, type DeviceAssessment, type RiskAssessment } from '../services/device.service.js';
import type { FingerprintSignals } from './fingerprint.js';
import type { BehaviorSignals } from './behavior-scorer.js';
import { DeviceError } from './device-errors.js';

export interface BotGuardInput {
  signals: FingerprintSignals;
  behavior: BehaviorSignals;
  userId?: string;
  eventId?: string;
  orderId?: string;
  action?: string;
}

export interface BotGuardResult {
  allowed: boolean;
  device: DeviceAssessment;
  risk: RiskAssessment;
  blocked: boolean;
  reason?: string;
}

/**
 * Unified bot-guard that runs device fingerprinting + velocity check + behavior
 * risk assessment in one call. Designed for checkout middleware integration.
 *
 * Returns `allowed: false` when velocity is exceeded OR risk level is 'bot'.
 * Returns `blocked: true` when the fingerprint is on the blocklist.
 */
export async function runBotGuard(
  input: BotGuardInput,
  deps: DeviceDeps,
): Promise<BotGuardResult> {
  // 1. Check blocklist first — fast reject
  const device = await assessDevice(
    { signals: input.signals, userId: input.userId, eventId: input.eventId, orderId: input.orderId, action: input.action },
    deps,
  );

  const isBlocked = await isFingerPrintBlocked(device.fingerprintHash, deps);
  if (isBlocked) {
    return {
      allowed: false,
      device,
      risk: {
        overallScore: 100,
        level: 'bot',
        reasons: ['fingerprint_blocklisted'],
        behavior: { score: 0, reasons: [], level: 'human' },
        distinctAccounts24h: 0,
        recommendation: 'block',
      },
      blocked: true,
      reason: 'fingerprint_blocklisted',
    };
  }

  // 2. Run behavior risk assessment
  const risk = await assessRisk(device.fingerprintHash, input.behavior, deps);

  const allowed = device.allowed && risk.recommendation !== 'block';
  let reason: string | undefined;
  if (!device.allowed) reason = 'velocity_exceeded';
  else if (risk.recommendation === 'block') reason = 'bot_detected';

  return { allowed, device, risk, blocked: false, reason };
}

async function isFingerPrintBlocked(
  fingerprintHash: string,
  deps: DeviceDeps,
): Promise<boolean> {
  const rows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM risk.fingerprint_blocklist
     WHERE fingerprint_hash = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [fingerprintHash],
  );
  return parseInt(rows[0]?.count ?? '0', 10) > 0;
}

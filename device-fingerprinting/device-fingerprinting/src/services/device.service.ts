import { computeFingerprint, hashIp, FingerprintSignals } from '../lib/fingerprint.js';
import { DeviceError } from '../lib/device-errors.js';
import { scoreBehavior, BehaviorSignals, BehaviorScore } from '../lib/behavior-scorer.js';

export interface DeviceDeps {
  db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<void>;
  };
}

export interface RecordFingerprintInput {
  signals: FingerprintSignals;
  userId?: string;
  eventId?: string;
  orderId?: string;
  action?: string;
}

export interface VelocityResult {
  fingerprintHash: string;
  ipHash: string;
  fingerprintCount: number;
  ipCount: number;
  userCount: number;
  exceedsLimit: boolean;
  riskScore: number;   // 0-100, fed to fraud queue
  signals: string[];   // human-readable risk signals
}

export interface DeviceAssessment {
  fingerprintHash: string;
  ipHash: string;
  velocity: VelocityResult;
  allowed: boolean;
}

export async function recordFingerprint(
  input: RecordFingerprintInput,
  deps: DeviceDeps,
): Promise<{ fingerprintHash: string; ipHash: string }> {
  const fingerprintHash = computeFingerprint(input.signals);
  const ipHash = hashIp(input.signals.ipAddress);
  const userAgentHash = input.signals.userAgent
    ? (await import('crypto')).createHash('sha256').update(input.signals.userAgent).digest('hex')
    : null;

  await deps.db.execute(
    `INSERT INTO risk.device_fingerprints
       (fingerprint_hash, user_id, ip_hash, user_agent_hash, event_id, order_id, action)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [fingerprintHash, input.userId ?? null, ipHash, userAgentHash,
     input.eventId ?? null, input.orderId ?? null, input.action ?? 'checkout'],
  );

  return { fingerprintHash, ipHash };
}

export async function checkVelocity(
  fingerprintHash: string,
  ipHash: string,
  userId: string | undefined,
  deps: DeviceDeps,
): Promise<VelocityResult> {
  const [fpRows, ipRows, userRows, limits] = await Promise.all([
    deps.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM risk.device_fingerprints
       WHERE fingerprint_hash = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [fingerprintHash],
    ),
    deps.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM risk.device_fingerprints
       WHERE ip_hash = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [ipHash],
    ),
    userId ? deps.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM risk.device_fingerprints
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [userId],
    ) : Promise.resolve([{ count: '0' }]),
    deps.db.query<{ dimension: string; max_count: number }>(
      `SELECT dimension, max_count FROM risk.velocity_limits`,
    ),
  ]);

  const limitMap = Object.fromEntries(limits.map(l => [l.dimension, l.max_count]));
  const fpLimit = limitMap['fingerprint'] ?? 5;
  const ipLimit = limitMap['ip'] ?? 10;
  const userLimit = limitMap['user'] ?? 3;

  const fingerprintCount = parseInt(fpRows[0]?.count ?? '0', 10);
  const ipCount = parseInt(ipRows[0]?.count ?? '0', 10);
  const userCount = parseInt(userRows[0]?.count ?? '0', 10);

  const riskSignals: string[] = [];
  let riskScore = 0;

  if (fingerprintCount >= fpLimit) {
    riskSignals.push(`velocity_check: fingerprint ${fingerprintCount}/${fpLimit} in 24h`);
    riskScore += 40;
  } else if (fingerprintCount >= fpLimit * 0.7) {
    riskSignals.push(`velocity_check: fingerprint approaching limit ${fingerprintCount}/${fpLimit}`);
    riskScore += 15;
  }

  if (ipCount >= ipLimit) {
    riskSignals.push(`velocity_check: ip ${ipCount}/${ipLimit} in 24h`);
    riskScore += 35;
  } else if (ipCount >= ipLimit * 0.7) {
    riskSignals.push(`velocity_check: ip approaching limit ${ipCount}/${ipLimit}`);
    riskScore += 10;
  }

  if (userId && userCount >= userLimit) {
    riskSignals.push(`velocity_check: user ${userCount}/${userLimit} in 1h`);
    riskScore += 25;
  }

  riskScore = Math.min(riskScore, 100);
  const exceedsLimit = fingerprintCount >= fpLimit || ipCount >= ipLimit || (!!userId && userCount >= userLimit);

  return {
    fingerprintHash,
    ipHash,
    fingerprintCount,
    ipCount,
    userCount,
    exceedsLimit,
    riskScore,
    signals: riskSignals,
  };
}

export interface RiskAssessment {
  overallScore: number;                 // 0..100
  level: 'human' | 'suspicious' | 'bot';
  reasons: string[];
  behavior: BehaviorScore;
  distinctAccounts24h: number;
  recommendation: 'allow' | 'challenge' | 'block';
}

/**
 * Combines fingerprint cross-session history with client-side behavior
 * signals into a single risk assessment.
 */
export async function assessRisk(
  fingerprintHash: string,
  behavior: BehaviorSignals,
  deps: DeviceDeps,
): Promise<RiskAssessment> {
  const behaviorScore = scoreBehavior(behavior);
  const reasons = [...behaviorScore.reasons];
  let overallScore = behaviorScore.score;

  const rows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(DISTINCT user_id) AS count
       FROM risk.device_fingerprints
      WHERE fingerprint_hash = $1
        AND user_id IS NOT NULL
        AND created_at > NOW() - INTERVAL '24 hours'`,
    [fingerprintHash],
  );
  const distinctAccounts24h = parseInt(rows[0]?.count ?? '0', 10);

  if (distinctAccounts24h > 5) {
    overallScore += 20;
    reasons.push(`fingerprint_shared: ${distinctAccounts24h} accounts in 24h`);
  }

  if (overallScore > 100) overallScore = 100;

  const level: RiskAssessment['level'] =
    overallScore >= 70 ? 'bot' : overallScore >= 30 ? 'suspicious' : 'human';
  const recommendation: RiskAssessment['recommendation'] =
    level === 'bot' ? 'block' : level === 'suspicious' ? 'challenge' : 'allow';

  return {
    overallScore,
    level,
    reasons,
    behavior: behaviorScore,
    distinctAccounts24h,
    recommendation,
  };
}

export async function assessDevice(
  input: RecordFingerprintInput,
  deps: DeviceDeps,
): Promise<DeviceAssessment> {
  const { fingerprintHash, ipHash } = await recordFingerprint(input, deps);
  const velocity = await checkVelocity(fingerprintHash, ipHash, input.userId, deps);
  return {
    fingerprintHash,
    ipHash,
    velocity,
    allowed: !velocity.exceedsLimit,
  };
}

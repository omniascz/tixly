import { createHmac } from 'crypto';
import type { BotSignals } from '../lib/types.js';

const CHALLENGE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function buildPayload(sessionId: string, expiresAt: string): string {
  return `${sessionId}:${expiresAt}`;
}

export function generateChallengeToken(
  sessionId: string,
  secretKey: string,
): { token: string; expiresAt: string } {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const payload = buildPayload(sessionId, expiresAt);
  const sig = createHmac('sha256', secretKey).update(payload).digest('hex');
  // token = base64url(payload).sig  — use dot separator (safe, not in base64url or hex)
  const token = `${Buffer.from(payload).toString('base64url')}.${sig}`;
  return { token, expiresAt };
}

export function verifyChallengeToken(
  token: string,
  sessionId: string,
  secretKey: string,
): boolean {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx === -1) return false;

  const encodedPayload = token.substring(0, dotIdx);
  const sig = token.substring(dotIdx + 1);

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return false;
  }

  // Verify signature
  const expectedSig = createHmac('sha256', secretKey).update(payload).digest('hex');
  if (sig !== expectedSig) return false;

  // Parse payload: format is "<sessionId>:<expiresAt>"
  const colonIdx = payload.indexOf(':');
  if (colonIdx === -1) return false;

  const payloadSessionId = payload.substring(0, colonIdx);
  const expiresAt = payload.substring(colonIdx + 1);

  if (payloadSessionId !== sessionId) return false;

  // Check expiry using Date.now() so tests can mock it
  if (Date.now() > new Date(expiresAt).getTime()) return false;

  return true;
}

export function requiresChallenge(signals: BotSignals): boolean {
  return (
    signals.headlessBrowser ||
    signals.suspiciousUserAgent ||
    signals.rateLimit ||
    signals.datacenterIp ||
    signals.duplicateFingerprint
  );
}

import { createHash } from 'crypto';

export interface FingerprintSignals {
  ipAddress: string;
  userAgent?: string;
  acceptLanguage?: string;
  screenResolution?: string;   // "1920x1080"
  timezone?: string;           // "Europe/Prague"
  platform?: string;
  colorDepth?: number;
  hardwareConcurrency?: number;
}

/** Stable SHA-256 hash of normalized signals */
export function computeFingerprint(signals: FingerprintSignals): string {
  const normalized = [
    signals.userAgent ?? '',
    signals.acceptLanguage ?? '',
    signals.screenResolution ?? '',
    signals.timezone ?? '',
    signals.platform ?? '',
    String(signals.colorDepth ?? ''),
    String(signals.hardwareConcurrency ?? ''),
  ].join('|').toLowerCase().trim();
  return createHash('sha256').update(normalized).digest('hex');
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface QueueEntry {
  id: string;
  eventId: string;
  sessionId: string;
  ipAddress: string;
  userAgent?: string;
  fingerprintHash?: string;
  position: number;
  status: 'waiting' | 'challenge_required' | 'verified' | 'admitted' | 'rejected' | 'expired';
  challengeToken?: string;
  challengeExpiresAt?: string;
  admittedAt?: string;
  createdAt: string;
  expiresAt: string;
}

export interface BotSignals {
  headlessBrowser: boolean;
  suspiciousUserAgent: boolean;
  rateLimit: boolean;
  datacenterIp: boolean;
  duplicateFingerprint: boolean;
}

export interface ChallengeResult {
  passed: boolean;
  challengeToken?: string;
  expiresAt?: string;
  reason?: string;
}

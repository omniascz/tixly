export type FlagStatus = 'enabled' | 'disabled' | 'gradual';

export interface FeatureFlag {
  key: string;
  status: FlagStatus;
  rolloutPercentage?: number;   // 0-100, jen pro status='gradual'
  enabledTenants?: string[];    // specifická promoter_id — vždy ON
  disabledTenants?: string[];   // specifická promoter_id — vždy OFF (override)
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FlagEvaluationContext {
  tenantId?: string;
  userId?: string;
}

export interface FlagStore {
  getFlag(key: string): Promise<FeatureFlag | null>;
  setFlag(flag: FeatureFlag): Promise<void>;
  deleteFlag(key: string): Promise<void>;
  listFlags(): Promise<FeatureFlag[]>;
}

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

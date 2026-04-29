import { randomBytes, createHash } from "crypto";

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface CreateApiKeyInput {
  promoterId: string;
  name: string;
  scopes: string[];
  environment: "live" | "test";
  tier?: "free" | "standard" | "premium";
  ipWhitelist?: string[];
  expiresAt?: Date;
}

export interface ApiKeyCreated {
  id: string;
  rawKey: string;    // zobrazí se uživateli JEDNOU — poté nedostupný
  prefix: string;
  name: string;
  scopes: string[];
  environment: "live" | "test";
  tier: string;
  createdAt: Date;
}

export interface ApiKeySummary {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  environment: "live" | "test";
  tier: string;
  ipWhitelist: string[] | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  status: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Validní scopes
// ---------------------------------------------------------------------------
export const VALID_SCOPES = [
  "read:events",
  "write:events",
  "write:orders",
  "read:orders",
  "read:reports",
  "manage:webhooks",
  "read:tickets",
  "admin:keys",
] as const;

export type Scope = (typeof VALID_SCOPES)[number];

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------
export interface ApiKeyDBAdapter {
  createApiKey(input: {
    promoterId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
    scopes: string[];
    environment: string;
    tier: string;
    ipWhitelist: string[] | null;
    expiresAt: Date | null;
  }): Promise<{ id: string; createdAt: Date }>;

  listApiKeys(promoterId: string): Promise<ApiKeySummary[]>;

  getApiKey(id: string, promoterId: string): Promise<ApiKeySummary | null>;

  revokeApiKey(
    id: string,
    promoterId: string,
    reason: string
  ): Promise<boolean>;

  rotateApiKey(
    id: string,
    promoterId: string
  ): Promise<{ newKeyPrefix: string; newKeyHash: string; rawKey: string } | null>;
}

export const apiKeyDb = {} as ApiKeyDBAdapter;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ApiKeyService {
  constructor(private readonly db: ApiKeyDBAdapter) {}

  /**
   * Generuje nový API klíč.
   * Raw klíč je vrácen JEDNOU — poté je dostupný pouze prefix pro UI.
   */
  async create(input: CreateApiKeyInput): Promise<ApiKeyCreated> {
    // Validace scopes
    const invalidScopes = input.scopes.filter(
      (s) => !(VALID_SCOPES as readonly string[]).includes(s)
    );
    if (invalidScopes.length > 0) {
      throw new ApiKeyError(
        `Neplatné scopes: ${invalidScopes.join(", ")}. Povolené: ${VALID_SCOPES.join(", ")}`,
        422
      );
    }

    if (input.scopes.length === 0) {
      throw new ApiKeyError("Alespoň jeden scope je povinný", 422);
    }

    const { raw, hash, prefix } = generateApiKey(input.environment);

    const { id, createdAt } = await this.db.createApiKey({
      promoterId: input.promoterId,
      name: input.name,
      keyPrefix: prefix,
      keyHash: hash,
      scopes: input.scopes,
      environment: input.environment,
      tier: input.tier ?? "free",
      ipWhitelist: input.ipWhitelist ?? null,
      expiresAt: input.expiresAt ?? null,
    });

    return {
      id,
      rawKey: raw,
      prefix,
      name: input.name,
      scopes: input.scopes,
      environment: input.environment,
      tier: input.tier ?? "free",
      createdAt,
    };
  }

  async list(promoterId: string): Promise<ApiKeySummary[]> {
    return this.db.listApiKeys(promoterId);
  }

  async get(id: string, promoterId: string): Promise<ApiKeySummary> {
    const key = await this.db.getApiKey(id, promoterId);
    if (!key) throw new ApiKeyError("API klíč nenalezen", 404);
    return key;
  }

  async revoke(
    id: string,
    promoterId: string,
    reason: string
  ): Promise<void> {
    const ok = await this.db.revokeApiKey(id, promoterId, reason);
    if (!ok) throw new ApiKeyError("API klíč nenalezen", 404);
  }

  /**
   * Rotace klíče — invaliduje starý, vydá nový se stejnými parametry.
   * Nový raw klíč je vrácen JEDNOU.
   */
  async rotate(
    id: string,
    promoterId: string
  ): Promise<{ rawKey: string; prefix: string }> {
    const result = await this.db.rotateApiKey(id, promoterId);
    if (!result) throw new ApiKeyError("API klíč nenalezen", 404);
    return { rawKey: result.rawKey, prefix: result.newKeyPrefix };
  }
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

export function generateApiKey(env: "live" | "test"): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const random = randomBytes(15).toString("base64url"); // 20 chars base64url
  const raw = `tick_${env}_${random}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = `tick_${env}_${random.slice(0, 6)}`;
  return { raw, hash, prefix };
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ApiKeyError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "ApiKeyError";
  }
}

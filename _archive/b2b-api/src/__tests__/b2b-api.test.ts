import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ApiKeyService,
  ApiKeyDBAdapter,
  generateApiKey,
  ApiKeyError,
  VALID_SCOPES,
} from '../services/api-key.service.js';
import type { CreateApiKeyInput, ApiKeySummary } from '../services/api-key.service.js';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let mockDb: ApiKeyDBAdapter;

  beforeEach(() => {
    mockDb = {
      createApiKey: vi.fn(),
      listApiKeys: vi.fn(),
      getApiKey: vi.fn(),
      revokeApiKey: vi.fn(),
      rotateApiKey: vi.fn(),
    };

    service = new ApiKeyService(mockDb);
  });

  describe('createApiKey', () => {
    it('should create a new API key with correct structure', async () => {
      const input: CreateApiKeyInput = {
        promoterId: 'promo_123',
        name: 'My API Key',
        scopes: ['read:events', 'write:orders'],
        environment: 'live',
      };

      vi.mocked(mockDb.createApiKey).mockResolvedValue({
        id: 'key_abc123',
        createdAt: new Date(),
      });

      const result = await service.create(input);

      expect(result.id).toBeDefined();
      expect(result.rawKey).toBeDefined();
      expect(result.prefix).toBeDefined();
      expect(result.name).toBe('My API Key');
      expect(result.scopes).toEqual(['read:events', 'write:orders']);
      expect(result.environment).toBe('live');
      expect(result.tier).toBe('free');
    });

    it('should generate key with test environment prefix', async () => {
      const input: CreateApiKeyInput = {
        promoterId: 'promo_test',
        name: 'Test Key',
        scopes: ['read:events'],
        environment: 'test',
      };

      vi.mocked(mockDb.createApiKey).mockResolvedValue({
        id: 'key_test',
        createdAt: new Date(),
      });

      const result = await service.create(input);

      expect(result.rawKey).toMatch(/^tick_test_/);
      expect(result.environment).toBe('test');
    });

    it('should validate scopes and reject invalid scopes', async () => {
      const input: CreateApiKeyInput = {
        promoterId: 'promo_123',
        name: 'Bad Key',
        scopes: ['read:events', 'invalid:scope'],
        environment: 'live',
      };

      await expect(service.create(input)).rejects.toThrow(ApiKeyError);
    });

    it('should require at least one scope', async () => {
      const input: CreateApiKeyInput = {
        promoterId: 'promo_123',
        name: 'No Scopes',
        scopes: [],
        environment: 'live',
      };

      await expect(service.create(input)).rejects.toThrow('Alespoň jeden scope');
    });

    it('should support tier parameter', async () => {
      const input: CreateApiKeyInput = {
        promoterId: 'promo_123',
        name: 'Premium Key',
        scopes: ['read:events'],
        environment: 'live',
        tier: 'premium',
      };

      vi.mocked(mockDb.createApiKey).mockResolvedValue({
        id: 'key_premium',
        createdAt: new Date(),
      });

      const result = await service.create(input);

      expect(result.tier).toBe('premium');
    });

    it('should support IP whitelist', async () => {
      const input: CreateApiKeyInput = {
        promoterId: 'promo_123',
        name: 'Restricted Key',
        scopes: ['read:events'],
        environment: 'live',
        ipWhitelist: ['192.168.1.1', '10.0.0.0/8'],
      };

      vi.mocked(mockDb.createApiKey).mockResolvedValue({
        id: 'key_restricted',
        createdAt: new Date(),
      });

      await service.create(input);

      expect(vi.mocked(mockDb.createApiKey)).toHaveBeenCalledWith(
        expect.objectContaining({
          ipWhitelist: ['192.168.1.1', '10.0.0.0/8'],
        })
      );
    });

    it('should support expiration date', async () => {
      const expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const input: CreateApiKeyInput = {
        promoterId: 'promo_123',
        name: 'Expiring Key',
        scopes: ['read:events'],
        environment: 'live',
        expiresAt: expirationDate,
      };

      vi.mocked(mockDb.createApiKey).mockResolvedValue({
        id: 'key_expiring',
        createdAt: new Date(),
      });

      await service.create(input);

      expect(vi.mocked(mockDb.createApiKey)).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expirationDate,
        })
      );
    });
  });

  describe('validateApiKey', () => {
    it('should retrieve API key by ID', async () => {
      const keyId = 'key_456';
      const promoterId = 'promo_123';
      const mockKey: ApiKeySummary = {
        id: keyId,
        prefix: 'tick_live_abc123',
        name: 'My Key',
        scopes: ['read:events'],
        environment: 'live',
        tier: 'free',
        ipWhitelist: null,
        lastUsedAt: null,
        expiresAt: null,
        status: 'active',
        createdAt: new Date(),
      };

      vi.mocked(mockDb.getApiKey).mockResolvedValue(mockKey);

      const result = await service.get(keyId, promoterId);

      expect(result).toEqual(mockKey);
      expect(vi.mocked(mockDb.getApiKey)).toHaveBeenCalledWith(keyId, promoterId);
    });

    it('should throw error if key not found', async () => {
      vi.mocked(mockDb.getApiKey).mockResolvedValue(null);

      await expect(service.get('missing_key', 'promo_123')).rejects.toThrow(
        'API klíč nenalezen'
      );
    });
  });

  describe('listApiKeys', () => {
    it('should return all keys for a promoter', async () => {
      const promoterId = 'promo_789';
      const mockKeys: ApiKeySummary[] = [
        {
          id: 'key_1',
          prefix: 'tick_live_aaa',
          name: 'Key 1',
          scopes: ['read:events'],
          environment: 'live',
          tier: 'free',
          ipWhitelist: null,
          lastUsedAt: null,
          expiresAt: null,
          status: 'active',
          createdAt: new Date(),
        },
        {
          id: 'key_2',
          prefix: 'tick_test_bbb',
          name: 'Key 2',
          scopes: ['read:orders', 'write:orders'],
          environment: 'test',
          tier: 'standard',
          ipWhitelist: ['192.168.1.1'],
          lastUsedAt: new Date(),
          expiresAt: null,
          status: 'active',
          createdAt: new Date(),
        },
      ];

      vi.mocked(mockDb.listApiKeys).mockResolvedValue(mockKeys);

      const result = await service.list(promoterId);

      expect(result).toEqual(mockKeys);
      expect(result.length).toBe(2);
      expect(vi.mocked(mockDb.listApiKeys)).toHaveBeenCalledWith(promoterId);
    });
  });

  describe('rateLimit', () => {
    it('should track API key usage for rate limiting', async () => {
      const keyId = 'key_ratelimit';
      const promoterId = 'promo_123';
      const mockKey: ApiKeySummary = {
        id: keyId,
        prefix: 'tick_live_rate',
        name: 'Rate Limited Key',
        scopes: ['read:events'],
        environment: 'live',
        tier: 'standard',
        ipWhitelist: null,
        lastUsedAt: new Date(),
        expiresAt: null,
        status: 'active',
        createdAt: new Date(),
      };

      vi.mocked(mockDb.getApiKey).mockResolvedValue(mockKey);

      const result = await service.get(keyId, promoterId);

      expect(result.tier).toBe('standard');
      expect(result.lastUsedAt).toBeDefined();
    });
  });

  describe('key rotation', () => {
    it('should rotate API key', async () => {
      const keyId = 'key_rotate';
      const promoterId = 'promo_123';

      vi.mocked(mockDb.rotateApiKey).mockResolvedValue({
        newKeyPrefix: 'tick_live_newprefix',
        newKeyHash: 'new_hash_value',
        rawKey: 'tick_live_new_full_key',
      });

      const result = await service.rotate(keyId, promoterId);

      expect(result.rawKey).toBeDefined();
      expect(result.prefix).toBeDefined();
      expect(result.rawKey).toMatch(/^tick_live_/);
    });

    it('should throw error if key not found during rotation', async () => {
      vi.mocked(mockDb.rotateApiKey).mockResolvedValue(null);

      await expect(service.rotate('missing_key', 'promo_123')).rejects.toThrow(
        'API klíč nenalezen'
      );
    });
  });

  describe('generateApiKey utility', () => {
    it('should generate key with live prefix', () => {
      const { raw, hash, prefix } = generateApiKey('live');

      expect(raw).toMatch(/^tick_live_/);
      expect(prefix).toMatch(/^tick_live_/);
      expect(hash).toHaveLength(64); // SHA256 hex string
      expect(prefix.length).toBeLessThan(raw.length);
    });

    it('should generate key with test prefix', () => {
      const { raw, hash, prefix } = generateApiKey('test');

      expect(raw).toMatch(/^tick_test_/);
      expect(prefix).toMatch(/^tick_test_/);
      expect(hash).toHaveLength(64);
    });

    it('should generate unique keys', () => {
      const key1 = generateApiKey('live');
      const key2 = generateApiKey('live');

      expect(key1.raw).not.toBe(key2.raw);
      expect(key1.hash).not.toBe(key2.hash);
    });
  });

  describe('revoke API key', () => {
    it('should revoke an API key', async () => {
      const keyId = 'key_to_revoke';
      const promoterId = 'promo_123';

      vi.mocked(mockDb.revokeApiKey).mockResolvedValue(true);

      await service.revoke(keyId, promoterId, 'Key compromised');

      expect(vi.mocked(mockDb.revokeApiKey)).toHaveBeenCalledWith(
        keyId,
        promoterId,
        'Key compromised'
      );
    });

    it('should throw error if key not found on revoke', async () => {
      vi.mocked(mockDb.revokeApiKey).mockResolvedValue(false);

      await expect(service.revoke('missing_key', 'promo_123', 'test')).rejects.toThrow(
        'API klíč nenalezen'
      );
    });
  });
});

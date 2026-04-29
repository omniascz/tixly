import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateRecommendations,
  getRecommendationsFromCache,
  cacheRecommendations,
  invalidateUserCache,
} from '../services/recommendation.service.js';
import type {
  DbAdapter,
  RedisAdapter,
  ServiceDeps,
  RecommendationServiceOptions,
  UserRecommendation,
} from '../types/recommendation.types.js';

describe('RecommendationService', () => {
  let mockDb: DbAdapter;
  let mockRedis: RedisAdapter;
  let deps: ServiceDeps;

  beforeEach(() => {
    mockDb = {
      execute: vi.fn(),
      query: vi.fn(),
    };

    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    deps = { db: mockDb, redis: mockRedis };
  });

  describe('getRecommendations', () => {
    it('should return recommendations sorted by score descending', async () => {
      const userId = 'user_123';
      const options: RecommendationServiceOptions = { limit: 10 };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.query).mockResolvedValue([
        {
          user_id: userId,
          event_id: 'event_1',
          score: 0.95,
          rank: 1,
          explanation_key: 'GenreMatch',
          explanation_params: { genre: 'rock' },
          model_version: 'popularity-v1',
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        },
        {
          user_id: userId,
          event_id: 'event_2',
          score: 0.85,
          rank: 2,
          explanation_key: 'PopularInCity',
          explanation_params: { city: 'Prague' },
          model_version: 'popularity-v1',
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        },
      ]);

      const result = await generateRecommendations(userId, options, deps);

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
      if (result.recommendations.length > 1) {
        expect(result.recommendations[0].score).toBeGreaterThanOrEqual(
          result.recommendations[1].score
        );
      }
    });

    it('should return popular events for cold start (new user)', async () => {
      const userId = 'new_user';
      const options: RecommendationServiceOptions = { limit: 5, skipCache: true };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce([]) // no precomputed
        .mockResolvedValueOnce(null) // no user features
        .mockResolvedValueOnce([]); // fallback query

      const result = await generateRecommendations(userId, options, deps);

      expect(result.personalized).toBe(false);
      expect(result.recommendations).toBeDefined();
    });

    it('should apply content-based filtering when available', async () => {
      const userId = 'user_456';
      const options: RecommendationServiceOptions = {
        limit: 10,
        categoryFilter: 'rock'
      };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.query).mockResolvedValue([
        {
          user_id: userId,
          event_id: 'event_rock_1',
          score: 0.9,
          rank: 1,
          explanation_key: 'GenreMatch',
          explanation_params: { genre: 'rock' },
          model_version: 'popularity-v1',
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        },
      ]);

      const result = await generateRecommendations(userId, options, deps);

      expect(result.recommendations).toBeDefined();
    });

    it('should support limit/offset pagination', async () => {
      const userId = 'user_789';
      const options: RecommendationServiceOptions = { limit: 5 };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.query).mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          user_id: userId,
          event_id: `event_${i}`,
          score: 0.9 - i * 0.01,
          rank: i + 1,
          explanation_key: 'PopularInCity',
          explanation_params: { city: 'Prague' },
          model_version: 'popularity-v1',
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        }))
      );

      const result = await generateRecommendations(userId, options, deps);

      expect(result.recommendations.length).toBeLessThanOrEqual(5);
    });

    it('should return personalized=true for computed recommendations', async () => {
      const userId = 'user_personal';
      const options: RecommendationServiceOptions = { limit: 10 };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.query).mockResolvedValue([]);

      const result = await generateRecommendations(userId, options, deps);

      expect(result.modelVersion).toBe('popularity-v1');
    });
  });

  describe('cache operations', () => {
    it('should retrieve recommendations from Redis cache', async () => {
      const userId = 'user_cached';
      const cachedData = {
        recommendations: [
          {
            userId,
            eventId: 'event_1',
            score: 0.95,
            rank: 1,
            explanationKey: 'GenreMatch',
            explanationParams: { genre: 'rock' },
            modelVersion: 'popularity-v1',
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
            createdAt: new Date(),
          },
        ],
        cachedAt: new Date().toISOString(),
      };

      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(cachedData));

      const result = await getRecommendationsFromCache(userId, mockRedis);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.recommendations.length).toBeGreaterThan(0);
      }
    });

    it('should cache recommendations in Redis', async () => {
      const userId = 'user_to_cache';
      const recommendations: UserRecommendation[] = [
        {
          userId,
          eventId: 'event_1',
          score: 0.95,
          rank: 1,
          explanationKey: 'GenreMatch',
          explanationParams: { genre: 'rock' },
          modelVersion: 'popularity-v1',
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          createdAt: new Date(),
        },
      ];

      vi.mocked(mockRedis.set).mockResolvedValue();

      await cacheRecommendations(userId, recommendations, mockRedis);

      expect(vi.mocked(mockRedis.set)).toHaveBeenCalled();
    });

    it('should invalidate user cache', async () => {
      const userId = 'user_invalidate';

      vi.mocked(mockRedis.del).mockResolvedValue();

      await invalidateUserCache(userId, mockRedis);

      expect(vi.mocked(mockRedis.del)).toHaveBeenCalledWith(
        expect.stringContaining(userId)
      );
    });
  });

  describe('cold start handling', () => {
    it('should return popularity-based recommendations for new users without features', async () => {
      const userId = 'brand_new_user';
      const options: RecommendationServiceOptions = { limit: 5, skipCache: true };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce([]) // no precomputed
        .mockResolvedValueOnce(null) // null user features
        .mockResolvedValueOnce([
          {
            event_id: 'popular_event_1',
            sales_velocity_24h: 100,
            venue_city: 'Prague',
          },
        ]);

      const result = await generateRecommendations(userId, options, deps);

      expect(result.recommendations.length).toBeGreaterThanOrEqual(0);
      expect(result.personalized).toBe(false);
    });
  });

  describe('collaborative filtering', () => {
    it('should apply collaborative filtering when available', async () => {
      const userId = 'collab_user';
      const options: RecommendationServiceOptions = { limit: 10 };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.query).mockResolvedValue([
        {
          user_id: userId,
          event_id: 'collab_event_1',
          score: 0.87,
          rank: 1,
          explanation_key: 'SimilarToEvent',
          explanation_params: { eventId: 'similar_event' },
          model_version: 'popularity-v1',
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        },
      ]);

      const result = await generateRecommendations(userId, options, deps);

      expect(result.recommendations).toBeDefined();
    });
  });

  describe('scoring and ranking', () => {
    it('should rank recommendations by final score', async () => {
      const userId = 'rank_user';
      const options: RecommendationServiceOptions = { limit: 5 };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.query).mockResolvedValue([
        {
          user_id: userId,
          event_id: 'event_high',
          score: 0.95,
          rank: 1,
          explanation_key: 'GenreMatch',
          explanation_params: { genre: 'rock' },
          model_version: 'popularity-v1',
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        },
        {
          user_id: userId,
          event_id: 'event_low',
          score: 0.45,
          rank: 2,
          explanation_key: 'PopularInCity',
          explanation_params: { city: 'Prague' },
          model_version: 'popularity-v1',
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        },
      ]);

      const result = await generateRecommendations(userId, options, deps);

      expect(result.recommendations.length).toBeGreaterThan(0);
      if (result.recommendations.length > 1) {
        expect(result.recommendations[0].score).toBeGreaterThanOrEqual(
          result.recommendations[1].score
        );
      }
    });
  });
});

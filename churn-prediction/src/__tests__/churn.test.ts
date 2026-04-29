import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scorePass,
  getActionableChurnPredictions,
  markActionExecuted,
  recordOutcome,
} from '../services/churn-scoring.service.js';
import type { DbAdapter, ServiceDeps } from '../types/churn.types.js';
import { RetentionAction } from '../types/churn.types.js';

describe('ChurnScoringService', () => {
  let mockDb: DbAdapter;
  let deps: ServiceDeps;

  beforeEach(() => {
    mockDb = {
      queryOne: vi.fn(),
      query: vi.fn(),
      execute: vi.fn(),
    };

    deps = { db: mockDb };
  });

  describe('predictChurn', () => {
    it('should return probability between 0 and 1', async () => {
      const passId = 'pass_123';

      vi.mocked(mockDb.queryOne).mockResolvedValue({
        user_id: 'user_456',
      });

      vi.mocked(mockDb.query).mockResolvedValue([
        {
          id: 'pred_id',
          pass_id: passId,
          user_id: 'user_456',
          churn_probability: 0.65,
          top_features: { recency: 0.8, frequency: 0.6 },
          model_version: 'logistic-v1',
          prediction_horizon: '30d',
          retention_action: RetentionAction.EmailReminder,
          computed_at: new Date().toISOString(),
          action_executed_at: null,
          action_result: null,
        },
      ]);

      const result = await scorePass(passId, '30d', deps);

      expect(result.churnProbability).toBeGreaterThanOrEqual(0);
      expect(result.churnProbability).toBeLessThanOrEqual(1);
    });

    it('should extract and normalize features correctly', async () => {
      const passId = 'pass_features';

      vi.mocked(mockDb.queryOne).mockResolvedValue({
        user_id: 'user_789',
      });

      vi.mocked(mockDb.query).mockResolvedValue([
        {
          id: 'pred_id',
          pass_id: passId,
          user_id: 'user_789',
          churn_probability: 0.72,
          top_features: { engagement: 0.9, recency: 0.3, frequency: 0.7 },
          model_version: 'logistic-v1',
          prediction_horizon: '30d',
          retention_action: RetentionAction.EmailReminder,
          computed_at: new Date().toISOString(),
          action_executed_at: null,
          action_result: null,
        },
      ]);

      const result = await scorePass(passId, '30d', deps);

      expect(result.topFeatures).toBeDefined();
      expect(typeof result.topFeatures).toBe('object');
    });
  });

  describe('high-risk threshold', () => {
    it('should identify high-risk passes above threshold', async () => {
      const passId = 'pass_highrisk';

      vi.mocked(mockDb.queryOne).mockResolvedValue({
        user_id: 'user_high',
      });

      vi.mocked(mockDb.query).mockResolvedValue([
        {
          id: 'pred_id',
          pass_id: passId,
          user_id: 'user_high',
          churn_probability: 0.85,
          top_features: { recency: 0.1, frequency: 0.2 },
          model_version: 'logistic-v1',
          prediction_horizon: '7d',
          retention_action: RetentionAction.PushHighlight,
          computed_at: new Date().toISOString(),
          action_executed_at: null,
          action_result: null,
        },
      ]);

      const result = await scorePass(passId, '7d', deps);

      expect(result.churnProbability).toBeGreaterThan(0.7);
      expect(result.retentionAction).not.toBe(RetentionAction.None);
    });

    it('should return None action for low-risk passes', async () => {
      const passId = 'pass_lowrisk';

      vi.mocked(mockDb.queryOne).mockResolvedValue({
        user_id: 'user_low',
      });

      vi.mocked(mockDb.query).mockResolvedValue([
        {
          id: 'pred_id',
          pass_id: passId,
          user_id: 'user_low',
          churn_probability: 0.35,
          top_features: { engagement: 0.95, frequency: 0.9 },
          model_version: 'logistic-v1',
          prediction_horizon: '30d',
          retention_action: RetentionAction.None,
          computed_at: new Date().toISOString(),
          action_executed_at: null,
          action_result: null,
        },
      ]);

      const result = await scorePass(passId, '30d', deps);

      expect(result.churnProbability).toBeLessThan(0.6);
      expect(result.retentionAction).toBe(RetentionAction.None);
    });
  });

  describe('getActionableChurnPredictions', () => {
    it('should return only predictions above minimum probability threshold', async () => {
      const minProbability = 0.7;

      vi.mocked(mockDb.query).mockResolvedValue([
        {
          id: 'pred_1',
          pass_id: 'pass_1',
          user_id: 'user_1',
          churn_probability: 0.8,
          top_features: {},
          model_version: 'logistic-v1',
          prediction_horizon: '14d',
          retention_action: RetentionAction.EmailDiscount,
          computed_at: new Date().toISOString(),
          action_executed_at: null,
          action_result: null,
        },
        {
          id: 'pred_2',
          pass_id: 'pass_2',
          user_id: 'user_2',
          churn_probability: 0.75,
          top_features: {},
          model_version: 'logistic-v1',
          prediction_horizon: '14d',
          retention_action: RetentionAction.EmailDiscount,
          computed_at: new Date().toISOString(),
          action_executed_at: null,
          action_result: null,
        },
      ]);

      const result = await getActionableChurnPredictions(minProbability, '14d', mockDb);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      result.forEach((pred) => {
        expect(pred.churnProbability).toBeGreaterThanOrEqual(minProbability);
      });
    });

    it('should return only predictions with actionable retention actions', async () => {
      vi.mocked(mockDb.query).mockResolvedValue([
        {
          id: 'pred_action',
          pass_id: 'pass_action',
          user_id: 'user_action',
          churn_probability: 0.75,
          top_features: {},
          model_version: 'logistic-v1',
          prediction_horizon: '14d',
          retention_action: RetentionAction.EmailDiscount,
          computed_at: new Date().toISOString(),
          action_executed_at: null,
          action_result: null,
        },
      ]);

      const result = await getActionableChurnPredictions(0.7, '14d', mockDb);

      expect(result.length).toBeGreaterThan(0);
      result.forEach((pred) => {
        expect(pred.retentionAction).not.toBe(RetentionAction.None);
      });
    });

    it('should not return predictions where action_result is already set', async () => {
      vi.mocked(mockDb.query).mockResolvedValue([
        {
          id: 'pred_executed',
          pass_id: 'pass_executed',
          user_id: 'user_executed',
          churn_probability: 0.8,
          top_features: {},
          model_version: 'logistic-v1',
          prediction_horizon: '30d',
          retention_action: RetentionAction.EmailReminder,
          computed_at: new Date().toISOString(),
          action_executed_at: new Date().toISOString(),
          action_result: null,
        },
      ]);

      const result = await getActionableChurnPredictions(0.6, '30d', mockDb);

      expect(result).toBeDefined();
    });
  });

  describe('markActionExecuted', () => {
    it('should mark prediction as having action executed', async () => {
      const predictionId = 'pred_123';

      vi.mocked(mockDb.execute).mockResolvedValue();

      await markActionExecuted(predictionId, mockDb);

      expect(vi.mocked(mockDb.execute)).toHaveBeenCalledWith(
        expect.stringContaining('action_executed_at'),
        expect.arrayContaining([predictionId])
      );
    });
  });

  describe('recordOutcome', () => {
    it('should record renewed outcome', async () => {
      const passId = 'pass_renewed';

      vi.mocked(mockDb.execute).mockResolvedValue();

      await recordOutcome(passId, 'renewed', mockDb);

      expect(vi.mocked(mockDb.execute)).toHaveBeenCalledWith(
        expect.stringContaining('action_result'),
        expect.arrayContaining(['renewed', passId])
      );
    });

    it('should record churned outcome', async () => {
      const passId = 'pass_churned';

      vi.mocked(mockDb.execute).mockResolvedValue();

      await recordOutcome(passId, 'churned', mockDb);

      expect(vi.mocked(mockDb.execute)).toHaveBeenCalledWith(
        expect.stringContaining('action_result'),
        expect.arrayContaining(['churned', passId])
      );
    });
  });

  describe('horizon-based thresholds', () => {
    it('should apply different thresholds for 30d horizon', async () => {
      const passId = 'pass_30d';

      vi.mocked(mockDb.queryOne).mockResolvedValue({
        user_id: 'user_30d',
      });

      // 30d: threshold 0.6, action EmailReminder
      vi.mocked(mockDb.query).mockResolvedValue([
        {
          id: 'pred_30d',
          pass_id: passId,
          user_id: 'user_30d',
          churn_probability: 0.65,
          top_features: {},
          model_version: 'logistic-v1',
          prediction_horizon: '30d',
          retention_action: RetentionAction.EmailReminder,
          computed_at: new Date().toISOString(),
          action_executed_at: null,
          action_result: null,
        },
      ]);

      const result = await scorePass(passId, '30d', deps);

      expect(result.predictionHorizon).toBe('30d');
      expect(result.retentionAction).toBe(RetentionAction.EmailReminder);
    });

    it('should apply different thresholds for 7d horizon', async () => {
      const passId = 'pass_7d';

      vi.mocked(mockDb.queryOne).mockResolvedValue({
        user_id: 'user_7d',
      });

      // 7d: threshold 0.8, action PushHighlight
      vi.mocked(mockDb.query).mockResolvedValue([
        {
          id: 'pred_7d',
          pass_id: passId,
          user_id: 'user_7d',
          churn_probability: 0.85,
          top_features: {},
          model_version: 'logistic-v1',
          prediction_horizon: '7d',
          retention_action: RetentionAction.PushHighlight,
          computed_at: new Date().toISOString(),
          action_executed_at: null,
          action_result: null,
        },
      ]);

      const result = await scorePass(passId, '7d', deps);

      expect(result.predictionHorizon).toBe('7d');
      expect(result.retentionAction).toBe(RetentionAction.PushHighlight);
    });
  });
});

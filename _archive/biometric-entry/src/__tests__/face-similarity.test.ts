import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  validateTemplate,
  TEMPLATE_DIMENSIONS,
  MIN_CONFIDENCE_DEFAULT,
} from '../lib/face-similarity.js';

describe('cosineSimilarity', () => {
  it('identical vectors return 1', () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it('opposite vectors return 0', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
  });

  it('orthogonal vectors return 0.5', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 10);
  });

  it('zero vector returns 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('throws on length mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(
      /length mismatch/,
    );
  });

  it('throws on empty vectors', () => {
    expect(() => cosineSimilarity([], [])).toThrow(/empty vectors/);
  });

  it('result is always clamped to [0, 1]', () => {
    // Numerical noise could nudge values slightly outside the expected range.
    const a = Array(512).fill(1);
    const b = Array(512).fill(1);
    const s = cosineSimilarity(a, b);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeCloseTo(1, 8);
  });

  it('near-identical vectors produce high similarity > 0.95', () => {
    const a = [0.1, 0.2, 0.3, 0.4, 0.5];
    const b = [0.1, 0.21, 0.3, 0.39, 0.5];
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.95);
  });
});

describe('validateTemplate', () => {
  it('accepts correct arcface_v2 dimension (512)', () => {
    const t = Array(512).fill(0.1);
    expect(validateTemplate(t, 'arcface_v2')).toBe(true);
  });

  it('accepts correct facenet_v1 dimension (128)', () => {
    const t = Array(128).fill(0.2);
    expect(validateTemplate(t, 'facenet_v1')).toBe(true);
  });

  it('rejects wrong dimension', () => {
    const t = Array(256).fill(0.1);
    expect(validateTemplate(t, 'arcface_v2')).toBe(false);
  });

  it('rejects unknown algorithm', () => {
    const t = Array(512).fill(0.1);
    expect(validateTemplate(t, 'unknown_algo')).toBe(false);
  });

  it('rejects non-finite values (NaN / Infinity)', () => {
    const t = Array(512).fill(0.1);
    t[5] = NaN;
    expect(validateTemplate(t, 'arcface_v2')).toBe(false);
    t[5] = Infinity;
    expect(validateTemplate(t, 'arcface_v2')).toBe(false);
  });

  it('rejects non-array input', () => {
    expect(validateTemplate('not an array' as unknown as number[], 'arcface_v2')).toBe(
      false,
    );
  });

  it('exports expected dimension map and default threshold', () => {
    expect(TEMPLATE_DIMENSIONS.arcface_v2).toBe(512);
    expect(TEMPLATE_DIMENSIONS.facenet_v1).toBe(128);
    expect(MIN_CONFIDENCE_DEFAULT).toBe(0.85);
  });
});

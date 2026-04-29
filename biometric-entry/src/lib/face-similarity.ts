/**
 * Pure functions for comparing face template embeddings.
 *
 * The algorithm-agnostic contract: every supported algorithm produces a
 * fixed-length float vector; matching is reduced to cosine similarity
 * between two such vectors.
 */

export const MIN_CONFIDENCE_DEFAULT = 0.85;

export const TEMPLATE_DIMENSIONS: Record<string, number> = {
  arcface_v2: 512,
  facenet_v1: 128,
};

/**
 * Cosine similarity remapped to [0, 1] so downstream thresholds are
 * intuitive (1 = identical, 0 = diametrically opposite, 0.5 = orthogonal).
 *
 * Pure function — no adapters, no I/O — trivially unit-testable.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`,
    );
  }
  if (a.length === 0) {
    throw new Error('cosineSimilarity: empty vectors');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    // Zero vector — undefined direction — treat as no match.
    return 0;
  }

  const raw = dot / (Math.sqrt(normA) * Math.sqrt(normB)); // in [-1, 1]
  // Remap to [0, 1]: identical=1, orthogonal=0.5, opposite=0
  const remapped = (raw + 1) / 2;
  // Clamp for floating-point safety.
  return Math.max(0, Math.min(1, remapped));
}

/**
 * Validates that `template` is a finite float vector with the dimension
 * expected by `algorithm`. Unknown algorithms return `false`.
 */
export function validateTemplate(template: number[], algorithm: string): boolean {
  const expected = TEMPLATE_DIMENSIONS[algorithm];
  if (expected === undefined) {
    return false;
  }
  if (!Array.isArray(template) || template.length !== expected) {
    return false;
  }
  for (const v of template) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return false;
    }
  }
  return true;
}

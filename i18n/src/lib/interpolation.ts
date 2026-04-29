import type { InterpolationParams } from './types.js';

/**
 * Replaces {{key}} placeholders in text with values from params.
 * If params is undefined or empty, returns text unchanged.
 * If a key exists in params, it is substituted.
 * If a key is missing from params, it throws an error (strict mode).
 *
 * Example: interpolate('Hello {{name}}!', { name: 'Jan' }) → 'Hello Jan!'
 */
export function interpolate(text: string, params?: InterpolationParams): string {
  if (!params || Object.keys(params).length === 0) {
    return text;
  }
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in params) {
      return String(params[key]);
    }
    throw new Error(`Missing interpolation param: "${key}"`);
  });
}

/**
 * Safe interpolation — if a key is missing in params, leaves {{key}} unchanged.
 * Example: safeInterpolate('Hello {{name}}, you are {{age}}!', { name: 'Jan' })
 *          → 'Hello Jan, you are {{age}}!'
 */
export function safeInterpolate(text: string, params?: InterpolationParams): string {
  if (!params || Object.keys(params).length === 0) {
    return text;
  }
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in params) {
      return String(params[key]);
    }
    return match;
  });
}

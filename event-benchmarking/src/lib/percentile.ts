/**
 * Calculate the p-th percentile of a sorted or unsorted array of numbers.
 * Uses linear interpolation (same as Excel PERCENTILE).
 * @param values - array of numbers (may be unsorted)
 * @param p - percentile in range [0, 100]
 * @returns the percentile value, or 0 for an empty array
 */
export function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  if (values.length === 1) return values[0] ?? 0

  const sorted = [...values].sort((a, b) => a - b)
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const fraction = index - lower

  const lowerVal = sorted[lower] ?? 0
  const upperVal = sorted[upper] ?? 0

  return lowerVal + fraction * (upperVal - lowerVal)
}

/**
 * Return what percentage of values are strictly below the target (0-100).
 * This is the percentile rank of the target within the distribution.
 * @param values - array of peer values
 * @param target - the target event's value
 * @returns percentage of peers with a lower value than target (0-100)
 */
export function getPercentileRank(values: number[], target: number): number {
  if (values.length === 0) return 0
  const below = values.filter((v) => v < target).length
  return (below / values.length) * 100
}

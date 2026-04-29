/**
 * Pure calculation functions for post-event reports
 */

/**
 * Calculate sell-through percentage (sold / capacity * 100)
 * Capped at 100% (overselling not counted)
 */
export function calculateSellthroughPct(sold: number, capacity: number): number {
  if (capacity === 0) return 0;
  const pct = (sold / capacity) * 100;
  return Math.min(100, Math.round(pct * 100) / 100);
}

/**
 * Calculate no-show percentage
 */
export function calculateNoShowPct(checkedIn: number, sold: number): number {
  if (sold === 0) return 0;
  const noShow = sold - checkedIn;
  const pct = (noShow / sold) * 100;
  return Math.round(pct * 100) / 100;
}

/**
 * Calculate average ticket price in haléře
 * Returns 0 if count is 0
 */
export function calculateAvgPrice(totalRevenue: number, count: number): number {
  if (count === 0) return 0;
  return Math.round(totalRevenue / count);
}

/**
 * Find peak entry time by analyzing scan timestamps
 * Divides time into 15-minute windows and returns the window with most entries
 * Returns null if array is empty
 * Format: "19:45" (HH:MM)
 */
export function findPeakEntryTime(scanTimestamps: Date[]): string | null {
  if (scanTimestamps.length === 0) return null;

  // Create 15-minute windows (0-14, 15-29, 30-44, 45-59 minutes)
  const windows = new Map<string, number>();

  for (const timestamp of scanTimestamps) {
    const hours = timestamp.getHours();
    const minutes = timestamp.getMinutes();
    const windowStart = Math.floor(minutes / 15) * 15;
    const timeKey = `${String(hours).padStart(2, '0')}:${String(windowStart).padStart(2, '0')}`;
    windows.set(timeKey, (windows.get(timeKey) || 0) + 1);
  }

  let peakTime = null;
  let maxCount = 0;

  for (const [timeKey, count] of windows) {
    if (count > maxCount) {
      maxCount = count;
      peakTime = timeKey;
    }
  }

  return peakTime;
}

/**
 * Calculate average entry time (median of scan timestamps)
 * Returns null if array is empty
 * Format: "19:45" (HH:MM)
 */
export function findAvgEntryTime(scanTimestamps: Date[]): string | null {
  if (scanTimestamps.length === 0) return null;

  const sorted = [...scanTimestamps].sort((a, b) => a.getTime() - b.getTime());
  const medianIndex = Math.floor(sorted.length / 2);
  const medianTime = sorted[medianIndex];

  const hours = medianTime.getHours();
  const minutes = medianTime.getMinutes();

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Build sales by day from orders
 * Groups orders by ISO date and sums tickets and revenue
 */
export function buildSalesByDay(
  orders: Array<{ created_at: Date; amount: number; quantity: number }>
): Array<{ date: string; tickets: number; revenue: number }> {
  const byDay = new Map<string, { tickets: number; revenue: number }>();

  for (const order of orders) {
    const isoDate = order.created_at.toISOString().split('T')[0];
    const existing = byDay.get(isoDate) || { tickets: 0, revenue: 0 };
    byDay.set(isoDate, {
      tickets: existing.tickets + order.quantity,
      revenue: existing.revenue + order.amount,
    });
  }

  return Array.from(byDay.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Format currency (haléře) to Czech format: "1 234,50 Kč"
 */
export function formatCurrency(halers: number): string {
  const koruna = halers / 100;
  return (
    new Intl.NumberFormat('cs-CZ', {
      style: 'currency',
      currency: 'CZK',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(koruna) ?? '0,00 Kč'
  );
}

/**
 * Format percentage: "73 %"
 */
export function formatPct(pct: number): string {
  return `${Math.round(pct)} %`;
}

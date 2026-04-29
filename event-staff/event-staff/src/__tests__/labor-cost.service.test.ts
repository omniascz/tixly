import { describe, it, expect, vi } from 'vitest';
import { getLaborCostReport } from '../services/labor-cost.service.js';

function makeDb() {
  return {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  };
}
const deps = (db: any) => ({ db });

describe('getLaborCostReport', () => {
  it('aggregates totals, by role, by staff, by event', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{
        total_hours: '120.5',
        total_payout: '3000000',   // 30000 Kč
        shifts_completed: 25,
        shifts_cancelled: 3,
      }])
      .mockResolvedValueOnce([
        { role: 'security', hours: '80.5', payout: '2000000' },
        { role: 'bar', hours: '40.0', payout: '1000000' },
      ])
      .mockResolvedValueOnce([
        { staff_id: 'st-1', first_name: 'Jan', last_name: 'Novák', hours: '60.0', payout: '1500000', shift_count: 12 },
      ])
      .mockResolvedValueOnce([
        { event_id: 'e-1', payout: '2500000', shift_count: 20 },
      ]);

    const r = await getLaborCostReport('p-1', '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', deps(db));

    expect(r.totalHoursWorked).toBe(120.5);
    expect(r.totalPayoutHalire).toBe(3000000);
    expect(r.shiftsCompleted).toBe(25);
    expect(r.shiftsCancelled).toBe(3);
    // avg = 3000000 / 120.5 ≈ 24896
    expect(r.avgHourlyRateHalire).toBe(24896);
    expect(r.byRole).toHaveLength(2);
    expect(r.byRole[0].role).toBe('security');
    expect(r.byStaff).toHaveLength(1);
    expect(r.byStaff[0].staffName).toBe('Jan Novák');
    expect(r.byEvent).toHaveLength(1);
  });

  it('handles zero totals gracefully', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ total_hours: '0', total_payout: '0', shifts_completed: 0, shifts_cancelled: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const r = await getLaborCostReport('p-1', '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', deps(db));
    expect(r.totalHoursWorked).toBe(0);
    expect(r.avgHourlyRateHalire).toBe(0);
    expect(r.byRole).toEqual([]);
  });

  it('rounds hours to 2 decimal places', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ total_hours: '123.456789', total_payout: '100000', shifts_completed: 1, shifts_cancelled: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const r = await getLaborCostReport('p-1', '2026-06-01', '2026-07-01', deps(db));
    expect(r.totalHoursWorked).toBe(123.46);
  });
});

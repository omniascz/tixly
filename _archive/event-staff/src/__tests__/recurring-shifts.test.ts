import { describe, it, expect, vi } from 'vitest';
import {
  createRecurringTemplate,
  listRecurringTemplates,
  deactivateTemplate,
  materializeShifts,
} from '../services/recurring-shifts.service.js';
import { StaffError } from '../lib/staff-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';

interface MockState {
  templates: Map<string, any>;
  shifts: Map<string, any>;
}

function makeDeps(): { deps: ServiceDeps; state: MockState } {
  const state: MockState = { templates: new Map(), shifts: new Map() };
  const db = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('FROM platform.staff_members')) {
        return [{ id: params?.[0], hourly_rate_halire: null }];
      }
      if (sql.startsWith('INSERT INTO platform.recurring_shift_templates')) {
        const id = `tpl${state.templates.size + 1}`;
        const row = {
          id,
          promoter_id: params![0],
          branch_id: params![1],
          staff_id: params![2],
          role: params![3],
          zone: params![4],
          day_of_week: params![5],
          start_time_local: params![6],
          end_time_local: params![7],
          effective_from: new Date(`${params![8]}T00:00:00Z`),
          effective_until: params![9] ? new Date(`${params![9]}T00:00:00Z`) : null,
          is_active: true,
          created_at: new Date(),
        };
        state.templates.set(id, row);
        return [row];
      }
      if (sql.includes('SELECT * FROM platform.recurring_shift_templates') && sql.includes('promoter_id = $1 AND is_active')) {
        const out = [];
        for (const t of state.templates.values()) {
          if (t.promoter_id === params![0] && t.is_active) out.push(t);
        }
        return out;
      }
      if (sql.includes('SELECT * FROM platform.recurring_shift_templates') && sql.includes('effective_from <=')) {
        const out = [];
        for (const t of state.templates.values()) {
          if (t.promoter_id === params![0] && t.is_active) out.push(t);
        }
        return out;
      }
      if (sql.startsWith('UPDATE platform.recurring_shift_templates')) {
        const t = state.templates.get(params![0]);
        if (t && t.promoter_id === params![1]) {
          t.is_active = false;
          return [{ id: t.id }];
        }
        return [];
      }
      if (sql.includes('SELECT id FROM platform.staff_shifts')) {
        for (const [id, s] of state.shifts) {
          if (s.staff_id === params![0] && s.starts_at === params![1]) {
            return [{ id }];
          }
        }
        return [];
      }
      return [];
    }),
    execute: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.startsWith('INSERT INTO platform.staff_shifts')) {
        const id = `sh${state.shifts.size + 1}`;
        state.shifts.set(id, {
          promoter_id: params![0],
          event_id: params![1],
          staff_id: params![2],
          role: params![3],
          zone: params![4],
          starts_at: params![5],
          ends_at: params![6],
        });
      }
    }),
    transaction: vi.fn(async (fn: any) => fn({ query: db.query, execute: db.execute })),
  };
  return { deps: { db } as unknown as ServiceDeps, state };
}

describe('recurring shift templates', () => {
  it('create + list + deactivate', async () => {
    const { deps } = makeDeps();
    const tpl = await createRecurringTemplate(
      'p1',
      {
        branchId: 'b1',
        staffId: 's1',
        role: 'usher',
        dayOfWeek: 'mon',
        startTimeLocal: '09:00',
        endTimeLocal: '17:00',
        effectiveFrom: '2026-04-01',
      },
      deps,
    );
    expect(tpl.isActive).toBe(true);
    expect(tpl.dayOfWeek).toBe('mon');

    const list = await listRecurringTemplates('p1', null, deps);
    expect(list).toHaveLength(1);

    await deactivateTemplate(tpl.id, 'p1', deps);
    const after = await listRecurringTemplates('p1', null, deps);
    expect(after).toHaveLength(0);
  });

  it('rejects invalid time format', async () => {
    const { deps } = makeDeps();
    await expect(
      createRecurringTemplate(
        'p1',
        {
          branchId: 'b1',
          staffId: 's1',
          role: 'usher',
          dayOfWeek: 'mon',
          startTimeLocal: '25:00',
          endTimeLocal: '17:00',
          effectiveFrom: '2026-04-01',
        },
        deps,
      ),
    ).rejects.toThrow(StaffError);
  });

  it('rejects start >= end', async () => {
    const { deps } = makeDeps();
    await expect(
      createRecurringTemplate(
        'p1',
        {
          branchId: 'b1',
          staffId: 's1',
          role: 'usher',
          dayOfWeek: 'mon',
          startTimeLocal: '18:00',
          endTimeLocal: '17:00',
          effectiveFrom: '2026-04-01',
        },
        deps,
      ),
    ).rejects.toThrow();
  });

  it('materialize creates one shift per matching day in the week', async () => {
    const { deps, state } = makeDeps();
    // Mon 09:00-17:00
    await createRecurringTemplate(
      'p1',
      {
        branchId: 'b1',
        staffId: 's1',
        role: 'usher',
        dayOfWeek: 'mon',
        startTimeLocal: '09:00',
        endTimeLocal: '17:00',
        effectiveFrom: '2026-04-01',
      },
      deps,
    );
    // 2026-04-06 is a Monday. Range covers two Mondays.
    const result = await materializeShifts(
      'p1',
      new Date('2026-04-06T00:00:00Z'),
      new Date('2026-04-19T00:00:00Z'),
      deps,
    );
    expect(result.created).toBe(2);
    expect(state.shifts.size).toBe(2);
  });

  it('materialize is idempotent', async () => {
    const { deps } = makeDeps();
    await createRecurringTemplate(
      'p1',
      {
        branchId: 'b1',
        staffId: 's1',
        role: 'usher',
        dayOfWeek: 'mon',
        startTimeLocal: '09:00',
        endTimeLocal: '17:00',
        effectiveFrom: '2026-04-01',
      },
      deps,
    );
    const from = new Date('2026-04-06T00:00:00Z');
    const to = new Date('2026-04-19T00:00:00Z');
    const first = await materializeShifts('p1', from, to, deps);
    const second = await materializeShifts('p1', from, to, deps);
    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);
  });
});

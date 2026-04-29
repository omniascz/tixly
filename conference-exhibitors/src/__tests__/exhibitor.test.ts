// =============================================================================
// Conference Exhibitor Management — comprehensive test suite (34 tests)
// Uses makeDb() mock pattern: query() increments index, execute() does NOT
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  createFloorMap,
  getFloorMap,
  updateFloorMap,
  listFloorMaps,
  getFloorMapWithBooths,
} from '../services/floor-map.service';

import {
  createBooth,
  getBooth,
  updateBooth,
  listBooths,
  assignBooth,
  unassignBooth,
  createCategory,
} from '../services/booth.service';

import {
  createExhibitor,
  getExhibitor,
  listExhibitors,
  approveExhibitor,
  rejectExhibitor,
  linkSessionToExhibitor,
  getExhibitorSessions,
} from '../services/exhibitor.service';

import {
  addStaff,
  listStaff,
  updateStaff,
  removeStaff,
  markBadgePrinted,
  verifyStaffAccess,
} from '../services/staff.service';

import { ExhibitorError } from '../lib/exhibitor-errors';

// ---------------------------------------------------------------------------
// makeDb helper — query() increments index, execute() does NOT
// ---------------------------------------------------------------------------

function makeDb(responses: unknown[][] = []) {
  let i = 0;
  return {
    query: vi.fn(async <T>(): Promise<T[]> => (responses[i++] ?? []) as T[]),
    execute: vi.fn(async (): Promise<void> => {}),
  };
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FLOOR_MAP_ROW = {
  id: 'map-1',
  conference_id: 'conf-1',
  name: 'Hall A',
  svg_content: '<svg><rect/></svg>',
  width_px: 1200,
  height_px: 900,
  booth_count: '3',
  created_at: '2026-04-07T10:00:00Z',
  updated_at: '2026-04-07T10:00:00Z',
};

const BOOTH_ROW = {
  id: 'booth-1',
  conference_id: 'conf-1',
  floor_map_id: 'map-1',
  category_id: 'cat-1',
  category_name: 'Premium',
  category_color: '#ff0000',
  booth_number: 'A1',
  x_px: 100,
  y_px: 200,
  width_px: 150,
  height_px: 120,
  status: 'available',
  price_hellers: 500000,
  notes: null,
  created_at: '2026-04-07T10:00:00Z',
  exhibitor_id: null,
  company_name: null,
  assigned_at: null,
  confirmed_at: null,
  setup_start: null,
  teardown_end: null,
  assignment_notes: null,
};

const BOOTH_ROW_ASSIGNED = {
  ...BOOTH_ROW,
  status: 'confirmed',
  exhibitor_id: 'exh-1',
  company_name: 'TechCorp',
  assigned_at: '2026-04-07T11:00:00Z',
  confirmed_at: null,
  setup_start: null,
  teardown_end: null,
  assignment_notes: null,
};

const CATEGORY_ROW = {
  id: 'cat-1',
  conference_id: 'conf-1',
  name: 'Premium',
  color: '#ff0000',
  description: 'Premium booths near entrance',
  sort_order: 1,
  created_at: '2026-04-07T10:00:00Z',
};

const EXHIBITOR_ROW = {
  id: 'exh-1',
  conference_id: 'conf-1',
  company_name: 'TechCorp',
  description: 'Leading tech company',
  logo_url: 'https://example.com/logo.png',
  website_url: 'https://techcorp.example',
  contact_email: 'info@techcorp.example',
  contact_phone: '+420123456789',
  tier: 'gold',
  status: 'pending',
  promoter_id: null,
  staff_count: '0',
  booth_id: null,
  booth_number: null,
  created_at: '2026-04-07T10:00:00Z',
};

const EXHIBITOR_ROW_APPROVED = { ...EXHIBITOR_ROW, status: 'approved' };
const EXHIBITOR_ROW_REJECTED = { ...EXHIBITOR_ROW, status: 'rejected' };

const SESSION_ROW = {
  exhibitor_id: 'exh-1',
  session_id: 'sess-1',
  is_sponsored: true,
  title: 'TechCorp Keynote',
  starts_at: '2026-04-07T14:00:00Z',
  ends_at: '2026-04-07T15:00:00Z',
};

const STAFF_ROW = {
  id: 'staff-1',
  exhibitor_id: 'exh-1',
  full_name: 'Jan Novák',
  email: 'jan@techcorp.example',
  phone: '+420987654321',
  role: 'manager',
  badge_printed: false,
  access_token: 'token-uuid-1234',
  created_at: '2026-04-07T10:00:00Z',
};

const STAFF_WITH_EXHIBITOR_ROW = {
  ...STAFF_ROW,
  company_name: 'TechCorp',
  conference_id: 'conf-1',
};

// ---------------------------------------------------------------------------
// 1. createFloorMap — valid
// ---------------------------------------------------------------------------

describe('createFloorMap', () => {
  it('1. valid input inserts and returns floor map', async () => {
    const db = makeDb([[FLOOR_MAP_ROW]]);
    const result = await createFloorMap('conf-1', { name: 'Hall A', svgContent: '<svg/>' }, db);
    expect(result.id).toBe('map-1');
    expect(result.name).toBe('Hall A');
    expect(result.conferenceId).toBe('conf-1');
    expect(result.widthPx).toBe(1200);
    expect(result.boothCount).toBe(3);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('2. duplicate name throws FLOOR_MAP_DUPLICATE', async () => {
    const pgError = { code: '23505', constraint: 'floor_maps_conference_id_name_key' };
    const db = {
      query: vi.fn(async () => { throw pgError; }),
      execute: vi.fn(async () => {}),
    };
    await expect(createFloorMap('conf-1', { name: 'Hall A' }, db))
      .rejects.toBeInstanceOf(ExhibitorError);
    try {
      await createFloorMap('conf-1', { name: 'Hall A' }, db);
    } catch (e) {
      expect((e as ExhibitorError).code).toBe('FLOOR_MAP_DUPLICATE');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. getFloorMap — found / not found
// ---------------------------------------------------------------------------

describe('getFloorMap', () => {
  it('3a. found — returns mapped floor map with booth count', async () => {
    const db = makeDb([[FLOOR_MAP_ROW]]);
    const result = await getFloorMap('map-1', db);
    expect(result.id).toBe('map-1');
    expect(result.boothCount).toBe(3);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('3b. not found — throws FLOOR_MAP_NOT_FOUND', async () => {
    const db = makeDb([[]]); // empty
    await expect(getFloorMap('map-missing', db))
      .rejects.toMatchObject({ code: 'FLOOR_MAP_NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// 4. updateFloorMap — updates svg_content
// ---------------------------------------------------------------------------

describe('updateFloorMap', () => {
  it('4. updates svg_content and returns updated map', async () => {
    const updated = { ...FLOOR_MAP_ROW, svg_content: '<svg><circle/></svg>' };
    const db = makeDb([[updated]]);
    const result = await updateFloorMap('map-1', { svgContent: '<svg><circle/></svg>' }, db);
    expect(result.svgContent).toBe('<svg><circle/></svg>');
    expect(result.id).toBe('map-1');
  });
});

// ---------------------------------------------------------------------------
// 5. getFloorMapWithBooths — returns booths array
// ---------------------------------------------------------------------------

describe('getFloorMapWithBooths', () => {
  it('5. returns floor map with booths array', async () => {
    const boothOnMap = {
      id: 'booth-1',
      booth_number: 'A1',
      x_px: 100,
      y_px: 200,
      width_px: 150,
      height_px: 120,
      status: 'available',
      price_hellers: 500000,
      category_id: 'cat-1',
      exhibitor_id: null,
      company_name: null,
    };
    const db = makeDb([[FLOOR_MAP_ROW], [boothOnMap]]);
    const result = await getFloorMapWithBooths('map-1', db);
    expect(result.id).toBe('map-1');
    expect(result.booths).toHaveLength(1);
    expect(result.booths[0].boothNumber).toBe('A1');
    expect(result.booths[0].status).toBe('available');
  });
});

// ---------------------------------------------------------------------------
// 6–7. createBooth
// ---------------------------------------------------------------------------

describe('createBooth', () => {
  it('6. valid input inserts and returns booth', async () => {
    const db = makeDb([[BOOTH_ROW]]);
    const result = await createBooth('conf-1', {
      floorMapId: 'map-1',
      boothNumber: 'A1',
      priceHellers: 500000,
    }, db);
    expect(result.id).toBe('booth-1');
    expect(result.boothNumber).toBe('A1');
    expect(result.status).toBe('available');
    expect(result.priceHellers).toBe(500000);
    expect(result.assignment).toBeNull();
  });

  it('7. duplicate booth_number throws BOOTH_NOT_FOUND (unique violation)', async () => {
    const pgError = { code: '23505', constraint: 'booths_conference_id_booth_number_key' };
    const db = {
      query: vi.fn(async () => { throw pgError; }),
      execute: vi.fn(async () => {}),
    };
    await expect(createBooth('conf-1', { floorMapId: 'map-1', boothNumber: 'A1' }, db))
      .rejects.toBeInstanceOf(ExhibitorError);
  });
});

// ---------------------------------------------------------------------------
// 8. getBooth — with category and assignment
// ---------------------------------------------------------------------------

describe('getBooth', () => {
  it('8. returns booth with category and assignment info', async () => {
    const db = makeDb([[BOOTH_ROW_ASSIGNED]]);
    const result = await getBooth('booth-1', db);
    expect(result.id).toBe('booth-1');
    expect(result.categoryName).toBe('Premium');
    expect(result.categoryColor).toBe('#ff0000');
    expect(result.assignment).not.toBeNull();
    expect(result.assignment!.exhibitorId).toBe('exh-1');
    expect(result.assignment!.exhibitorName).toBe('TechCorp');
  });
});

// ---------------------------------------------------------------------------
// 9. updateBooth — partial status change
// ---------------------------------------------------------------------------

describe('updateBooth', () => {
  it('9. partial update changes status', async () => {
    const updated = { ...BOOTH_ROW, status: 'reserved' };
    const db = makeDb([[updated]]);
    const result = await updateBooth('booth-1', { status: 'reserved' }, db);
    expect(result.status).toBe('reserved');
  });
});

// ---------------------------------------------------------------------------
// 10–11. listBooths — filters
// ---------------------------------------------------------------------------

describe('listBooths', () => {
  it('10. filter by status=available returns matching booths', async () => {
    const db = makeDb([[BOOTH_ROW, { ...BOOTH_ROW, id: 'booth-2', booth_number: 'A2' }]]);
    const result = await listBooths('conf-1', { status: 'available' }, db);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('available');
  });

  it('11. filter by category_id returns matching booths', async () => {
    const db = makeDb([[BOOTH_ROW]]);
    const result = await listBooths('conf-1', { categoryId: 'cat-1' }, db);
    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe('cat-1');
  });
});

// ---------------------------------------------------------------------------
// 12–14. assignBooth
// ---------------------------------------------------------------------------

describe('assignBooth', () => {
  it('12. valid assignment sets status to confirmed', async () => {
    // query[0]: check booth status → available
    // execute[0]: INSERT booth_assignments (does not increment)
    // execute[1]: UPDATE status=confirmed (does not increment)
    // query[1]: getBooth → returns confirmed booth
    const db = makeDb([
      [{ id: 'booth-1', status: 'available' }],
      [BOOTH_ROW_ASSIGNED],
    ]);
    const result = await assignBooth('booth-1', 'exh-1', {}, db);
    expect(result.status).toBe('confirmed');
    expect(result.assignment).not.toBeNull();
    expect(result.assignment!.exhibitorId).toBe('exh-1');
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('13. booth not available throws BOOTH_NOT_AVAILABLE', async () => {
    const db = makeDb([
      [{ id: 'booth-1', status: 'blocked' }],
    ]);
    await expect(assignBooth('booth-1', 'exh-1', {}, db))
      .rejects.toMatchObject({ code: 'BOOTH_NOT_AVAILABLE' });
  });

  it('14. already assigned (unique violation) throws BOOTH_ALREADY_ASSIGNED', async () => {
    const pgError = { code: '23505', constraint: 'booth_assignments_booth_id_key' };
    const db = {
      query: vi.fn(async <T>(sql: string): Promise<T[]> => {
        // First call: check booth status
        return [{ id: 'booth-1', status: 'available' }] as T[];
      }),
      execute: vi.fn(async () => { throw pgError; }),
    };
    await expect(assignBooth('booth-1', 'exh-1', {}, db))
      .rejects.toMatchObject({ code: 'BOOTH_ALREADY_ASSIGNED' });
  });
});

// ---------------------------------------------------------------------------
// 15. unassignBooth — resets status to available
// ---------------------------------------------------------------------------

describe('unassignBooth', () => {
  it('15. unassign calls DELETE and UPDATE, resets booth to available', async () => {
    const db = makeDb([]);
    await unassignBooth('booth-1', db);
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('DELETE'),
      ['booth-1'],
    );
    expect(db.execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'available'"),
      ['booth-1'],
    );
  });
});

// ---------------------------------------------------------------------------
// 16. createCategory — valid
// ---------------------------------------------------------------------------

describe('createCategory', () => {
  it('16. valid input inserts and returns category', async () => {
    const db = makeDb([[CATEGORY_ROW]]);
    const result = await createCategory('conf-1', {
      name: 'Premium',
      color: '#ff0000',
      description: 'Premium booths near entrance',
      sortOrder: 1,
    }, db);
    expect(result.id).toBe('cat-1');
    expect(result.name).toBe('Premium');
    expect(result.color).toBe('#ff0000');
    expect(result.sortOrder).toBe(1);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 17–18. createExhibitor
// ---------------------------------------------------------------------------

describe('createExhibitor', () => {
  it('17. valid input inserts and returns exhibitor', async () => {
    const db = makeDb([[EXHIBITOR_ROW]]);
    const result = await createExhibitor('conf-1', {
      companyName: 'TechCorp',
      tier: 'gold',
      contactEmail: 'info@techcorp.example',
    }, db);
    expect(result.id).toBe('exh-1');
    expect(result.companyName).toBe('TechCorp');
    expect(result.tier).toBe('gold');
    expect(result.status).toBe('pending');
    expect(result.staffCount).toBe(0);
  });

  it('18. duplicate company_name throws EXHIBITOR_DUPLICATE', async () => {
    const pgError = { code: '23505', constraint: 'exhibitors_conference_id_company_name_key' };
    const db = {
      query: vi.fn(async () => { throw pgError; }),
      execute: vi.fn(async () => {}),
    };
    await expect(createExhibitor('conf-1', { companyName: 'TechCorp' }, db))
      .rejects.toMatchObject({ code: 'EXHIBITOR_DUPLICATE' });
  });
});

// ---------------------------------------------------------------------------
// 19. getExhibitor — with staff count
// ---------------------------------------------------------------------------

describe('getExhibitor', () => {
  it('19. returns exhibitor with staff count', async () => {
    const withStaff = { ...EXHIBITOR_ROW, staff_count: '5' };
    const db = makeDb([[withStaff]]);
    const result = await getExhibitor('exh-1', db);
    expect(result.id).toBe('exh-1');
    expect(result.staffCount).toBe(5);
    expect(result.companyName).toBe('TechCorp');
  });
});

// ---------------------------------------------------------------------------
// 20–21. listExhibitors — filters
// ---------------------------------------------------------------------------

describe('listExhibitors', () => {
  it('20. filter by status=pending returns matching exhibitors', async () => {
    const db = makeDb([[EXHIBITOR_ROW, { ...EXHIBITOR_ROW, id: 'exh-2', company_name: 'StartupX' }]]);
    const result = await listExhibitors('conf-1', { status: 'pending' }, db);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('pending');
  });

  it('21. filter by tier=gold returns matching exhibitors', async () => {
    const db = makeDb([[EXHIBITOR_ROW]]);
    const result = await listExhibitors('conf-1', { tier: 'gold' }, db);
    expect(result).toHaveLength(1);
    expect(result[0].tier).toBe('gold');
  });
});

// ---------------------------------------------------------------------------
// 22–23. approveExhibitor / rejectExhibitor
// ---------------------------------------------------------------------------

describe('approveExhibitor', () => {
  it('22. sets status=approved', async () => {
    const db = makeDb([[EXHIBITOR_ROW_APPROVED]]);
    const result = await approveExhibitor('exh-1', db);
    expect(result.status).toBe('approved');
  });
});

describe('rejectExhibitor', () => {
  it('23. sets status=rejected', async () => {
    const db = makeDb([[EXHIBITOR_ROW_REJECTED]]);
    const result = await rejectExhibitor('exh-1', db);
    expect(result.status).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// 24–25. linkSessionToExhibitor / getExhibitorSessions
// ---------------------------------------------------------------------------

describe('linkSessionToExhibitor', () => {
  it('24. inserts link between exhibitor and session', async () => {
    const db = makeDb([]);
    await linkSessionToExhibitor('exh-1', 'sess-1', true, db);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO conference.exhibitor_sessions'),
      ['exh-1', 'sess-1', true],
    );
  });
});

describe('getExhibitorSessions', () => {
  it('25. returns sessions for exhibitor', async () => {
    const db = makeDb([[SESSION_ROW]]);
    const result = await getExhibitorSessions('exh-1', db);
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe('sess-1');
    expect(result[0].isSponsored).toBe(true);
    expect(result[0].sessionTitle).toBe('TechCorp Keynote');
  });
});

// ---------------------------------------------------------------------------
// 26–27. addStaff
// ---------------------------------------------------------------------------

describe('addStaff', () => {
  it('26. valid input inserts and returns staff member', async () => {
    const db = makeDb([[STAFF_ROW]]);
    const result = await addStaff('exh-1', {
      fullName: 'Jan Novák',
      email: 'jan@techcorp.example',
      role: 'manager',
    }, db);
    expect(result.id).toBe('staff-1');
    expect(result.fullName).toBe('Jan Novák');
    expect(result.role).toBe('manager');
    expect(result.badgePrinted).toBe(false);
    expect(result.accessToken).toBe('token-uuid-1234');
  });

  it('27. duplicate email throws STAFF_DUPLICATE', async () => {
    const pgError = { code: '23505', constraint: 'exhibitor_staff_exhibitor_id_email_key' };
    const db = {
      query: vi.fn(async () => { throw pgError; }),
      execute: vi.fn(async () => {}),
    };
    await expect(addStaff('exh-1', { fullName: 'Jan', email: 'jan@techcorp.example' }, db))
      .rejects.toMatchObject({ code: 'STAFF_DUPLICATE' });
  });
});

// ---------------------------------------------------------------------------
// 28. listStaff — returns array
// ---------------------------------------------------------------------------

describe('listStaff', () => {
  it('28. returns array of staff for exhibitor', async () => {
    const staff2 = { ...STAFF_ROW, id: 'staff-2', full_name: 'Petra Dvořák', email: 'petra@techcorp.example', role: 'staff' };
    const db = makeDb([[STAFF_ROW, staff2]]);
    const result = await listStaff('exh-1', db);
    expect(result).toHaveLength(2);
    expect(result[0].fullName).toBe('Jan Novák');
    expect(result[1].role).toBe('staff');
  });
});

// ---------------------------------------------------------------------------
// 29. updateStaff — partial update
// ---------------------------------------------------------------------------

describe('updateStaff', () => {
  it('29. partial update changes role', async () => {
    const updated = { ...STAFF_ROW, role: 'presenter' };
    const db = makeDb([[updated]]);
    const result = await updateStaff('staff-1', { role: 'presenter' }, db);
    expect(result.role).toBe('presenter');
    expect(result.id).toBe('staff-1');
  });
});

// ---------------------------------------------------------------------------
// 30. removeStaff — deletes record
// ---------------------------------------------------------------------------

describe('removeStaff', () => {
  it('30. removes staff member (calls execute with DELETE)', async () => {
    const db = makeDb([]);
    await removeStaff('staff-1', db);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      ['staff-1'],
    );
  });
});

// ---------------------------------------------------------------------------
// 31. markBadgePrinted — sets badge_printed=true
// ---------------------------------------------------------------------------

describe('markBadgePrinted', () => {
  it('31. sets badge_printed to true', async () => {
    const printed = { ...STAFF_ROW, badge_printed: true };
    const db = makeDb([[printed]]);
    const result = await markBadgePrinted('staff-1', db);
    expect(result.badgePrinted).toBe(true);
    expect(result.id).toBe('staff-1');
  });
});

// ---------------------------------------------------------------------------
// 32–33. verifyStaffAccess
// ---------------------------------------------------------------------------

describe('verifyStaffAccess', () => {
  it('32. valid token returns staff with exhibitor info', async () => {
    const db = makeDb([[STAFF_WITH_EXHIBITOR_ROW]]);
    const result = await verifyStaffAccess('token-uuid-1234', db);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('staff-1');
    expect(result!.exhibitorName).toBe('TechCorp');
    expect(result!.conferenceId).toBe('conf-1');
    expect(result!.accessToken).toBe('token-uuid-1234');
  });

  it('33. invalid token returns null', async () => {
    const db = makeDb([[]]); // empty result
    const result = await verifyStaffAccess('invalid-token', db);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 34. Full flow: floor map → booth → category → exhibitor → assign → staff → verify
// ---------------------------------------------------------------------------

describe('Full flow: floor map → booth → category → exhibitor → assign → staff → verify', () => {
  it('34. end-to-end exhibitor management flow', async () => {
    // Step 1: Create floor map
    const mapDb = makeDb([[FLOOR_MAP_ROW]]);
    const floorMap = await createFloorMap('conf-1', { name: 'Hall A' }, mapDb);
    expect(floorMap.id).toBe('map-1');

    // Step 2: Create category
    const catDb = makeDb([[CATEGORY_ROW]]);
    const category = await createCategory('conf-1', {
      name: 'Premium',
      color: '#ff0000',
      sortOrder: 1,
    }, catDb);
    expect(category.id).toBe('cat-1');

    // Step 3: Create booth
    const boothDb = makeDb([[BOOTH_ROW]]);
    const booth = await createBooth('conf-1', {
      floorMapId: floorMap.id,
      boothNumber: 'A1',
      categoryId: category.id,
      priceHellers: 500000,
    }, boothDb);
    expect(booth.id).toBe('booth-1');
    expect(booth.status).toBe('available');

    // Step 4: Create exhibitor
    const exhDb = makeDb([[EXHIBITOR_ROW]]);
    const exhibitor = await createExhibitor('conf-1', {
      companyName: 'TechCorp',
      tier: 'gold',
    }, exhDb);
    expect(exhibitor.id).toBe('exh-1');
    expect(exhibitor.status).toBe('pending');

    // Step 5: Approve exhibitor
    const approveDb = makeDb([[EXHIBITOR_ROW_APPROVED]]);
    const approved = await approveExhibitor(exhibitor.id, approveDb);
    expect(approved.status).toBe('approved');

    // Step 6: Assign booth
    const assignDb = makeDb([
      [{ id: 'booth-1', status: 'available' }],
      [BOOTH_ROW_ASSIGNED],
    ]);
    const assigned = await assignBooth(booth.id, exhibitor.id, {}, assignDb);
    expect(assigned.status).toBe('confirmed');
    expect(assigned.assignment!.exhibitorId).toBe('exh-1');

    // Step 7: Add staff
    const staffDb = makeDb([[STAFF_ROW]]);
    const staff = await addStaff(exhibitor.id, {
      fullName: 'Jan Novák',
      email: 'jan@techcorp.example',
      role: 'manager',
    }, staffDb);
    expect(staff.id).toBe('staff-1');
    expect(staff.badgePrinted).toBe(false);

    // Step 8: Mark badge printed
    const badgeDb = makeDb([[{ ...STAFF_ROW, badge_printed: true }]]);
    const printed = await markBadgePrinted(staff.id, badgeDb);
    expect(printed.badgePrinted).toBe(true);

    // Step 9: Verify staff access token
    const verifyDb = makeDb([[STAFF_WITH_EXHIBITOR_ROW]]);
    const verified = await verifyStaffAccess(staff.accessToken, verifyDb);
    expect(verified).not.toBeNull();
    expect(verified!.exhibitorName).toBe('TechCorp');
    expect(verified!.conferenceId).toBe('conf-1');
    expect(verified!.fullName).toBe('Jan Novák');
  });
});

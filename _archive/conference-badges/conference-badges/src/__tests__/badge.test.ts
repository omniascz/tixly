// =============================================================================
// Conference Badges — comprehensive test suite (34 tests)
// Uses makeServiceDb() mock pattern: query() increments index, execute() does not
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  generateBadgeSvg,
  generateBadgePdf,
  generateBatchPdf,
  type BadgeData,
  type BadgeTemplate,
  type GeneratedBadge,
} from '../lib/badge-generator';

import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from '../services/badge-template.service';

import {
  createPrintJob,
  processPrintJob,
  getJob,
  listJobs,
  getBadgeForActivation,
  type BadgeGenerator,
} from '../services/badge-print.service';

import {
  setOverride,
  getOverride,
  deleteOverride,
} from '../services/badge-override.service';

import { BadgeError } from '../lib/badge-errors';

import { GET as getTemplateRoute, PATCH as patchTemplateRoute } from '../app/api/conferences/[conferenceId]/badge-templates/[templateId]/route';
import { GET as listTemplatesRoute, POST as createTemplateRoute } from '../app/api/conferences/[conferenceId]/badge-templates/route';
import { GET as getBadgeRoute, POST as setOverrideRoute } from '../app/api/activations/[activationId]/badge/route';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// makeServiceDb helper — query() increments index, execute() does NOT
// ---------------------------------------------------------------------------

function makeServiceDb(responses: unknown[][] = []) {
  let i = 0;
  return {
    query: vi.fn(async <T>(): Promise<T[]> => (responses[i++] ?? []) as T[]),
    execute: vi.fn(async (): Promise<void> => {}),
  };
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const TEMPLATE_ROW = {
  id: 'tpl-1',
  conference_id: 'conf-1',
  name: 'Standard Badge',
  width_mm: 85,
  height_mm: 54,
  background_color: '#ffffff',
  accent_color: '#6366f1',
  logo_url: null,
  show_photo: true,
  show_company: true,
  show_qr: true,
  show_role: true,
  font_size_name: 20,
  font_size_company: 14,
  created_at: '2026-04-07T10:00:00Z',
};

const JOB_ROW = {
  id: 'job-1',
  conference_id: 'conf-1',
  template_id: 'tpl-1',
  requested_by: 'user-admin',
  status: 'pending',
  total_count: 3,
  processed_count: 0,
  error_message: null,
  pdf_url: null,
  requested_at: '2026-04-07T10:00:00Z',
  completed_at: null,
};

const ACTIVATION_ROW = {
  id: 'act-1',
  pass_id: 'pass-1',
  user_id: 'user-1',
  order_id: 'order-1',
  activated_at: '2026-04-07T09:00:00Z',
  access_token: 'token-abc-123',
  display_name: null,
  display_company: null,
  display_role: null,
  badge_color: null,
  user_name: null,
};

const OVERRIDE_ROW = {
  id: 'ovr-1',
  activation_id: 'act-1',
  display_name: 'Jane Doe',
  display_company: 'Acme Corp',
  display_role: 'Speaker',
  badge_color: null,
  notes: null,
};

const SAMPLE_TEMPLATE: BadgeTemplate = {
  widthMm: 85,
  heightMm: 54,
  backgroundColor: '#ffffff',
  accentColor: '#6366f1',
  showPhoto: true,
  showCompany: true,
  showQr: true,
  showRole: true,
  fontSizeName: 20,
  fontSizeCompany: 14,
};

const SAMPLE_DATA: BadgeData = {
  activationId: 'act-1',
  accessToken: 'token-abc-123',
  displayName: 'John Smith',
  displayCompany: 'TechCorp',
  displayRole: 'Developer',
  qrPayload: 'token-abc-123',
};

// ---------------------------------------------------------------------------
// 1–8: generateBadgeSvg
// ---------------------------------------------------------------------------

describe('generateBadgeSvg', () => {
  it('1. returns valid SVG string with xmlns', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, SAMPLE_TEMPLATE);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toMatch(/<svg /);
    expect(svg).toMatch(/<\/svg>/);
  });

  it('2. includes name in output', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, SAMPLE_TEMPLATE);
    expect(svg).toContain('John Smith');
  });

  it('3. includes QR placeholder when showQr=true', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, { ...SAMPLE_TEMPLATE, showQr: true });
    expect(svg).toContain('>QR<');
  });

  it('4. excludes QR when showQr=false', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, { ...SAMPLE_TEMPLATE, showQr: false });
    expect(svg).not.toContain('>QR<');
  });

  it('5. includes company when showCompany=true', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, { ...SAMPLE_TEMPLATE, showCompany: true });
    expect(svg).toContain('TechCorp');
  });

  it('6. excludes company when showCompany=false', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, { ...SAMPLE_TEMPLATE, showCompany: false });
    expect(svg).not.toContain('TechCorp');
  });

  it('7. shows role when showRole=true', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, { ...SAMPLE_TEMPLATE, showRole: true });
    expect(svg).toContain('Developer');
  });

  it('8. uses template accent color', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, { ...SAMPLE_TEMPLATE, accentColor: '#ff5500' });
    expect(svg).toContain('#ff5500');
  });
});

// ---------------------------------------------------------------------------
// 9–12: generateBadgePdf / generateBatchPdf
// ---------------------------------------------------------------------------

describe('generateBadgePdf', () => {
  it('9. returns Uint8Array', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, SAMPLE_TEMPLATE);
    const pdf = generateBadgePdf(svg, SAMPLE_DATA);
    expect(pdf).toBeInstanceOf(Uint8Array);
  });

  it('10. starts with %PDF header bytes', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, SAMPLE_TEMPLATE);
    const pdf = generateBadgePdf(svg, SAMPLE_DATA);
    // Check first 8 bytes: %PDF-1.4
    const header = new TextDecoder().decode(pdf.slice(0, 8));
    expect(header).toBe('%PDF-1.4');
  });

  it('11. has content (length > 0)', () => {
    const svg = generateBadgeSvg(SAMPLE_DATA, SAMPLE_TEMPLATE);
    const pdf = generateBadgePdf(svg, SAMPLE_DATA);
    expect(pdf.length).toBeGreaterThan(0);
  });
});

describe('generateBatchPdf', () => {
  it('12. returns Uint8Array with content', () => {
    const svg1 = generateBadgeSvg(SAMPLE_DATA, SAMPLE_TEMPLATE);
    const pdf1 = generateBadgePdf(svg1, SAMPLE_DATA);
    const badge1: GeneratedBadge = { activationId: 'act-1', svgContent: svg1, pdfBytes: pdf1 };

    const data2 = { ...SAMPLE_DATA, activationId: 'act-2', displayName: 'Jane Doe' };
    const svg2 = generateBadgeSvg(data2, SAMPLE_TEMPLATE);
    const pdf2 = generateBadgePdf(svg2, data2);
    const badge2: GeneratedBadge = { activationId: 'act-2', svgContent: svg2, pdfBytes: pdf2 };

    const batch = generateBatchPdf([badge1, badge2]);
    expect(batch).toBeInstanceOf(Uint8Array);
    expect(batch.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 13–17: badge-template.service
// ---------------------------------------------------------------------------

describe('createTemplate', () => {
  it('13. valid input inserts and returns template', async () => {
    const db = makeServiceDb([[TEMPLATE_ROW]]);
    const result = await createTemplate('conf-1', { name: 'Standard Badge' }, db);
    expect(result.id).toBe('tpl-1');
    expect(result.name).toBe('Standard Badge');
    expect(result.widthMm).toBe(85);
    expect(result.accentColor).toBe('#6366f1');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('14. duplicate name throws TEMPLATE_DUPLICATE', async () => {
    const pgUniqueError = { code: '23505', constraint: 'badge_templates_conference_id_name_key' };
    const db = {
      query: vi.fn(async () => { throw pgUniqueError; }),
      execute: vi.fn(async () => {}),
    };
    await expect(createTemplate('conf-1', { name: 'Standard Badge' }, db))
      .rejects.toThrow(BadgeError);
    try {
      await createTemplate('conf-1', { name: 'Standard Badge' }, db);
    } catch (e) {
      expect((e as BadgeError).code).toBe('TEMPLATE_DUPLICATE');
    }
  });
});

describe('getTemplate', () => {
  it('15a. found — returns mapped template', async () => {
    const db = makeServiceDb([[TEMPLATE_ROW]]);
    const result = await getTemplate('tpl-1', db);
    expect(result.id).toBe('tpl-1');
    expect(result.conferenceId).toBe('conf-1');
  });

  it('15b. not found — throws TEMPLATE_NOT_FOUND', async () => {
    const db = makeServiceDb([[]]); // empty result
    await expect(getTemplate('tpl-missing', db)).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
  });
});

describe('listTemplates', () => {
  it('16. returns array of templates', async () => {
    const db = makeServiceDb([[TEMPLATE_ROW, { ...TEMPLATE_ROW, id: 'tpl-2', name: 'VIP Badge' }]]);
    const result = await listTemplates('conf-1', db);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('tpl-1');
    expect(result[1].name).toBe('VIP Badge');
  });
});

describe('updateTemplate', () => {
  it('17. partial update — returns updated template', async () => {
    const updated = { ...TEMPLATE_ROW, name: 'Premium Badge', accent_color: '#ff0000' };
    const db = makeServiceDb([[updated]]);
    const result = await updateTemplate('tpl-1', { name: 'Premium Badge', accentColor: '#ff0000' }, db);
    expect(result.name).toBe('Premium Badge');
    expect(result.accentColor).toBe('#ff0000');
  });
});

// ---------------------------------------------------------------------------
// 18–24: badge-print.service
// ---------------------------------------------------------------------------

describe('createPrintJob', () => {
  it('18. creates job with status=pending', async () => {
    const db = makeServiceDb([
      [{ count: '5' }],  // COUNT activations
      [JOB_ROW],         // INSERT job
    ]);
    const job = await createPrintJob('conf-1', 'tpl-1', 'user-admin', db);
    expect(job.status).toBe('pending');
    expect(job.templateId).toBe('tpl-1');
    expect(job.requestedBy).toBe('user-admin');
  });

  it('19. sets total_count from activation count', async () => {
    const db = makeServiceDb([
      [{ count: '42' }],
      [{ ...JOB_ROW, total_count: 42 }],
    ]);
    const job = await createPrintJob('conf-1', 'tpl-1', 'user-admin', db);
    expect(job.totalCount).toBe(42);
  });
});

describe('getJob', () => {
  it('20a. found — returns job', async () => {
    const db = makeServiceDb([[JOB_ROW]]);
    const job = await getJob('job-1', db);
    expect(job.id).toBe('job-1');
    expect(job.status).toBe('pending');
  });

  it('20b. not found — throws JOB_NOT_FOUND', async () => {
    const db = makeServiceDb([[]]); // empty
    await expect(getJob('job-missing', db)).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });
});

describe('listJobs', () => {
  it('21. returns array of jobs', async () => {
    const db = makeServiceDb([[JOB_ROW, { ...JOB_ROW, id: 'job-2', status: 'done' }]]);
    const jobs = await listJobs('conf-1', db);
    expect(jobs).toHaveLength(2);
    expect(jobs[1].status).toBe('done');
  });
});

describe('processPrintJob', () => {
  it('22. updates status to done', async () => {
    // query calls: getJob, getTemplate, getActivations
    // execute calls: mark processing, mark done
    const db = makeServiceDb([
      [JOB_ROW],       // SELECT job
      [TEMPLATE_ROW],  // SELECT template
      [ACTIVATION_ROW], // SELECT activations
    ]);
    const mockGen: BadgeGenerator = vi.fn((data) => ({
      activationId: data.activationId,
      svgContent: '<svg/>',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    }));
    const result = await processPrintJob('job-1', db, mockGen);
    expect(result.status).toBe('done');
  });

  it('23. calls generator for each activation', async () => {
    const act2 = { ...ACTIVATION_ROW, id: 'act-2' };
    const db = makeServiceDb([
      [JOB_ROW],
      [TEMPLATE_ROW],
      [ACTIVATION_ROW, act2],
    ]);
    const mockGen: BadgeGenerator = vi.fn((data) => ({
      activationId: data.activationId,
      svgContent: '<svg/>',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    }));
    await processPrintJob('job-1', db, mockGen);
    expect(mockGen).toHaveBeenCalledTimes(2);
  });

  it('24. sets completedAt on done', async () => {
    const db = makeServiceDb([
      [JOB_ROW],
      [TEMPLATE_ROW],
      [ACTIVATION_ROW],
    ]);
    const mockGen: BadgeGenerator = vi.fn((data) => ({
      activationId: data.activationId,
      svgContent: '<svg/>',
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    }));
    const result = await processPrintJob('job-1', db, mockGen);
    expect(result.completedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 25–27: getBadgeForActivation
// ---------------------------------------------------------------------------

describe('getBadgeForActivation', () => {
  it('25. returns GeneratedBadge with svgContent', async () => {
    const db = makeServiceDb([
      [ACTIVATION_ROW],  // SELECT activation + override
      [TEMPLATE_ROW],    // SELECT template
    ]);
    const result = await getBadgeForActivation('act-1', 'tpl-1', db);
    expect(result.svgContent).toContain('<svg');
    expect(result.pdfBytes).toBeInstanceOf(Uint8Array);
  });

  it('26. applies override display name', async () => {
    const actWithOverride = { ...ACTIVATION_ROW, display_name: 'Override Name' };
    const db = makeServiceDb([
      [actWithOverride],
      [TEMPLATE_ROW],
    ]);
    const result = await getBadgeForActivation('act-1', 'tpl-1', db);
    expect(result.displayName).toBe('Override Name');
    expect(result.svgContent).toContain('Override Name');
  });

  it('27. uses fallback when no override', async () => {
    // ACTIVATION_ROW has display_name: null and user_name: null → fallback
    const db = makeServiceDb([
      [ACTIVATION_ROW],
      [TEMPLATE_ROW],
    ]);
    const result = await getBadgeForActivation('act-1', 'tpl-1', db);
    // Fallback should contain part of activationId
    expect(result.displayName).toContain('act-1'.substring(0, 8));
  });
});

// ---------------------------------------------------------------------------
// 28–30: badge-override.service
// ---------------------------------------------------------------------------

describe('setOverride', () => {
  it('28. inserts/updates override and returns it', async () => {
    const db = makeServiceDb([[OVERRIDE_ROW]]);
    const result = await setOverride('act-1', { displayName: 'Jane Doe', displayRole: 'Speaker' }, db);
    expect(result.activationId).toBe('act-1');
    expect(result.displayName).toBe('Jane Doe');
    expect(result.displayRole).toBe('Speaker');
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('getOverride', () => {
  it('29. returns null when not found (no error)', async () => {
    const db = makeServiceDb([[]]); // empty
    const result = await getOverride('act-missing', db);
    expect(result).toBeNull();
  });
});

describe('deleteOverride', () => {
  it('30. removes override (calls execute)', async () => {
    const db = makeServiceDb([]);
    await deleteOverride('act-1', db);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      ['act-1'],
    );
  });
});

// ---------------------------------------------------------------------------
// 31: Full flow test
// ---------------------------------------------------------------------------

describe('Full flow: template → job → process → get PDF', () => {
  it('31. end-to-end badge printing flow', async () => {
    // Step 1: create template
    const tplDb = makeServiceDb([[TEMPLATE_ROW]]);
    const template = await createTemplate('conf-1', { name: 'Standard Badge' }, tplDb);
    expect(template.id).toBe('tpl-1');

    // Step 2: create job
    const jobDb = makeServiceDb([
      [{ count: '1' }],
      [JOB_ROW],
    ]);
    const job = await createPrintJob('conf-1', template.id, 'user-admin', jobDb);
    expect(job.status).toBe('pending');

    // Step 3: process job
    const processDb = makeServiceDb([
      [JOB_ROW],
      [TEMPLATE_ROW],
      [ACTIVATION_ROW],
    ]);
    const mockGen: BadgeGenerator = vi.fn((data) => ({
      activationId: data.activationId,
      svgContent: generateBadgeSvg({ ...SAMPLE_DATA, activationId: data.activationId }, SAMPLE_TEMPLATE),
      pdfBytes: generateBadgePdf('<svg/>', data),
    }));
    const processed = await processPrintJob(job.id, processDb, mockGen);
    expect(processed.status).toBe('done');
    expect(processed.pdfUrl).toBeTruthy();

    // Step 4: get single badge PDF
    const pdfDb = makeServiceDb([
      [ACTIVATION_ROW],
      [TEMPLATE_ROW],
    ]);
    const badge = await getBadgeForActivation('act-1', template.id, pdfDb);
    expect(badge.pdfBytes).toBeInstanceOf(Uint8Array);
    const pdfHeader = new TextDecoder().decode(badge.pdfBytes.slice(0, 8));
    expect(pdfHeader).toBe('%PDF-1.4');
  });
});

// ---------------------------------------------------------------------------
// 32–34: API route tests
// ---------------------------------------------------------------------------

describe('API routes', () => {
  it('32. POST /badge-templates — 201 on valid', async () => {
    const db = makeServiceDb([[TEMPLATE_ROW]]);
    const request = new NextRequest('http://localhost/api/conferences/conf-1/badge-templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'Standard Badge' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await createTemplateRoute(request, { params: { conferenceId: 'conf-1' }, db });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe('tpl-1');
  });

  it('33. GET /badge-templates/[id] — 404 on missing', async () => {
    const db = makeServiceDb([[]]); // empty → not found
    const request = new NextRequest('http://localhost/api/conferences/conf-1/badge-templates/tpl-missing');
    const response = await getTemplateRoute(request, {
      params: { conferenceId: 'conf-1', templateId: 'tpl-missing' },
      db,
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('TEMPLATE_NOT_FOUND');
  });

  it('34. GET /activations/[id]/badge — returns SVG content-type', async () => {
    const db = makeServiceDb([
      [ACTIVATION_ROW],
      [TEMPLATE_ROW],
    ]);
    const request = new NextRequest(
      'http://localhost/api/activations/act-1/badge?templateId=tpl-1',
    );
    const response = await getBadgeRoute(request, { params: { activationId: 'act-1' }, db });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    const text = await response.text();
    expect(text).toContain('<svg');
  });
});

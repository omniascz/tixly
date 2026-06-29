import type { ReportDef } from './types';
import { REPORTS_PRODEJE } from './reports-prodeje';
import { REPORTS_FINANCE } from './reports-finance';
import { REPORTS_ZAKAZNICI } from './reports-zakaznici';
import { REPORTS_UDALOSTI } from './reports-udalosti';
import { REPORTS_MARKETING } from './reports-marketing';
import { REPORTS_OPERACE } from './reports-operace';
import { REPORTS_SROVNANI } from './reports-srovnani';
import { REPORTS_PLATFORM } from './reports-platform';
import { REPORTS_EXTRA_1 } from './reports-extra-1';
import { REPORTS_EXTRA_2 } from './reports-extra-2';
import { REPORTS_EXTRA_3 } from './reports-extra-3';

export const ALL_REPORTS: ReportDef[] = [
  ...REPORTS_PRODEJE,
  ...REPORTS_FINANCE,
  ...REPORTS_ZAKAZNICI,
  ...REPORTS_UDALOSTI,
  ...REPORTS_MARKETING,
  ...REPORTS_OPERACE,
  ...REPORTS_SROVNANI,
  ...REPORTS_PLATFORM,
  ...REPORTS_EXTRA_1,
  ...REPORTS_EXTRA_2,
  ...REPORTS_EXTRA_3,
];

export const REPORT_BY_ID = new Map<string, ReportDef>(
  ALL_REPORTS.map((r) => [r.id, r]),
);

export type { ReportDef } from './types';
export { CATEGORIES } from './types';

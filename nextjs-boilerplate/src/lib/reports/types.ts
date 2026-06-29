export type ParamType = 'date' | 'text' | 'select' | 'uuid' | 'month';

export interface ReportParam {
  key: string;
  label: string;
  type: ParamType;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'currency_czk' | 'date' | 'datetime' | 'pct' | 'badge';
}

export interface ReportDef {
  id: string;
  title: string;
  category: string;
  description: string;
  scope: 'promoter' | 'platform';
  params: ReportParam[];
  columns: ReportColumn[];
  buildQuery: (
    promoterId: string,
    params: Record<string, string>,
  ) => { sql: string; values: unknown[] };
}

export type CategoryMeta = {
  id: string;
  label: string;
  icon: string;
};

export const CATEGORIES: CategoryMeta[] = [
  { id: 'prodeje', label: 'Prodeje', icon: 'TrendingUp' },
  { id: 'finance', label: 'Finance', icon: 'Wallet' },
  { id: 'zakaznici', label: 'Zákazníci', icon: 'Users' },
  { id: 'udalosti', label: 'Události', icon: 'CalendarDays' },
  { id: 'marketing', label: 'Marketing', icon: 'Tag' },
  { id: 'operace', label: 'Operace', icon: 'ScanLine' },
  { id: 'srovnani', label: 'Srovnání', icon: 'BarChart2' },
  { id: 'platform', label: 'Platform (admin)', icon: 'Shield' },
];

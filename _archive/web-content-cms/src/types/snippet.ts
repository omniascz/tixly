export type SnippetFormat = 'plain' | 'markdown' | 'html';

export interface ContentSnippet {
  id: string;
  promoterId: string;
  /** Stable key, e.g. "homepage.hero.subtitle" */
  key: string;
  /** Display name for admin UI */
  label: string;
  format: SnippetFormat;
  content: string;
  /** Optional locale code; default 'cs' */
  locale: string;
  /** Optional category for grouping in admin UI */
  category: string | null;
  updatedBy: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface UpsertSnippetInput {
  key: string;
  label: string;
  format: SnippetFormat;
  content: string;
  locale?: string;
  category?: string;
}

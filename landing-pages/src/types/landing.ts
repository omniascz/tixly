export type PageStatus = 'draft' | 'published' | 'archived';

export interface LandingPage {
  id: string;
  promoterId: string;
  /** URL slug, e.g. "ems-zada-pater", "/", "obchodni-podminky" */
  slug: string;
  /** Display title shown in admin */
  title: string;
  /** SEO meta */
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string | null;
  /** OpenGraph */
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  /** Optional canonical URL override */
  canonicalUrl: string | null;
  /** Hreflang map (lang code -> url) */
  hreflang: Record<string, string> | null;
  status: PageStatus;
  /** Path to a static HTML file in /public/landings/ if no blocks defined */
  staticHtmlPath: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type BlockType =
  | 'hero'
  | 'text'
  | 'image'
  | 'cta'
  | 'gallery'
  | 'features'
  | 'testimonial'
  | 'faq'
  | 'pricing'
  | 'contact_form'
  | 'html';

export const BLOCK_TYPES: readonly BlockType[] = [
  'hero',
  'text',
  'image',
  'cta',
  'gallery',
  'features',
  'testimonial',
  'faq',
  'pricing',
  'contact_form',
  'html',
] as const;

export interface ContentBlock {
  id: string;
  pageId: string;
  type: BlockType;
  position: number;
  data: Record<string, unknown>;
  variant: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PageWithBlocks extends LandingPage {
  blocks: ContentBlock[];
}

export interface CreatePageInput {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  staticHtmlPath?: string;
}

export interface UpdatePageInput {
  title?: string;
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  canonicalUrl?: string | null;
  hreflang?: Record<string, string> | null;
  status?: PageStatus;
  staticHtmlPath?: string | null;
}

export interface UpsertBlockInput {
  type: BlockType;
  position: number;
  data: Record<string, unknown>;
  variant?: string;
}

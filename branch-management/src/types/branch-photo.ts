// =============================================================================
// Branch Photo types — multi-branch photo gallery
// =============================================================================

export type PhotoCategory = 'interior' | 'exterior' | 'equipment' | 'team' | 'other';

export interface BranchPhoto {
  id: string;
  branchId: string;
  promoterId: string;
  /** S3/Storage URL or relative path */
  url: string;
  /** Alt text for accessibility */
  alt: string | null;
  /** Display order */
  position: number;
  /** Photo category (interior/exterior/equipment/team/other) */
  category: PhotoCategory;
  /** Optional caption */
  caption: string | null;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface UploadPhotoInput {
  branchId: string;
  url: string;
  alt?: string;
  category?: PhotoCategory;
  caption?: string;
  position?: number;
}

export interface UpdatePhotoInput {
  alt?: string;
  caption?: string;
  category?: PhotoCategory;
}

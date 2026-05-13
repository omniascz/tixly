// ---------------------------------------------------------------------------
// Service Catalog — Error codes
// ---------------------------------------------------------------------------

export type CatalogErrorCode =
  | 'CATEGORY_NOT_FOUND'        // 404
  | 'CATEGORY_DUPLICATE'        // 409
  | 'SERVICE_NOT_FOUND'         // 404
  | 'SERVICE_DUPLICATE'         // 409
  | 'ADDON_NOT_FOUND'           // 404
  | 'ADDON_DUPLICATE'           // 409
  | 'PRICING_RULE_NOT_FOUND'    // 404
  | 'PRICING_RULE_DUPLICATE'    // 409
  | 'REVIEW_NOT_FOUND'          // 404
  | 'REVIEW_DUPLICATE'          // 409
  | 'RESOURCE_LINK_EXISTS';     // 409

const HTTP_STATUS: Record<CatalogErrorCode, number> = {
  CATEGORY_NOT_FOUND: 404,
  CATEGORY_DUPLICATE: 409,
  SERVICE_NOT_FOUND: 404,
  SERVICE_DUPLICATE: 409,
  ADDON_NOT_FOUND: 404,
  ADDON_DUPLICATE: 409,
  PRICING_RULE_NOT_FOUND: 404,
  PRICING_RULE_DUPLICATE: 409,
  REVIEW_NOT_FOUND: 404,
  REVIEW_DUPLICATE: 409,
  RESOURCE_LINK_EXISTS: 409,
};

const DEFAULT_MESSAGES: Record<CatalogErrorCode, string> = {
  CATEGORY_NOT_FOUND: 'Service category not found.',
  CATEGORY_DUPLICATE: 'A category with this slug already exists for this promoter.',
  SERVICE_NOT_FOUND: 'Service not found.',
  SERVICE_DUPLICATE: 'A service with this slug already exists for this promoter.',
  ADDON_NOT_FOUND: 'Service add-on not found.',
  ADDON_DUPLICATE: 'An add-on with this name already exists for this service.',
  PRICING_RULE_NOT_FOUND: 'Pricing rule not found.',
  PRICING_RULE_DUPLICATE: 'A pricing rule with this name already exists for this service.',
  REVIEW_NOT_FOUND: 'Review not found.',
  REVIEW_DUPLICATE: 'A review from this user for this service already exists.',
  RESOURCE_LINK_EXISTS: 'This resource is already linked to the service.',
};

export class CatalogError extends Error {
  public readonly code: CatalogErrorCode;
  public readonly statusCode: number;

  constructor(code: CatalogErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'CatalogError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, CatalogError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isCatalogError(err: unknown): err is CatalogError {
  return err instanceof CatalogError;
}

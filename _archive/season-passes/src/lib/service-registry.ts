import { SeasonPassService } from '../services/season-pass.service';
import { PassBenefitsService } from '../services/pass-benefits.service';
import { SeasonPass, SeasonPassType, PassUsage } from '../types/season-pass';

// =============================================================================
// Service registry — singleton instances wired with production adapters.
// In tests, replace these with mocks via dependency injection directly on
// SeasonPassService / PassBenefitsService constructors.
// =============================================================================

/**
 * Extended service that adds the query methods used by API route handlers.
 * These are declared separately to keep the core domain service free of
 * HTTP/routing concerns, while still being implemented on the same class.
 */
export interface SeasonPassServiceWithExtras extends SeasonPassService {
  listPassesForUser(userId: string): Promise<SeasonPass[]>;
  getPassForUser(passId: string, userId: string): Promise<SeasonPass | null>;
  listPassUsages(passId: string): Promise<PassUsage[]>;
  listPassTypes(organizerId: string): Promise<SeasonPassType[]>;
  handleRenewalCallback(passId: string, gopayPaymentId: string): Promise<void>;
}

let _seasonPassService: SeasonPassServiceWithExtras | null = null;

export function getSeasonPassService(): SeasonPassServiceWithExtras {
  if (!_seasonPassService) {
    throw new Error(
      'SeasonPassService not initialised. Call registerSeasonPassService() in app bootstrap.'
    );
  }
  return _seasonPassService;
}

export function registerSeasonPassService(service: SeasonPassServiceWithExtras): void {
  _seasonPassService = service;
}

let _passBenefitsService: PassBenefitsService | null = null;

export function getPassBenefitsService(): PassBenefitsService {
  if (!_passBenefitsService) {
    throw new Error(
      'PassBenefitsService not initialised. Call registerPassBenefitsService() in app bootstrap.'
    );
  }
  return _passBenefitsService;
}

export function registerPassBenefitsService(service: PassBenefitsService): void {
  _passBenefitsService = service;
}

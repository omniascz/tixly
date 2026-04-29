// ─── Enums ───────────────────────────────────────────────────────────────────

export enum ExplanationKey {
  GenreMatch = "genre_match",
  PopularInCity = "popular_in_city",
  LocationMatch = "location_match",
  Trending = "trending",
  NewEvent = "new_event",
  OrganizerPass = "organizer_pass",
  HiddenGem = "hidden_gem",
  SimilarToEvent = "similar_to_event",
}

// ─── Database entity types (mapped from ai.* schema) ─────────────────────────

export interface UserFeatures {
  userId: string;
  /**
   * Genre name → weight [0,1]. E.g. { "rock": 0.7, "pop": 0.3 }
   * Stored as JSONB in ai.user_features.genre_vector
   */
  genreVector: Record<string, number>;
  /** 0 = price-sensitive, 1 = price-insensitive */
  priceSensitivity: number;
  primaryCity: string | null;
  eventsBrowsed30d: number;
  lastPurchaseAt: Date | null;
  totalPurchases: number;
  /** Organizer IDs where user holds an active season pass */
  activePassOrganizerIds: string[];
  updatedAt: Date;
}

export interface EventFeatures {
  eventId: string;
  category: string;
  venueCity: string;
  organizerId: string;
  organizerName: string;
  sellThroughRate: number;
  salesVelocity24h: number;
  basePriceMinCzk: number;
  daysUntilEvent: number;
  isWeekend: boolean;
  daysSinceCreation: number;
  totalCapacity: number;
  updatedAt: Date;
}

export interface UserRecommendation {
  userId: string;
  eventId: string;
  score: number;
  rank: number;
  explanationKey: ExplanationKey;
  explanationParams: Record<string, string>;
  modelVersion: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface BrowsingEvent {
  id: string;
  userId: string;
  sessionId: string;
  eventType: "page_view" | "search" | "ticket_view" | "checkout_start";
  eventId: string | null;
  searchQuery: string | null;
  occurredAt: Date;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export interface ScoringWeights {
  /** popularity_score weight */
  alpha: number;
  /** genre_similarity weight */
  beta: number;
  /** location_bonus weight */
  gamma: number;
  /** recency_boost weight */
  delta: number;
  /** price_match_score weight */
  epsilon: number;
  /** exploration_bonus weight */
  zeta: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  alpha: 0.4,
  beta: 0.25,
  gamma: 0.15,
  delta: 0.10,
  epsilon: 0.05,
  zeta: 0.05,
};

export interface ScoringComponents {
  popularityScore: number;
  genreSimilarity: number;
  locationBonus: number;
  recencyBoost: number;
  priceMatch: number;
  explorationBonus: number;
}

export interface ExplanationContext {
  genreSimilarity: number;
  locationBonus: number;
  salesVelocity24h: number;
  salesVelocityThreshold: number;
  explorationBonus: number;
  hasOrganizerPass: boolean;
  organizerName: string;
  city: string;
  genre: string;
}

// ─── Candidates ──────────────────────────────────────────────────────────────

export interface RecommendationCandidate {
  eventFeatures: EventFeatures;
  scoringComponents: ScoringComponents;
  rawScore: number;
}

export interface RankedCandidate extends RecommendationCandidate {
  finalScore: number;
  explanationKey: ExplanationKey;
  explanationParams: Record<string, string>;
  rank: number;
}

// ─── Business rules context ───────────────────────────────────────────────────

export interface BusinessRulesContext {
  purchasedEventIds: Set<string>;
  activePassOrganizerIds: string[];
  /** Max events per category allowed in top N results */
  diversityMaxPerCategory: number;
  /** How many top results to enforce diversity on */
  diversityTopN: number;
}

// ─── API types ────────────────────────────────────────────────────────────────

export interface RecommendationOptions {
  limit: number;
  categoryFilter?: string;
  cityFilter?: string;
  deviceType?: "mobile" | "desktop" | "tablet";
  hourOfDay?: number;
}

export interface RecommendationResult {
  recommendations: RecommendationItem[];
  modelVersion: string;
  personalized: boolean;
  computedAt: string;
}

export interface RecommendationItem {
  eventId: string;
  score: number;
  rank: number;
  explanation: string;
  explanationKey: ExplanationKey;
  explanationParams: Record<string, string>;
}

export interface CachedRecommendations {
  recommendations: UserRecommendation[];
  cachedAt: string;
}

// ─── Service dependencies (dependency injection) ──────────────────────────────

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface RedisAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
}

export interface KafkaConsumerAdapter {
  subscribe(topics: string[]): Promise<void>;
  consume(handler: (message: KafkaMessage) => Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
}

export interface KafkaMessage {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: unknown;
  timestamp: string;
}

export interface ServiceDeps {
  db: DbAdapter;
  redis: RedisAdapter;
}

// ─── Kafka event payloads ─────────────────────────────────────────────────────

export interface OrderCompletedPayload {
  orderId: string;
  userId: string;
  eventId: string;
  eventCategory: string;
  organizerId: string;
  totalAmountCzk: number;
  occurredAt: string;
}

export interface PageViewedPayload {
  sessionId: string;
  userId: string | null;
  eventId: string;
  occurredAt: string;
}

export interface SearchPerformedPayload {
  sessionId: string;
  userId: string | null;
  query: string;
  occurredAt: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class RecommendationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userId?: string,
  ) {
    super(message);
    this.name = "RecommendationError";
  }
}

export class FeatureNotFoundError extends RecommendationError {
  constructor(userId: string) {
    super(
      `User features not found for userId=${userId}`,
      "FEATURE_NOT_FOUND",
      userId,
    );
    this.name = "FeatureNotFoundError";
  }
}

export class RateLimitError extends RecommendationError {
  constructor(userId: string) {
    super(
      `Rate limit exceeded for userId=${userId}`,
      "RATE_LIMIT_EXCEEDED",
      userId,
    );
    this.name = "RateLimitError";
  }
}

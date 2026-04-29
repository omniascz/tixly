// =============================================================================
// Fan Social Graph — Feature #188
// Friend connections, activity feed, sociální discovery.
// =============================================================================

export type Visibility = 'public' | 'friends' | 'private';

export type ActivityType =
  | 'planning_to_attend'
  | 'attending'
  | 'attended'
  | 'reviewed'
  | 'shared';

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface UserProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  profileVisibility: Visibility;
  activityVisibility: Visibility;
  allowFriendRequests: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertProfileInput {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  profileVisibility?: Visibility;
  activityVisibility?: Visibility;
  allowFriendRequests?: boolean;
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: FriendRequestStatus;
  message: string | null;
  createdAt: Date;
  respondedAt: Date | null;
}

export interface SendFriendRequestInput {
  fromUserId: string;
  toUserId: string;
  message?: string;
}

export interface Friendship {
  userA: string;
  userB: string;
  createdAt: Date;
}

export interface Activity {
  id: string;
  userId: string;
  activityType: ActivityType;
  eventId: string;
  eventTitle: string;
  eventStartsAt: Date;
  visibility: Visibility;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface RecordActivityInput {
  userId: string;
  activityType: ActivityType;
  eventId: string;
  eventTitle: string;
  eventStartsAt: Date;
  visibility?: Visibility;
  metadata?: Record<string, unknown>;
}

export interface FeedItem extends Activity {
  actorDisplayName: string;
  actorAvatarUrl: string | null;
}

export interface EventSocialContext {
  eventId: string;
  friendsAttending: Array<{ userId: string; displayName: string; avatarUrl: string | null }>;
  totalFriends: number;
  /** Lokalizovaný human-readable shrnující string, např. „Petr a 3 přátelé plánují jít". */
  summary: string;
}

export interface DiscoverySuggestion {
  eventId: string;
  eventTitle: string;
  eventStartsAt: Date;
  friendCount: number;
  sampleFriends: Array<{ userId: string; displayName: string }>;
}

export class FanSocialGraphError extends Error {
  constructor(
    public readonly code:
      | 'PROFILE_NOT_FOUND'
      | 'CANNOT_FRIEND_SELF'
      | 'ALREADY_FRIENDS'
      | 'REQUEST_ALREADY_PENDING'
      | 'REQUEST_NOT_FOUND'
      | 'NOT_AUTHORIZED'
      | 'BLOCKED'
      | 'REQUESTS_DISABLED'
      | 'NOT_FRIENDS',
    message: string,
  ) {
    super(message);
    this.name = 'FanSocialGraphError';
  }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps {
  db: DbAdapter;
  now?: () => Date;
}

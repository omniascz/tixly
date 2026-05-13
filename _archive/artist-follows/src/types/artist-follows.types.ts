export type FollowableType = 'artist' | 'venue' | 'organizer';
export type NotificationChannel = 'push' | 'email' | 'both' | 'none';
export type ImportSource = 'spotify' | 'apple_music' | 'manual';

export interface Follow {
  id: string;
  userId: string;
  followableType: FollowableType;
  followableId: string;          // artistId, venueId, nebo organizerId
  followableName: string;        // denormalizované pro display
  notificationChannel: NotificationChannel;
  importSource: ImportSource;
  createdAt: Date;
}

export interface FollowInput {
  userId: string;
  followableType: FollowableType;
  followableId: string;
  followableName: string;
  notificationChannel?: NotificationChannel;  // default 'both'
  importSource?: ImportSource;               // default 'manual'
}

export interface SpotifyFollowedArtist {
  spotifyId: string;
  name: string;
  genres: string[];
  imageUrl: string | null;
}

export interface AppleMusicFollowedArtist {
  appleMusicId: string;
  name: string;
}

export interface SpotifyAdapter {
  getFollowedArtists(accessToken: string): Promise<SpotifyFollowedArtist[]>;
}

export interface AppleMusicAdapter {
  getFollowedArtists(userToken: string): Promise<AppleMusicFollowedArtist[]>;
}

export interface NotificationAdapter {
  sendPush(userId: string, payload: { title: string; body: string; data?: Record<string, string> }): Promise<void>;
  sendEmail(userId: string, payload: { subject: string; templateId: string; variables: Record<string, string> }): Promise<void>;
}

export interface NewEventPayload {
  eventId: string;
  eventTitle: string;
  artistId?: string;
  venueId?: string;
  organizerId?: string;
  eventDate: Date;
  ticketUrl: string;
}

export interface FollowStats {
  followableId: string;
  followableType: FollowableType;
  followerCount: number;
  pushSubscribers: number;
  emailSubscribers: number;
}

export class ArtistFollowsError extends Error {
  constructor(
    public readonly code:
      | 'FOLLOW_NOT_FOUND'
      | 'ALREADY_FOLLOWING'
      | 'FOLLOWABLE_NOT_FOUND'
      | 'IMPORT_FAILED'
      | 'NOTIFICATION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'ArtistFollowsError';
  }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps {
  db: DbAdapter;
  notifications: NotificationAdapter;
  spotify: SpotifyAdapter;
  appleMusic: AppleMusicAdapter;
  now?: () => Date;
}

export type StreamProvider = 'zoom' | 'youtube_live' | 'custom';
export type StreamStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';
export type AttendeeAccessStatus = 'pending' | 'granted' | 'revoked' | 'expired';

export interface VirtualStream {
  id: string;
  eventId: string;
  provider: StreamProvider;
  providerStreamId: string | null;   // Zoom meeting ID / YouTube broadcast ID
  streamUrl: string | null;          // přístupový URL (zákazník ho vidí)
  hostUrl: string | null;            // URL pro hostitele (pořadatel)
  passcode: string | null;           // Zoom passcode
  status: StreamStatus;
  scheduledStartAt: Date;
  scheduledEndAt: Date | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  maxAttendees: number | null;
  createdAt: Date;
}

export interface AttendeeAccess {
  id: string;
  streamId: string;
  ticketId: string;
  userId: string;
  status: AttendeeAccessStatus;
  accessToken: string;               // unikátní JWT-like token pro přístup
  grantedAt: Date;
  expiresAt: Date;                   // stream end + 48h pro záznam
  joinedAt: Date | null;
  leftAt: Date | null;
}

export interface ZoomAdapter {
  createMeeting(params: { topic: string; startTime: Date; duration: number; passcode?: string }): Promise<{ meetingId: string; joinUrl: string; hostUrl: string; passcode: string }>;
  deleteMeeting(meetingId: string): Promise<void>;
  getMeetingStatus(meetingId: string): Promise<{ status: 'waiting' | 'started' | 'finished' }>;
  addRegistrant(meetingId: string, params: { email: string; firstName: string }): Promise<{ joinUrl: string }>;
}

export interface YouTubeAdapter {
  createBroadcast(params: { title: string; scheduledStartAt: Date }): Promise<{ broadcastId: string; streamUrl: string; embedUrl: string }>;
  getBroadcastStatus(broadcastId: string): Promise<{ status: 'ready' | 'live' | 'complete' }>;
}

export class VirtualEventsError extends Error {
  constructor(
    public readonly code: 'STREAM_NOT_FOUND' | 'ACCESS_NOT_FOUND' | 'STREAM_NOT_ACTIVE' | 'ACCESS_REVOKED' | 'ACCESS_EXPIRED' | 'PROVIDER_ERROR' | 'DUPLICATE_STREAM',
    message: string
  ) {
    super(message);
    this.name = 'VirtualEventsError';
  }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps {
  db: DbAdapter;
  zoom: ZoomAdapter;
  youtube: YouTubeAdapter;
  now?: () => Date;
}

'use client';

import { useEffect, useState } from 'react';
import { Heart, Check, Calendar, Users } from 'lucide-react';
import { typedFetch } from '@/lib/typed-fetch';

type RsvpStatus = 'interested' | 'going' | 'declined' | null;

interface FriendRsvp {
  userId: string;
  name: string;
  email: string;
}

interface RsvpState {
  counts: { interested?: number; going?: number };
  myStatus: RsvpStatus;
  friendsGoing: FriendRsvp[];
  friendsInterested: FriendRsvp[];
  friendsGoingCount: number;
}

interface SocialContextResponse {
  totalGoing: number;
  totalInterested: number;
  friendsGoing: FriendRsvp[];
  friendsInterested: FriendRsvp[];
  friendsGoingCount: number;
  friendsInterestedCount: number;
  myStatus: RsvpStatus;
}

const STRINGS = {
  cs: {
    interested: 'Zajímá mě',
    going: 'Půjdu',
    isInterested: 'Označeno jako zajímavé',
    isGoing: 'Označeno jako "půjdu"',
    saveToCalendar: 'Uložit do kalendáře',
    loginRequired: 'Pro RSVP se prosím přihlas',
    peopleInterested: 'Zájem',
    peopleGoing: 'Jdou',
    friendsGoing: (n: number) =>
      `${n === 1 ? '1 přítel jde' : `${n} přátel jde`}`,
    andMore: (n: number) => `a ${n} dalších`,
  },
  sk: {
    interested: 'Zaujíma ma',
    going: 'Pôjdem',
    isInterested: 'Označené ako zaujímavé',
    isGoing: 'Označené ako "pôjdem"',
    saveToCalendar: 'Uložiť do kalendára',
    loginRequired: 'Pre RSVP sa prosím prihlás',
    peopleInterested: 'Záujem',
    peopleGoing: 'Idú',
    friendsGoing: (n: number) =>
      `${n === 1 ? '1 priateľ ide' : `${n} priateľov ide`}`,
    andMore: (n: number) => `a ${n} ďalších`,
  },
  en: {
    interested: 'Interested',
    going: 'Going',
    isInterested: 'Marked as interested',
    isGoing: 'Marked as going',
    saveToCalendar: 'Save to calendar',
    loginRequired: 'Sign in to RSVP',
    peopleInterested: 'Interested',
    peopleGoing: 'Going',
    friendsGoing: (n: number) =>
      `${n === 1 ? '1 friend going' : `${n} friends going`}`,
    andMore: (n: number) => `and ${n} more`,
  },
} as const;

export function RsvpButtons({
  eventId,
  locale,
}: {
  eventId: string;
  locale: 'cs' | 'sk' | 'en';
}) {
  const t = STRINGS[locale] ?? STRINGS.cs;
  const [state, setState] = useState<RsvpState>({
    counts: {},
    myStatus: null,
    friendsGoing: [],
    friendsInterested: [],
    friendsGoingCount: 0,
  });
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load() {
    try {
      const data = await typedFetch<SocialContextResponse>(
        `/api/events/${eventId}/social-context`,
      );
      setState({
        counts: {
          interested: data.totalInterested,
          going: data.totalGoing,
        },
        myStatus: data.myStatus,
        friendsGoing: data.friendsGoing,
        friendsInterested: data.friendsInterested,
        friendsGoingCount: data.friendsGoingCount,
      });
    } catch {
      // Anonymous user fine — myStatus zůstane null, counts veřejné
    }
  }

  async function toggle(status: 'interested' | 'going') {
    setBusy(true);
    setNeedsLogin(false);
    try {
      if (state.myStatus === status) {
        // Klik na aktivní status → unset
        await typedFetch('/api/buyer/rsvp', {
          method: 'DELETE',
          body: { eventId },
          throwOnError: true,
        });
        setState((s) => ({ ...s, myStatus: null }));
      } else {
        await typedFetch('/api/buyer/rsvp', {
          method: 'POST',
          body: { eventId, status, isPublic: true },
          throwOnError: true,
        });
        setState((s) => ({ ...s, myStatus: status }));
      }
      await load();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401) setNeedsLogin(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void toggle('interested')}
          disabled={busy}
          aria-pressed={state.myStatus === 'interested'}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
            state.myStatus === 'interested'
              ? 'bg-rose-100 text-rose-900 ring-1 ring-rose-300'
              : 'border bg-card hover:bg-muted/40'
          }`}
        >
          <Heart
            className={`h-4 w-4 ${state.myStatus === 'interested' ? 'fill-rose-500' : ''}`}
            aria-hidden
          />
          {t.interested}
          {state.counts.interested ? (
            <span className="ml-1 text-xs text-muted-foreground">
              ({state.counts.interested})
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => void toggle('going')}
          disabled={busy}
          aria-pressed={state.myStatus === 'going'}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
            state.myStatus === 'going'
              ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300'
              : 'border bg-card hover:bg-muted/40'
          }`}
        >
          <Check
            className={`h-4 w-4 ${state.myStatus === 'going' ? 'text-emerald-600' : ''}`}
            aria-hidden
          />
          {t.going}
          {state.counts.going ? (
            <span className="ml-1 text-xs text-muted-foreground">
              ({state.counts.going})
            </span>
          ) : null}
        </button>

        <a
          href={`/api/events/${eventId}/calendar`}
          download
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-muted/40"
          title=".ics pro Apple/Google/Outlook kalendář"
        >
          <Calendar className="h-4 w-4" aria-hidden />
          {t.saveToCalendar}
        </a>
      </div>

      {state.friendsGoing.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm"
          data-testid="friends-going-widget"
        >
          <Users className="h-4 w-4 text-emerald-700" aria-hidden />
          <span className="font-medium text-emerald-900">
            {t.friendsGoing(state.friendsGoingCount)}:
          </span>
          <span className="text-emerald-800">
            {state.friendsGoing
              .slice(0, 3)
              .map((f) => f.name)
              .join(', ')}
            {state.friendsGoingCount > 3
              ? ` ${t.andMore(state.friendsGoingCount - 3)}`
              : ''}
          </span>
        </div>
      ) : null}

      {needsLogin ? (
        <p className="text-xs text-amber-700">{t.loginRequired}</p>
      ) : null}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Heart, Check, Calendar } from 'lucide-react';
import { typedFetch } from '@/lib/typed-fetch';

type RsvpStatus = 'interested' | 'going' | 'declined' | null;

interface RsvpState {
  counts: { interested?: number; going?: number };
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
  const [state, setState] = useState<RsvpState>({ counts: {}, myStatus: null });
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load() {
    try {
      const data = await typedFetch<RsvpState>(`/api/buyer/rsvp?event=${eventId}`);
      setState(data);
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

      {needsLogin ? (
        <p className="text-xs text-amber-700">{t.loginRequired}</p>
      ) : null}
    </div>
  );
}

'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { PassUsage } from '../types/season-pass';

// =============================================================================
// PassUsageHistory — fetches and renders the usage history for a given pass
// =============================================================================

interface PassUsageHistoryProps {
  passId: string;
}

interface EnrichedUsage extends PassUsage {
  eventTitle?: string;
  eventVenue?: string;
}

async function fetchPassUsages(passId: string): Promise<EnrichedUsage[]> {
  const res = await fetch(`/api/passes/${passId}/usages`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch usages: ${res.status}`);
  }
  const json = (await res.json()) as { data: EnrichedUsage[] };
  return json.data;
}

function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

function UsageSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-16 bg-gray-100 rounded-xl" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-12 text-gray-500">
      <p className="text-lg">Žádná použití zatím</p>
      <p className="text-sm mt-1">Historie použití permanentky se zobrazí zde.</p>
    </div>
  );
}

export function PassUsageHistory({ passId }: PassUsageHistoryProps) {
  const { data: usages, isLoading, isError, error } = useQuery({
    queryKey: ['pass-usages', passId],
    queryFn: () => fetchPassUsages(passId),
    staleTime: 60 * 1000, // 1 minute
  });

  if (isLoading) return <UsageSkeleton />;

  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Nepodařilo se načíst historii použití.{' '}
        {error instanceof Error ? error.message : ''}
      </div>
    );
  }

  if (!usages || usages.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-900">
        Historie použití ({usages.length})
      </h3>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
        {usages.map((usage) => (
          <li key={usage.id} className="bg-white px-5 py-4 flex items-start gap-4">
            {/* Icon */}
            <div className="flex-shrink-0 mt-0.5 h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center">
              <svg
                className="h-4 w-4 text-indigo-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
                />
              </svg>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {usage.eventTitle ?? `Akce ${usage.eventId.slice(0, 8)}…`}
              </p>
              {usage.eventVenue && (
                <p className="text-xs text-gray-500 truncate">{usage.eventVenue}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">
                {formatDateTime(usage.usedAt)}
              </p>
            </div>

            {/* Ticket badge */}
            {usage.ticketId && (
              <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                Vstupenka
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

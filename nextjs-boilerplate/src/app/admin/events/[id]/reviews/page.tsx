'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  reviewer_name: string | null;
  is_public: boolean;
  created_at: string;
}

interface Stats {
  avg: number | null;
  count: number;
  distribution: Record<number, number>;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill={s <= rating ? '#f59e0b' : '#e5e7eb'}
          className="h-4 w-4"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

function BigStarDisplay({ avg }: { avg: number }) {
  const full = Math.floor(avg);
  const partial = avg - full;
  return (
    <span className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map((s) => {
        let fill = '#e5e7eb';
        if (s <= full) fill = '#f59e0b';
        else if (s === full + 1 && partial >= 0.5) fill = '#fcd34d';
        return (
          <svg
            key={s}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill={fill}
            className="h-7 w-7"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        );
      })}
    </span>
  );
}

export default function ReviewsAdminPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/reviews`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { reviews: Review[]; stats: Stats };
      setReviews(j.reviews);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [eventId]);

  async function togglePublic(review: Review) {
    const res = await authFetch(`/api/admin/events/${eventId}/reviews`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewId: review.id, isPublic: !review.is_public }),
    });
    if (res.ok) {
      setReviews((prev) =>
        prev.map((r) => (r.id === review.id ? { ...r, is_public: !review.is_public } : r)),
      );
    }
  }

  async function sendRequests() {
    setSendBusy(true);
    setSendFeedback(null);
    try {
      const res = await authFetch(`/api/admin/reviews/send-requests`, {
        method: 'POST',
        body: JSON.stringify({ eventId }),
      });
      const j = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
      if (!res.ok) {
        setSendFeedback(`Chyba: ${j.error ?? res.status}`);
        return;
      }
      setSendFeedback(`Odesláno ${j.sent ?? 0} žádostí o hodnocení.`);
      await load();
    } finally {
      setSendBusy(false);
    }
  }

  const avgLabel = stats?.avg != null ? stats.avg.toFixed(1) : '—';

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Hodnocení"
        description="Automatické hodnocení od kupujících po představení."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void sendRequests()} disabled={sendBusy} size="sm">
          {sendBusy ? 'Odesílám…' : 'Odeslat žádosti o hodnocení'}
        </Button>
        {sendFeedback ? (
          <span className="text-sm text-muted-foreground">{sendFeedback}</span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {stats ? (
        <Card>
          <CardHeader>
            <CardTitle>Souhrnné hodnocení</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex flex-col items-center">
                <span className="text-5xl font-bold tabular-nums">{avgLabel}</span>
                {stats.avg !== null ? <BigStarDisplay avg={stats.avg} /> : null}
                <span className="mt-1 text-sm text-muted-foreground">{stats.count} hodnocení</span>
              </div>
              <div className="flex flex-1 flex-col gap-1 min-w-[200px]">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = stats.distribution[star] ?? 0;
                  const pct = stats.count > 0 ? Math.round((count / stats.count) * 100) : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-sm">
                      <span className="w-4 tabular-nums text-right">{star}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f59e0b" className="h-3.5 w-3.5">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      <div className="flex-1 rounded-full bg-muted h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-400 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 tabular-nums text-muted-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Seznam hodnocení</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Načítám…
            </div>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádná hodnocení.</p>
          ) : (
            <div className="space-y-3">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className="flex flex-col gap-1.5 rounded-lg border bg-background p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StarDisplay rating={review.rating} />
                      <span className="font-medium text-sm">
                        {review.reviewer_name ?? 'Anonymní'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={review.is_public ? 'default' : 'secondary'}>
                        {review.is_public ? 'Veřejné' : 'Skryté'}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => void togglePublic(review)}
                      >
                        {review.is_public ? 'Skrýt' : 'Zveřejnit'}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {new Date(review.created_at).toLocaleDateString('cs-CZ')}
                      </span>
                    </div>
                  </div>
                  {review.comment ? (
                    <p className="text-sm text-muted-foreground leading-relaxed">{review.comment}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

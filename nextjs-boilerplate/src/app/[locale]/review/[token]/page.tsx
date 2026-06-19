'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface ReviewData {
  alreadyReviewed?: boolean;
  eventTitle?: string;
  eventDate?: string | null;
  reviewerName?: string | null;
}

function StarIcon({ filled, hovered }: { filled: boolean; hovered: boolean }) {
  const color = filled || hovered ? '#f59e0b' : '#d1d5db';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={color}
      className="h-10 w-10 transition-colors duration-100"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export default function ReviewPage() {
  const params = useParams<{ locale: string; token: string }>();
  const token = params.token;

  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [doneTitle, setDoneTitle] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/reviews/${token}`);
        if (!res.ok) {
          setError('Odkaz na hodnocení není platný nebo vypršel.');
          return;
        }
        const j = (await res.json()) as ReviewData;
        setData(j);
      } catch {
        setError('Chyba při načítání.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function submit() {
    if (rating === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; eventTitle?: string; error?: string };
      if (!res.ok) {
        if (res.status === 409) {
          setData({ alreadyReviewed: true });
          return;
        }
        setError(j.error ?? `Chyba ${res.status}`);
        return;
      }
      setDoneTitle(j.eventTitle ?? data?.eventTitle ?? '');
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-rose-600">{error}</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mb-4 text-5xl">⭐</div>
        <h1 className="mb-2 text-2xl font-bold">Děkujeme za hodnocení!</h1>
        <p className="text-muted-foreground">Pomáhá nám zlepšovat se.</p>
        {doneTitle ? <p className="mt-4 text-sm text-muted-foreground">{doneTitle}</p> : null}
      </div>
    );
  }

  if (data?.alreadyReviewed) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mb-4 text-5xl">✅</div>
        <h1 className="mb-2 text-xl font-semibold">Hodnocení jste již odeslali. Děkujeme!</h1>
      </div>
    );
  }

  const eventTitle = data?.eventTitle ?? '';
  const reviewerName = data?.reviewerName;

  return (
    <div className="mx-auto max-w-lg py-12">
      <div className="rounded-xl border bg-card p-8 shadow-sm">
        {reviewerName ? (
          <p className="mb-2 text-sm text-muted-foreground">Ahoj, {reviewerName}!</p>
        ) : null}
        <h1 className="mb-6 text-xl font-bold leading-snug">
          Jak se vám líbilo: <span className="text-primary">{eventTitle}</span>?
        </h1>

        <div className="mb-6 flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHovered(star)}
              onMouseLeave={() => setHovered(0)}
              aria-label={`${star} hvězdiček`}
              className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <StarIcon filled={star <= rating} hovered={star <= hovered && hovered > 0} />
            </button>
          ))}
        </div>

        {rating > 0 ? (
          <div className="mb-1 text-sm font-medium text-muted-foreground">
            {['', 'Velmi špatné', 'Špatné', 'Průměrné', 'Dobré', 'Výborné'][rating]}
          </div>
        ) : null}

        <div className="mt-4 mb-6">
          <label className="mb-1 block text-sm font-medium">Komentář (volitelné)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Sdělte nám váš dojem..."
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {error ? (
          <p className="mb-3 text-sm text-rose-600">{error}</p>
        ) : null}

        <button
          type="button"
          disabled={rating === 0 || submitting}
          onClick={() => void submit()}
          className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {submitting ? 'Odesílám…' : 'Odeslat hodnocení'}
        </button>
      </div>
    </div>
  );
}

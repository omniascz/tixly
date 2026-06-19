'use client';

import { Share2 } from 'lucide-react';

export function ShareButton({ title, url }: { title: string; url: string }) {
  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // user dismissed
      }
    } else {
      await navigator.clipboard.writeText(url);
      alert('Odkaz zkopírován do schránky.');
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-zinc-800 px-4 text-sm text-zinc-200 transition hover:bg-zinc-700"
    >
      <Share2 className="h-4 w-4" />
      Sdílet zákulisí
    </button>
  );
}

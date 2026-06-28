'use client';

import { useState } from 'react';
import { Facebook, Link as LinkIcon, Share2 } from 'lucide-react';

export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const fullUrl =
    typeof window !== 'undefined' ? window.location.origin + url : url;
  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(fullUrl)}`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(fullUrl)}`;
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  async function nativeShare() {
    try {
      await navigator.share({ title, url: fullUrl });
    } catch {
      // user dismissed or API not supported — noop
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Sdílet:</span>
      {canNativeShare ? (
        <button
          type="button"
          onClick={nativeShare}
          className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
          aria-label="Sdílet"
        >
          <Share2 className="h-3.5 w-3.5" />
          Sdílet
        </button>
      ) : (
        <>
          <a
            href={fbUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border p-1.5 hover:bg-accent"
            aria-label="Sdílet na Facebooku"
          >
            <Facebook className="h-4 w-4" />
          </a>
          <a
            href={xUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border p-1.5 hover:bg-accent"
            aria-label="Sdílet na X (Twitter)"
          >
            <Share2 className="h-4 w-4" />
          </a>
        </>
      )}
      <button
        type="button"
        onClick={copyLink}
        className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
      >
        <LinkIcon className="h-3.5 w-3.5" />
        {copied ? 'Zkopírováno' : 'Kopírovat odkaz'}
      </button>
    </div>
  );
}

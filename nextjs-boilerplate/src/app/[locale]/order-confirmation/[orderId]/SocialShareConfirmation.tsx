'use client';

/**
 * SocialShareConfirmation — "Jdu tam!" social sharing po nákupu lístku
 *
 * WhatsApp, Facebook, X/Twitter, Snapchat (přes web share URL), nativní Share API.
 * Zobrazí se jen pro paid objednávky.
 */

import { useState } from 'react';
import { Link2, Check } from 'lucide-react';

interface Props {
  eventTitle: string;
  eventUrl: string;
}

export function SocialShareConfirmation({ eventTitle, eventUrl }: Props) {
  const [copied, setCopied] = useState(false);

  const text = `Jdu tam! ${eventTitle}`;
  const encoded = encodeURIComponent(eventUrl);
  const encodedText = encodeURIComponent(text);

  const channels = [
    {
      label: 'WhatsApp',
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      ),
      href: `https://wa.me/?text=${encodeURIComponent(`${text} ${eventUrl}`)}`,
      bg: 'bg-[#25D366] hover:bg-[#1ebe5d] text-white',
    },
    {
      label: 'Facebook',
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
      ),
      href: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
      bg: 'bg-[#1877F2] hover:bg-[#166fe5] text-white',
    },
    {
      label: 'X',
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.213 5.567zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      ),
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encoded}`,
      bg: 'bg-black hover:bg-zinc-800 text-white',
    },
    {
      label: 'Snapchat',
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
          <path d="M12.166.024C6.338.024 3.568 4.2 3.568 7.559c0 .871.1 1.737.302 2.596-.218.12-.472.183-.73.183-.42 0-.807-.15-1.087-.422-.076-.074-.163-.113-.25-.113-.16 0-.304.12-.36.294-.057.176-.02.368.097.495.41.449 1.09.752 1.815.82a4.56 4.56 0 01-.245.694c-.115.284-.256.56-.418.82C1.77 14 .997 14.6.997 15.262c0 .347.19.643.515.808.27.138.59.214.934.226.34.012.688-.04 1.008-.152.223-.077.437-.114.636-.114.398 0 .624.122.644.142.294.293.44.707.44 1.23 0 .65-.228 1.303-.658 1.89a6.09 6.09 0 01-1.587 1.5 1.07 1.07 0 00-.497.88c0 .543.467.974 1.033.974.116 0 .23-.014.342-.04 1.047-.246 2.008-.374 2.857-.374.534 0 1.02.046 1.441.134.643.135 1.208.44 1.677.905 1.007 1.001 2.262 1.509 3.722 1.509 1.46 0 2.715-.508 3.722-1.509.47-.465 1.034-.77 1.677-.905.421-.089.908-.134 1.44-.134.85 0 1.81.128 2.858.374.112.026.226.04.342.04.566 0 1.033-.431 1.033-.974 0-.347-.192-.666-.497-.88a6.09 6.09 0 01-1.587-1.5c-.43-.587-.658-1.24-.658-1.89 0-.523.146-.937.44-1.23.02-.02.246-.142.644-.142.199 0 .413.037.636.114.32.112.668.164 1.008.152.344-.012.664-.088.934-.226.325-.165.515-.461.515-.808 0-.663-.773-1.26-1.695-2.138a4.56 4.56 0 01-.418-.82 4.56 4.56 0 01-.245-.694c.725-.068 1.405-.371 1.815-.82.117-.127.154-.32.097-.495-.056-.174-.2-.294-.36-.294-.087 0-.174.039-.25.113a1.63 1.63 0 01-1.087.422c-.258 0-.512-.063-.73-.183.202-.859.302-1.725.302-2.596C20.832 4.2 18.062.024 12.166.024z"/>
        </svg>
      ),
      href: `https://www.snapchat.com/scan?attachmentUrl=${encoded}`,
      bg: 'bg-[#FFFC00] hover:bg-yellow-300 text-black',
    },
  ];

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore
    }
  }

  async function nativeShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: eventTitle, text, url: eventUrl });
      } catch {
        // user cancelled
      }
    }
  }

  const hasNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  return (
    <div className="border-t pt-4">
      <p className="mb-3 text-sm font-medium text-muted-foreground">Sdílet s přáteli:</p>
      <div className="flex flex-wrap gap-2">
        {channels.map((ch) => (
          <a
            key={ch.label}
            href={ch.href}
            target="_blank"
            rel="noreferrer noopener"
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${ch.bg}`}
            aria-label={`Sdílet přes ${ch.label}`}
          >
            {ch.icon}
            {ch.label}
          </a>
        ))}
        <button
          onClick={() => void copyLink()}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Link2 className="h-4 w-4" />}
          {copied ? 'Zkopírováno!' : 'Kopírovat odkaz'}
        </button>
        {hasNativeShare && (
          <button
            onClick={() => void nativeShare()}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
          >
            Sdílet...
          </button>
        )}
      </div>
    </div>
  );
}

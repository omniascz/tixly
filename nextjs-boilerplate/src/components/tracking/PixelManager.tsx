'use client';
/**
 * Universal Pixel Manager — injects all configured tracking pixels for an event.
 * Fetches /api/public/events/[eventId]/pixels and renders scripts via next/script.
 * Supports 30 pixel types from pixel-registry.ts.
 */

import Script from 'next/script';
import { useEffect, useState } from 'react';
import { PIXEL_REGISTRY, type PixelEventData } from '@/lib/tracking/pixel-registry';

interface PixelEntry {
  platform: string;
  pixelId: string;
  events: string[];
  config: Record<string, string>;
}

interface Props {
  eventId: string;
  pageEvent: 'ViewContent' | 'InitiateCheckout' | 'Purchase';
  eventData?: PixelEventData;
}

export function PixelManager({ eventId, pageEvent, eventData }: Props) {
  const [pixels, setPixels] = useState<PixelEntry[]>([]);

  useEffect(() => {
    void fetch(`/api/public/events/${eventId}/pixels`)
      .then((r) => r.json())
      .then((d: { pixels?: PixelEntry[] }) => setPixels(d.pixels ?? []));
  }, [eventId]);

  const active = pixels.filter((p) => p.events.includes(pageEvent));

  return (
    <>
      {active.map((p) => {
        const reg = PIXEL_REGISTRY[p.platform];
        if (!reg) return null;
        let script: string | null = null;
        try {
          script = reg.buildScript(p.pixelId, p.config ?? {}, pageEvent, eventData);
        } catch {
          return null;
        }
        if (!script) return null;
        const safeId = `tixly-px-${p.platform}-${p.pixelId.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
        return (
          <Script
            key={safeId}
            id={safeId}
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{ __html: script }}
          />
        );
      })}
    </>
  );
}

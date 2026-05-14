'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * LiveRegion — aria-live announcement region.
 *
 * Použití pro screen reader announcements (loading, success, error toast).
 *
 *   <LiveRegion>{message}</LiveRegion>
 *
 * Politeness 'polite' = počká až user dokončí current task.
 * 'assertive' = okamžitě (jen pro errors / kritické).
 */

export function LiveRegion({
  children,
  politeness = 'polite',
  atomic = true,
}: {
  children: React.ReactNode;
  politeness?: 'polite' | 'assertive';
  atomic?: boolean;
}) {
  return (
    <div
      aria-live={politeness}
      aria-atomic={atomic}
      className="sr-only"
      role={politeness === 'assertive' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

/**
 * Hook pro programmatické announcements bez UI.
 *   const announce = useAnnouncer();
 *   announce('Vstupenka přidána do košíku');
 */
export function useAnnouncer(): (message: string, politeness?: 'polite' | 'assertive') => void {
  const [, setMessage] = useState('');
  const regionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let region = document.getElementById('tixly-live-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'tixly-live-region';
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'true');
      region.className = 'sr-only';
      document.body.appendChild(region);
    }
    regionRef.current = region as HTMLDivElement;
  }, []);

  return function announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
    if (regionRef.current) {
      regionRef.current.setAttribute('aria-live', politeness);
      regionRef.current.textContent = '';
      // Trigger re-announce by clearing first
      setTimeout(() => {
        if (regionRef.current) regionRef.current.textContent = message;
      }, 50);
    }
    setMessage(message);
  };
}

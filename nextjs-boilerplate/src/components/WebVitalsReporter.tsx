'use client';

import { useReportWebVitals } from 'next/web-vitals';

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    // Best-effort: navigator.sendBeacon pokud dostupný (nezablokuje navigation)
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      navigationType: metric.navigationType,
      url: window.location.href,
      rating: metric.rating,
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/internal/web-vitals', body);
    } else {
      void fetch('/api/internal/web-vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => null);
    }
  });
  return null;
}

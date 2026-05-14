'use client';

/**
 * hCaptcha widget wrapper. Loaduje hCaptcha JS přes <script> tag,
 * renderuje widget do daného containeru, volá `onVerify` s tokenem.
 *
 * Sitekey z env `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`. Pokud chybí, widget se nerendruje
 * (dev/mock mode — server-side také akceptuje neexistující secret jako pass).
 *
 * Použití:
 *   <HCaptchaWidget onVerify={(token) => setCaptchaToken(token)} />
 *
 * Token pak posíláš v body POSTu na server, server volá verifyHCaptcha().
 */

import { useEffect, useRef, useState } from 'react';

interface HCaptchaApi {
  render: (
    container: HTMLElement | string,
    opts: {
      sitekey: string;
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      theme?: 'light' | 'dark';
      size?: 'normal' | 'compact' | 'invisible';
    },
  ) => string;
  reset: (widgetId?: string) => void;
  execute: (widgetId?: string) => void;
}

declare global {
  interface Window {
    hcaptcha?: HCaptchaApi;
    onHCaptchaLoad?: () => void;
  }
}

interface Props {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  theme?: 'light' | 'dark';
  size?: 'normal' | 'compact';
}

export function HCaptchaWidget({ onVerify, onExpire, theme = 'light', size = 'normal' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;

  useEffect(() => {
    if (!siteKey) return;
    if (window.hcaptcha) {
      setScriptLoaded(true);
      return;
    }
    if (document.querySelector('script[data-hcaptcha]')) return;

    const script = document.createElement('script');
    script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=onHCaptchaLoad';
    script.async = true;
    script.defer = true;
    script.setAttribute('data-hcaptcha', '1');
    window.onHCaptchaLoad = () => setScriptLoaded(true);
    document.head.appendChild(script);
  }, [siteKey]);

  useEffect(() => {
    if (!scriptLoaded || !siteKey || !containerRef.current || !window.hcaptcha) return;
    if (widgetIdRef.current) return;
    widgetIdRef.current = window.hcaptcha.render(containerRef.current, {
      sitekey: siteKey,
      callback: onVerify,
      'expired-callback': onExpire,
      'error-callback': onExpire,
      theme,
      size,
    });
  }, [scriptLoaded, siteKey, onVerify, onExpire, theme, size]);

  if (!siteKey) {
    return (
      <p className="text-xs text-muted-foreground">
        CAPTCHA disabled (NEXT_PUBLIC_HCAPTCHA_SITE_KEY není nastaven).
      </p>
    );
  }

  return <div ref={containerRef} />;
}

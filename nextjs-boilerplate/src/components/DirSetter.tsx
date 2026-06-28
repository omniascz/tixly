'use client';

import { useEffect } from 'react';
import { isRtlLocale } from '@/lib/i18n';

export function DirSetter({ locale }: { locale: string }) {
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('lang', locale);
    el.setAttribute('dir', isRtlLocale(locale) ? 'rtl' : 'ltr');
  }, [locale]);

  return null;
}

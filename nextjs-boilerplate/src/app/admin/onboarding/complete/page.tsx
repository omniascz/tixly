'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function OnboardingCompletePage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.push('/admin/events');
    }, 3000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="text-5xl">🎉</div>
      <h1 className="text-2xl font-bold">Nastaveni dokonceno.</h1>
      <p className="text-muted-foreground">Vas prvni termin je pripraveno.</p>
      <p className="text-sm text-muted-foreground">Presmerovasani na predstaveni…</p>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { launchFeatureEnabled } from '@/lib/features/launch-flags';

// Kolo 10 / krok 3: předplatné je pro první ostrý provoz vypnuté (aktivace bez platby) — stránky vrací 404.
export const dynamic = 'force-dynamic';

export default function SubscriptionsFeatureLayout({ children }: { children: React.ReactNode }) {
  if (!launchFeatureEnabled('subscriptions')) notFound();
  return children;
}

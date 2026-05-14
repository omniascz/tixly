import { Metadata } from 'next';
import { EventsMapClient } from './EventsMapClient';

export const metadata: Metadata = {
  title: 'Akce na mapě — Tixly',
};

export default async function EventsMapPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-bold">Akce na mapě</h1>
        <p className="text-sm text-muted-foreground">
          Najdi koncerty, divadla, festivaly a kulturní akce v okolí.
        </p>
      </div>
      <EventsMapClient locale={locale} />
    </div>
  );
}

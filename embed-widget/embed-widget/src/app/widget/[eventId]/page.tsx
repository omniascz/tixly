import { notFound } from 'next/navigation';
import { TicketWidget } from '../../../components/TicketWidget';
import type { WidgetEvent } from '../../../types/widget.types';

interface Props {
  params: { eventId: string };
  searchParams: { locale?: string; color?: string };
}

// Stránka se renderuje uvnitř iframe na tixly.cz/widget/[eventId].
// Nemá žádný layout (header, footer) — jen čistý widget.
export default async function WidgetPage({ params, searchParams }: Props) {
  const { eventId } = params;

  // Validace eventId
  if (!eventId || !/^[a-zA-Z0-9_-]{1,100}$/.test(eventId)) {
    notFound();
  }

  // Načtení dat z API (same-origin, bez CORS)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/widget/${eventId}`, {
    next: { revalidate: 30 },  // ISR: refresh každých 30s
  });

  if (!res.ok) notFound();

  const event: WidgetEvent = await res.json();
  const color = sanitizeColor(searchParams.color);

  return (
    <html lang={searchParams.locale ?? 'cs'}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{event.name} — Tixly</title>
        <style>{`
          * { box-sizing: border-box; }
          body { margin: 0; background: transparent; }
        `}</style>
      </head>
      <body>
        <TicketWidget event={event} color={color} />
      </body>
    </html>
  );
}

// Povolíme pouze validní hex barvy (#rrggbb nebo #rgb), vše ostatní ignorujeme.
function sanitizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^#[0-9a-fA-F]{3,6}$/.test(value) ? value : undefined;
}

/**
 * /[locale]/my-tickets/[ticketId]/attendee
 *
 * Buyer self-service: edit attendee info per ticket (jméno/email/telefon).
 * Eventbrite "Each attendee" mode.
 */
import type { JSX } from 'react';
import { AttendeeEditClient } from './AttendeeEditClient';


interface Props {
  params: Promise<{ locale: string; ticketId: string }>;
}

export default async function AttendeeEditPage({ params }: Props): Promise<JSX.Element> {
  const { locale, ticketId } = await params;
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Údaje na lístku</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Tyto údaje uvidí pořadatel u brány. U akcí s kontrolou totožnosti se musí shodovat s dokladem.
      </p>
      <AttendeeEditClient ticketId={ticketId} locale={locale} />
    </div>
  );
}

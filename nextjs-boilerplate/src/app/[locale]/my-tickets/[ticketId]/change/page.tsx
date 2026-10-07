/**
 * /[locale]/my-tickets/[ticketId]/change
 *
 * Buyer self-service ticket swap (typ / akce / datum).
 * Eventbrite Ticket Changes parita.
 */
import type { JSX } from 'react';
import { ChangeTicketClient } from './ChangeTicketClient';


interface Props {
  params: Promise<{ locale: string; ticketId: string }>;
}

export default async function ChangeTicketPage({ params }: Props): Promise<JSX.Element> {
  const { locale, ticketId } = await params;
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Změna lístku</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Můžeš si vyměnit typ lístku za jiný v rámci stejné akce. Pokud nový lístek stojí víc,
        doplatíš rozdíl. Pokud méně, vrátíme ti přeplatek.
      </p>
      <ChangeTicketClient ticketId={ticketId} locale={locale} />
    </div>
  );
}

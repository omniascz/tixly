/**
 * /[locale]/my-tickets/[ticketId]/cancel-order
 *
 * Buyer self-service cancel order.
 * Eventbrite parita.
 */
import { CancelOrderClient } from './CancelOrderClient';

interface Props {
  params: Promise<{ locale: string; ticketId: string }>;
}

export default async function CancelOrderPage({ params }: Props): Promise<JSX.Element> {
  const { locale, ticketId } = await params;
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Zrušit objednávku</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Zrušíš celou objednávku — všechny lístky se zneplatní. Refund se řídí pravidly pořadatele
        a deadline před akcí.
      </p>
      <CancelOrderClient ticketId={ticketId} locale={locale} />
    </div>
  );
}

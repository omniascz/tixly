import { LiveQrClient } from './LiveQrClient';
import { TicketRights } from './TicketRights';

export const dynamic = 'force-dynamic';

export default async function TicketShowPage(
  props: {
    params: Promise<{ locale: string; ticketId: string }>;
  }
) {
  const params = await props.params;
  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <LiveQrClient ticketId={params.ticketId} locale={params.locale} />
      <TicketRights ticketId={params.ticketId} />
    </div>
  );
}

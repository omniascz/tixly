import { LiveQrClient } from './LiveQrClient';

export const dynamic = 'force-dynamic';

export default function TicketShowPage({
  params,
}: {
  params: { locale: string; ticketId: string };
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <LiveQrClient ticketId={params.ticketId} locale={params.locale} />
    </div>
  );
}

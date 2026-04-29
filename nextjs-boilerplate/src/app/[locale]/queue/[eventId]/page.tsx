import { QueueWaiter } from './QueueWaiter';

export const dynamic = 'force-dynamic';

export default function QueuePage({
  params,
  searchParams,
}: {
  params: { locale: string; eventId: string };
  searchParams: { token?: string; ticketTypeId?: string };
}) {
  return (
    <div className="mx-auto max-w-md py-12">
      <QueueWaiter
        eventId={params.eventId}
        locale={params.locale}
        initialToken={searchParams.token ?? null}
        ticketTypeId={searchParams.ticketTypeId ?? null}
      />
    </div>
  );
}

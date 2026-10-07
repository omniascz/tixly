import { QueueWaiter } from './QueueWaiter';

export const dynamic = 'force-dynamic';

export default async function QueuePage(
  props: {
    params: Promise<{ locale: string; eventId: string }>;
    searchParams: Promise<{ token?: string; ticketTypeId?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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

import { SeatPicker } from './SeatPicker';

export const dynamic = 'force-dynamic';

export default function SeatPickerPage({
  params,
  searchParams,
}: {
  params: { locale: string; id: string };
  searchParams: { ticketTypeId?: string; eventDayId?: string };
}) {
  return (
    <div className="space-y-4 py-6">
      <h1 className="text-2xl font-bold">Vyber sedadla</h1>
      <SeatPicker
        eventId={params.id}
        locale={params.locale}
        ticketTypeId={searchParams.ticketTypeId ?? null}
        eventDayId={searchParams.eventDayId ?? null}
      />
    </div>
  );
}

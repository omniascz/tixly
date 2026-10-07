import { SeatPicker } from './SeatPicker';

export const dynamic = 'force-dynamic';

export default async function SeatPickerPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
    searchParams: Promise<{ ticketTypeId?: string; eventDayId?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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

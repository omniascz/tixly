import { CategoryCheckout } from './CategoryCheckout';

export const dynamic = 'force-dynamic';

export default function SeatCategoriesPage({
  params,
  searchParams,
}: {
  params: { locale: string; id: string };
  searchParams: { token?: string; seats?: string };
}) {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">Vstupenky na vybraná místa</h1>
      <CategoryCheckout
        eventId={params.id}
        locale={params.locale}
        holdToken={searchParams.token ?? ''}
        seatIds={(searchParams.seats ?? '').split(',').filter(Boolean)}
      />
    </div>
  );
}

import { CategoryCheckout } from './CategoryCheckout';

export const dynamic = 'force-dynamic';

export default async function SeatCategoriesPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
    searchParams: Promise<{ token?: string; seats?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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

import { MyTicketsClient } from './MyTicketsClient';

export const dynamic = 'force-dynamic';

export default function MyTicketsPage({ params }: { params: { locale: string } }) {
  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="mb-6 text-2xl font-bold">Moje lístky</h1>
      <MyTicketsClient locale={params.locale} />
    </div>
  );
}

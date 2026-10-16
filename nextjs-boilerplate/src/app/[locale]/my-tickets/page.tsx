import { MyTicketsClient } from './MyTicketsClient';

export const dynamic = 'force-dynamic';

export default async function MyTicketsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="mb-6 text-2xl font-bold">Moje lístky</h1>
      <MyTicketsClient locale={params.locale} />
    </div>
  );
}

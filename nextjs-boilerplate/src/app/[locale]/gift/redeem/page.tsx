import { GiftRedeemClient } from './GiftRedeemClient';

export const dynamic = 'force-dynamic';

export default async function GiftRedeemPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ token?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  return (
    <div className="mx-auto max-w-md py-12">
      <h1 className="mb-4 text-2xl font-bold">Dárkový lístek 🎁</h1>
      {searchParams.token ? (
        <GiftRedeemClient token={searchParams.token} locale={params.locale} />
      ) : (
        <p className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          Chybí token v URL.
        </p>
      )}
    </div>
  );
}

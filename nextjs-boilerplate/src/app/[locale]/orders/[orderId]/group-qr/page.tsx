import { GroupQrClient } from './GroupQrClient';

export const metadata = { title: 'Skupinový QR — Tixly' };

export default async function GroupQrPage(
  props: {
    params: Promise<{ locale: string; orderId: string }>;
  }
) {
  const params = await props.params;
  return (
    <div className="py-4">
      <h1 className="mb-4 text-2xl font-bold">Skupinový vstup</h1>
      <GroupQrClient orderId={params.orderId} locale={params.locale} />
    </div>
  );
}

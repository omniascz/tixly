import { GroupQrClient } from './GroupQrClient';

export const metadata = { title: 'Skupinový QR — Tixly' };

export default function GroupQrPage({
  params,
}: {
  params: { locale: string; orderId: string };
}) {
  return (
    <div className="py-4">
      <h1 className="mb-4 text-2xl font-bold">Skupinový vstup</h1>
      <GroupQrClient orderId={params.orderId} locale={params.locale} />
    </div>
  );
}

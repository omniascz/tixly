import { Metadata } from 'next';
import { SmsTicketClient } from './SmsTicketClient';

export const metadata: Metadata = {
  title: 'SMS vstupenka — Tixly',
  robots: { index: false, follow: false },
};

export default async function SmsTicketPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-md p-4">
      <SmsTicketClient token={token} />
    </div>
  );
}

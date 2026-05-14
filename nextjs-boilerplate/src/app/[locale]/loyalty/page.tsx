import { Metadata } from 'next';
import { LoyaltyClient } from './LoyaltyClient';

export const metadata: Metadata = {
  title: 'Moje body — Tixly',
};

export default async function LoyaltyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Moje Tixly body</h1>
        <p className="text-sm text-muted-foreground">
          Za každý nákup získáváš body. 1 bod = 1 Kč sleva v dalším nákupu (max 50 % z objednávky).
        </p>
      </div>
      <LoyaltyClient locale={locale} />
    </div>
  );
}

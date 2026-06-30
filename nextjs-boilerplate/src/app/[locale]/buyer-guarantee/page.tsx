import type { Metadata } from 'next';
import { BuyerGuarantee } from '@/components/BuyerGuarantee';

export const metadata: Metadata = {
  title: 'Záruka Tixly — bezpečný nákup vstupenek',
  description:
    'Každý nákup na Tixly je krytý: okamžité doručení lístku, platný vstup, shoda s objednávkou a vrácení peněz při zrušení akce.',
};

export default function BuyerGuaranteePage({
  params,
}: {
  params: { locale: string };
}): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl py-10">
      <BuyerGuarantee variant="full" locale={params.locale} />
    </div>
  );
}

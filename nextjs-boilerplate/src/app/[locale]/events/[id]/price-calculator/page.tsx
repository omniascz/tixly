/**
 * /[locale]/events/[id]/price-calculator — public Eventim-style kalkulačka.
 *
 * Fanoušek si předem spočítá, kolik zaplatí na různých kanálech.
 * No login required.
 */
import type { JSX } from 'react';
import { PriceCalculator } from './PriceCalculator';


interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function PriceCalculatorPage({ params }: PageProps): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <h1 className="mb-2 text-2xl font-bold">Cenová kalkulačka</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Spočítej si, kolik zaplatíš včetně všech poplatků na různých prodejních kanálech.
      </p>
      <PriceCalculator eventId={id} />
    </div>
  );
}

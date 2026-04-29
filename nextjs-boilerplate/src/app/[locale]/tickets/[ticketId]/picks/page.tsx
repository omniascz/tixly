import { FlexPassPicker } from './FlexPassPicker';

export const dynamic = 'force-dynamic';

export default function FlexPassPickerPage({
  params,
}: {
  params: { locale: string; ticketId: string };
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-8">
      <h1 className="text-2xl font-bold">Vyber termíny flex passu</h1>
      <p className="text-sm text-muted-foreground">
        Tento pass funguje na principu „vyber N z M termínů". Před uzávěrkou si
        zvol přesné dny, na které chceš dorazit.
      </p>
      <FlexPassPicker ticketId={params.ticketId} locale={params.locale} />
    </div>
  );
}

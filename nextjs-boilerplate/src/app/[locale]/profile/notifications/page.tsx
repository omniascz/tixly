import { NotificationPreferencesClient } from './NotificationPreferencesClient';

export const dynamic = 'force-dynamic';

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="mb-4 text-2xl font-bold">Oznámení</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Nastav, jak ti chceme posílat zprávy. Transakční emaily (potvrzení nákupu) odesíláme vždy.
      </p>
      <NotificationPreferencesClient />
    </div>
  );
}

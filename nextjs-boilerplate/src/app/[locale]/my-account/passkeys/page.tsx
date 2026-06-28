/**
 * /[locale]/my-account/passkeys — správa passkeys (WebAuthn) přihlášeného uživatele
 */
import { PasskeyManager } from '@/components/passkey-manager';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function PasskeysPage({ params: _params }: Props): Promise<JSX.Element> {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Passkeys</h1>
      <p className="mb-2 text-sm text-muted-foreground">
        Passkeys nahrazují hesla a umožňují přihlášení otiskem prstu, Face ID nebo PIN zařízení.
        Jsou uloženy přímo v tvojém zařízení nebo iCloud / Google Password Manageru — nikde na serveru.
      </p>
      <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        <strong>Jak to funguje:</strong> při přihlášení tě prohlížeč vyzve k ověření passkey místo hesla.
        Passkey je kryptografický klíč — nelze odcizit ani uhádnout.
      </div>
      <PasskeyManager />
    </div>
  );
}

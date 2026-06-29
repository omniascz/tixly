'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface VerifStatus {
  fanIdVerified: boolean;
  latest: {
    id: string;
    legal_name: string;
    document_type: string;
    status: 'pending' | 'approved' | 'rejected';
    submitted_at: string;
    reviewed_at: string | null;
    reviewer_notes: string | null;
  } | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: 'Čeká na ověření', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: '⏳' },
  approved: { label: 'Ověřeno', color: 'text-green-700 bg-green-50 border-green-200', icon: '✅' },
  rejected: { label: 'Zamítnuto', color: 'text-red-700 bg-red-50 border-red-200', icon: '❌' },
};

export default function FanIdPage() {
  const [status, setStatus] = useState<VerifStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form fields
  const [legalName, setLegalName] = useState('');
  const [documentType, setDocumentType] = useState('id_card');

  useEffect(() => {
    fetch('/api/my/identity-verification')
      .then((r) => r.json())
      .then((d: VerifStatus) => setStatus(d))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [success]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch('/api/my/identity-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legalName, documentType }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.error === 'ALREADY_VERIFIED') setError('Váš účet je již ověřen.');
        else if (d.error === 'PENDING_REVIEW') setError('Žádost o ověření již čeká na zpracování.');
        else setError('Nastala chyba. Zkuste to prosím znovu.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Nastala síťová chyba.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-lg px-4 py-20 text-center text-muted-foreground">Načítám…</div>;
  }

  const verif = status?.latest;

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-bold">Fan ID — Ověření identity</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Fan ID umožňuje bezpečný nákup vstupenek na resale trhu a pomáhá chránit
        kupující i pořadatele před podvody a překupníky.
      </p>

      {/* Stav */}
      {status?.fanIdVerified ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-semibold text-green-800">Váš Fan ID je ověřen</p>
            <p className="text-sm text-green-700">Můžete nakupovat i prodávat vstupenky na resale trhu.</p>
          </div>
        </div>
      ) : null}

      {verif && !status?.fanIdVerified ? (
        <div className={`mt-6 rounded-xl border p-4 ${STATUS_CONFIG[verif.status]?.color ?? ''}`}>
          <div className="flex items-center gap-2">
            <span className="text-xl">{STATUS_CONFIG[verif.status]?.icon}</span>
            <p className="font-semibold">{STATUS_CONFIG[verif.status]?.label}</p>
          </div>
          <p className="mt-1 text-sm">
            Žádost podána: {new Date(verif.submitted_at).toLocaleDateString('cs-CZ')}
          </p>
          {verif.status === 'pending' ? (
            <p className="mt-1 text-sm">Ověření obvykle trvá 1–2 pracovní dny.</p>
          ) : null}
          {verif.status === 'rejected' ? (
            <>
              {verif.reviewer_notes ? (
                <p className="mt-1 text-sm font-medium">Důvod: {verif.reviewer_notes}</p>
              ) : null}
              <p className="mt-2 text-sm">Můžete podat novou žádost s opravenými údaji.</p>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Formulář — jen pokud není approved/pending */}
      {!status?.fanIdVerified && verif?.status !== 'pending' ? (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">
            {verif?.status === 'rejected' ? 'Podat novou žádost' : 'Podat žádost o ověření'}
          </h2>

          <div>
            <label htmlFor="legal-name" className="text-sm font-medium">Celé jméno dle dokladu *</label>
            <Input
              id="legal-name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Jan Novák"
              required
              minLength={2}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Uveďte jméno přesně tak, jak je uvedeno na vašem dokladu totožnosti.
            </p>
          </div>

          <div>
            <label htmlFor="doc-type" className="text-sm font-medium">Typ dokladu *</label>
            <select
              id="doc-type"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="id_card">Občanský průkaz</option>
              <option value="passport">Cestovní pas</option>
              <option value="driving_licence">Řidičský průkaz</option>
            </select>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <p className="font-medium">ℹ️ Aktuálně — soft ověření</p>
            <p className="mt-0.5">
              V současné fázi stačí zadat vaše jméno. Plné ověření dokladem (foto, selfie)
              bude spuštěno před zákonnou povinností dle EU FanID regulace.
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {success ? (
            <p className="text-sm text-green-700">
              Žádost odeslána. Ověření provedeme do 1–2 pracovních dnů.
            </p>
          ) : null}

          <Button type="submit" disabled={submitting || !legalName.trim()} className="w-full">
            {submitting ? 'Odesílám…' : 'Podat žádost o Fan ID'}
          </Button>
        </form>
      ) : null}

      <div className="mt-8 text-xs text-muted-foreground">
        Vaše osobní údaje jsou zpracovávány v souladu s GDPR. Slouží výhradně k ověření
        identity pro účely bezpečného resale trhu. Nejsou sdíleny s třetími stranami.
      </div>
    </div>
  );
}

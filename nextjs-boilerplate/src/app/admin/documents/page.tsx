'use client';

import { useEffect, useState } from 'react';

interface SigningRequest {
  id: string;
  document_type: string;
  signer_email: string;
  signer_name: string;
  status: string;
  provider: string;
  signing_url: string | null;
  signed_at: string | null;
  expires_at: string;
  created_at: string;
  document_hash: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Čeká',
  sent: 'Odesláno',
  viewed: 'Zobrazeno',
  signed: 'Podepsáno',
  rejected: 'Odmítnuto',
  expired: 'Vypršelo',
};
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  sent: 'bg-blue-100 text-blue-800',
  viewed: 'bg-indigo-100 text-indigo-800',
  signed: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  expired: 'bg-orange-100 text-orange-800',
};
const DOC_TYPE_LABEL: Record<string, string> = {
  promoter_agreement: 'Smlouva o poskytování služeb',
  reseller_agreement: 'Smlouva resellerského partnera',
  custom: 'Vlastní dokument',
};

export default function DocumentsPage() {
  const [requests, setRequests] = useState<SigningRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [docType, setDocType] = useState<'promoter_agreement' | 'reseller_agreement'>('promoter_agreement');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerName, setSignerName] = useState('');
  const [result, setResult] = useState<{ signingUrl: string; documentHash: string } | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    const r = await fetch('/api/admin/qes/sign-request');
    if (r.ok) {
      const d = await r.json() as { requests: SigningRequest[] };
      setRequests(d.requests);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr('');
    setResult(null);
    const r = await fetch('/api/admin/qes/sign-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentType: docType,
        signerEmail: signerEmail || undefined,
        signerName: signerName || undefined,
      }),
    });
    const d = await r.json() as { signingUrl?: string; documentHash?: string; error?: string };
    if (r.ok && d.signingUrl) {
      setResult({ signingUrl: d.signingUrl, documentHash: d.documentHash! });
      setShowForm(false);
      await load();
    } else {
      setErr(d.error ?? 'Chyba při vytváření žádosti.');
    }
    setCreating(false);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dokumenty k podpisu</h1>
          <p className="text-slate-500 text-sm mt-1">
            Elektronický podpis dle eIDAS EU 910/2014 (QES/AES)
          </p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setResult(null); setErr(''); }}
          className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Nový dokument
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Vytvořit žádost o podpis</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Typ dokumentu</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as typeof docType)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="promoter_agreement">Smlouva o poskytování služeb (promotér)</option>
                <option value="reseller_agreement">Smlouva resellerského partnera</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                E-mail podepisujícího <span className="text-slate-400">(volitelné — default: váš email)</span>
              </label>
              <input
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="např. partner@firma.cz"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Jméno podepisujícího <span className="text-slate-400">(volitelné)</span>
              </label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Jméno a příjmení nebo název firmy"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={creating}
                className="bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {creating ? 'Generuji dokument…' : 'Vygenerovat a odeslat'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-5 py-2 border rounded-lg text-sm text-slate-600 hover:bg-slate-50"
              >
                Zrušit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-3">
          <div className="font-semibold text-emerald-900">Žádost vytvořena</div>
          <div className="text-sm text-slate-700">
            Email s odkazem byl odeslán podepisujícímu. Odkaz pro podpis:
          </div>
          <a
            href={result.signingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Otevřít podpisový portál →
          </a>
          <div className="text-xs font-mono text-slate-500 break-all">
            SHA-256: {result.documentHash}
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Načítám…</div>
      ) : requests.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">📄</div>
          <div>Zatím žádné dokumenty k podpisu</div>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div key={req.id} className="bg-white border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-900">
                    {DOC_TYPE_LABEL[req.document_type] ?? req.document_type}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[req.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {STATUS_LABEL[req.status] ?? req.status}
                  </span>
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                    {req.provider}
                  </span>
                </div>
                <div className="text-sm text-slate-600 mt-0.5">
                  {req.signer_name} · {req.signer_email}
                </div>
                <div className="text-xs text-slate-400 mt-0.5 font-mono">
                  {req.document_hash.slice(0, 12)}… ·{' '}
                  {new Date(req.created_at).toLocaleDateString('cs-CZ')}
                  {req.signed_at && ` · Podepsáno ${new Date(req.signed_at).toLocaleDateString('cs-CZ')}`}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {req.signing_url && req.status !== 'signed' && req.status !== 'rejected' && req.status !== 'expired' && (
                  <a
                    href={req.signing_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100"
                  >
                    Otevřít
                  </a>
                )}
                {req.status === 'signed' && (
                  <span className="text-sm text-emerald-600 font-medium">✓ Podepsáno</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div className="bg-slate-50 border rounded-xl p-4 text-sm text-slate-600 space-y-1">
        <div className="font-semibold text-slate-700">O eIDAS QES</div>
        <div>Kvalifikovaný elektronický podpis (QES) má stejnou právní váhu jako vlastnoruční podpis v celé EU.</div>
        <div>Provider: <strong>{process.env.NEXT_PUBLIC_QES_PROVIDER ?? 'mock'}</strong> ·{' '}
          Pro produkci nastavte <code>QES_PROVIDER=docusign</code> a příslušné klíče.</div>
      </div>
    </div>
  );
}

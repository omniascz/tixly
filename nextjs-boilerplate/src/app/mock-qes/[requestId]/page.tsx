'use client';

/**
 * Mock QES Signing Page
 * Simuluje prostředí QTSP (např. DocuSign EU, Signicat) pro development a demo.
 * V produkci je nahrazena reálným QTSP portálem.
 */

import { useEffect, useRef, useState, use } from 'react';

type Phase =
  | 'loading'
  | 'preview'
  | 'otp_sent'
  | 'otp_verify'
  | 'signing'
  | 'signed'
  | 'rejected'
  | 'error'
  | 'expired';

interface RequestData {
  id: string;
  documentType: string;
  documentHash: string;
  pdfBase64: string | null;
  signerEmail: string;
  signerName: string;
  expiresAt: string;
}

const DOC_TYPE_LABEL: Record<string, string> = {
  promoter_agreement: 'Smlouva o poskytování služeb',
  reseller_agreement: 'Smlouva resellerského partnera',
  custom: 'Dokument k podpisu',
};

export default function MockQESPage(props: { params: Promise<{ requestId: string }> }) {
  const params = use(props.params);
  const { requestId } = params;
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<RequestData | null>(null);
  const [otp, setOtp] = useState('');
  const [mockOtp] = useState(() => String(Math.floor(100000 + Math.random() * 900000)));
  const [error, setError] = useState('');
  const [proof, setProof] = useState<Record<string, string> | null>(null);
  const pdfRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch(`/api/mock-qes/${requestId}`)
      .then((r) => r.json())
      .then((d: RequestData & { error?: string; status?: string }) => {
        if (d.error) {
          setPhase(d.status === 'expired' ? 'expired' : d.status === 'signed' ? 'signed' : 'error');
          setError(d.error);
        } else {
          setData(d);
          setPhase('preview');
        }
      })
      .catch(() => { setPhase('error'); setError('Nepodařilo se načíst dokument.'); });
  }, [requestId]);

  async function handleSendOtp() {
    setPhase('otp_sent');
    await new Promise((r) => setTimeout(r, 800));
    setPhase('otp_verify');
  }

  async function handleVerifyOtp() {
    if (otp.trim() !== mockOtp) {
      setError('Nesprávný kód. Zkuste znovu.');
      return;
    }
    setError('');
    setPhase('signing');
    await new Promise((r) => setTimeout(r, 2200));

    const res = await fetch(`/api/mock-qes/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sign', otp }),
    });
    const d = await res.json() as { ok?: boolean; proof?: Record<string, string>; error?: string };
    if (d.ok) {
      setProof(d.proof ?? null);
      setPhase('signed');
    } else {
      setPhase('error');
      setError(d.error ?? 'Chyba při podpisu.');
    }
  }

  async function handleReject() {
    await fetch(`/api/mock-qes/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    });
    setPhase('rejected');
  }

  const docLabel = data ? (DOC_TYPE_LABEL[data.documentType] ?? 'Dokument') : 'Dokument';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col items-center py-8 px-4">
      {/* Header — QTSP branding */}
      <div className="w-full max-w-3xl mb-6">
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border px-6 py-4">
          <div className="w-10 h-10 rounded-lg bg-blue-700 flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <div className="font-semibold text-slate-900">Tixly QES Portal</div>
            <div className="text-xs text-slate-500">Kvalifikovaný elektronický podpis · eIDAS EU 910/2014</div>
          </div>
          <div className="ml-auto">
            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-medium">
              DEMO / MOCK QTSP
            </span>
          </div>
        </div>
      </div>

      {/* Main card */}
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-md border overflow-hidden">

        {/* Loading */}
        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <div>Načítám dokument…</div>
          </div>
        )}

        {/* Expired */}
        {phase === 'expired' && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-8">
            <div className="text-5xl">⏰</div>
            <div className="text-xl font-semibold text-slate-800">Odkaz pro podpis vypršel</div>
            <div className="text-slate-500">Platnost tohoto odkazu již skončila. Kontaktujte prosím odesílatele.</div>
          </div>
        )}

        {/* Error */}
        {(phase === 'error') && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-8">
            <div className="text-5xl">⚠️</div>
            <div className="text-xl font-semibold text-slate-800">Nastala chyba</div>
            <div className="text-slate-500">{error}</div>
          </div>
        )}

        {/* Rejected */}
        {phase === 'rejected' && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-8">
            <div className="text-5xl">✋</div>
            <div className="text-xl font-semibold text-slate-800">Podpis odmítnut</div>
            <div className="text-slate-500">Dokument nebyl podepsán. Odesílatel byl informován.</div>
          </div>
        )}

        {/* Signed */}
        {phase === 'signed' && (
          <div className="flex flex-col items-center py-12 gap-6 px-8 text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg className="w-12 h-12 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">Dokument podepsán</div>
              <div className="text-slate-500 mt-1">Elektronický podpis byl úspěšně aplikován.</div>
            </div>

            {proof && (
              <div className="w-full text-left bg-slate-50 rounded-xl border p-5 text-sm font-mono space-y-1">
                <div className="font-sans font-semibold text-slate-700 mb-3">Potvrzení podpisu</div>
                {proof.signatureLevel && (
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-36">Úroveň:</span>
                    <span className="font-semibold text-blue-700">{proof.signatureLevel} (eIDAS)</span>
                  </div>
                )}
                {proof.signedAt && (
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-36">Čas podpisu:</span>
                    <span>{new Date(proof.signedAt).toLocaleString('cs-CZ')}</span>
                  </div>
                )}
                {proof.certificateSubject && (
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-36">Certifikát:</span>
                    <span>{proof.certificateSubject}</span>
                  </div>
                )}
                {proof.certificateIssuer && (
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-36">Vydavatel:</span>
                    <span>{proof.certificateIssuer}</span>
                  </div>
                )}
                {proof.certificateSerial && (
                  <div className="flex gap-2">
                    <span className="text-slate-400 w-36">S/N:</span>
                    <span>{proof.certificateSerial}</span>
                  </div>
                )}
              </div>
            )}

            <div className="text-xs text-slate-400">
              Podepsaný dokument byl doručen odesílateli. Zavřete toto okno.
            </div>
          </div>
        )}

        {/* Preview — show document */}
        {(phase === 'preview' || phase === 'otp_sent' || phase === 'otp_verify' || phase === 'signing') && data && (
          <div className="flex flex-col">
            {/* Document header */}
            <div className="px-6 py-5 border-b bg-slate-50">
              <div className="font-semibold text-slate-900 text-lg">{docLabel}</div>
              <div className="text-sm text-slate-500 mt-0.5">
                Podepisující: <strong>{data.signerName}</strong> · {data.signerEmail}
              </div>
              <div className="text-xs text-slate-400 mt-1 font-mono">
                SHA-256: {data.documentHash.slice(0, 16)}…{data.documentHash.slice(-8)}
              </div>
            </div>

            {/* PDF preview */}
            {data.pdfBase64 ? (
              <div className="relative bg-slate-200" style={{ height: 480 }}>
                <iframe
                  ref={pdfRef}
                  src={`data:application/pdf;base64,${data.pdfBase64}`}
                  className="w-full h-full"
                  title="Dokument k podpisu"
                />
                {(phase === 'signing') && (
                  <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center gap-4">
                    <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <div className="text-slate-700 font-medium">Aplikuji kvalifikovaný podpis…</div>
                    <div className="text-xs text-slate-400">Prověřuji certifikát přes OCSP · TSA timestamp</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
                (Náhled dokumentu není k dispozici)
              </div>
            )}

            {/* Action area */}
            <div className="px-6 py-5 border-t space-y-4">
              {phase === 'preview' && (
                <>
                  <div className="text-sm text-slate-600">
                    Přečtěte si dokument a potvrďte svou identitu pro podpis.
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleSendOtp}
                      className="flex-1 bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 rounded-lg transition-colors"
                    >
                      Ověřit identitu a podepsat
                    </button>
                    <button
                      onClick={handleReject}
                      className="px-5 py-3 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50"
                    >
                      Odmítnout
                    </button>
                  </div>
                  <div className="text-xs text-slate-400 text-center">
                    Podpisem souhlasíte s obsahem dokumentu. Podpis je právně závazný dle eIDAS.
                  </div>
                </>
              )}

              {phase === 'otp_sent' && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <div className="text-slate-600">Odesílám ověřovací kód na {data.signerEmail}…</div>
                </div>
              )}

              {phase === 'otp_verify' && (
                <div className="space-y-4">
                  <div className="text-sm text-slate-700 font-medium">
                    Zadejte ověřovací kód odeslaný na {data.signerEmail}
                  </div>
                  {/* Mock OTP hint */}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800">
                    <strong>Mock QTSP:</strong> váš kód je <strong className="font-mono text-lg">{mockOtp}</strong>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => { setOtp(e.target.value); setError(''); }}
                    placeholder="000000"
                    className="w-full text-center font-mono text-2xl tracking-widest border-2 rounded-lg py-3 focus:border-blue-600 outline-none"
                  />
                  {error && <div className="text-sm text-red-600">{error}</div>}
                  <button
                    onClick={handleVerifyOtp}
                    disabled={otp.length < 6}
                    className="w-full bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
                  >
                    Potvrdit a podepsat
                  </button>
                </div>
              )}

              {phase === 'signing' && (
                <div className="text-center text-sm text-slate-500 py-2">
                  Probíhá aplikace elektronického podpisu…
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* eIDAS badge */}
      <div className="mt-4 text-xs text-slate-400 text-center">
        Tato stránka simuluje prostředí QTSP · Nařízení EU 910/2014 (eIDAS) · AES/QES úroveň
      </div>
    </div>
  );
}

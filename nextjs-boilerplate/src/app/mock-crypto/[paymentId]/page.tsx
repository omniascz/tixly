'use client';

/**
 * Mock krypto platební brána (Triple-A style — AXS parity).
 * Výběr BTC/ETH → zobrazí adresu + QR → kupec "zaplatí" → on-chain potvrzení (mock).
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Coin = 'BTC' | 'ETH';
type Phase = 'select' | 'awaiting' | 'confirming' | 'success' | 'error';

interface OrderInfo { amount: number; currency: string; eventTitle: string | null; status: string }

const ORANGE = '#F7931A'; // bitcoin orange
const ETH_BLUE = '#627EEA';

// Demo adresy (nefunkční — jen vizuál)
const ADDR: Record<Coin, string> = {
  BTC: 'bc1qxy2demo0tixly9z8k4f7s3r6mq2v8n0p4w7c5x',
  ETH: '0xTixlyDemo7A3f9B2c1E8d4F6a0C5b9D2e7F1a3B6c',
};
// Demo směnný kurz (jen pro zobrazení částky v coinu)
const RATE: Record<Coin, number> = { BTC: 2_400_000, ETH: 85_000 }; // Kč za 1 coin (demo)

function fmtFiat(halire: number, currency: string): string {
  const amt = halire / 100;
  if (currency === 'CZK') return amt.toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
  return amt.toLocaleString('cs-CZ', { style: 'currency', currency });
}

function FakeQR({ size = 150 }: { size?: number }) {
  const cells = 23;
  const cell = size / cells;
  const pattern = Array.from({ length: cells }, (_, r) =>
    Array.from({ length: cells }, (_, c) => {
      if ((r < 7 && c < 7) || (r < 7 && c > cells - 8) || (r > cells - 8 && c < 7)) return 1;
      return (r * 17 + c * 11 + r * c) % 3 === 0 ? 1 : 0;
    }),
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} fill="white" />
      {pattern.map((row, r) =>
        row.map((f, c) => (f ? <rect key={`${r}-${c}`} x={c * cell + 1} y={r * cell + 1} width={cell - 1} height={cell - 1} fill="#111" /> : null)),
      )}
    </svg>
  );
}

export default function MockCryptoPage() {
  const params = useParams();
  const router = useRouter();
  const paymentId = String(params.paymentId);

  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [coin, setCoin] = useState<Coin>('BTC');
  const [phase, setPhase] = useState<Phase>('select');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/mock-crypto/${paymentId}`)
      .then((r) => r.json())
      .then((d: OrderInfo & { error?: string }) => { if (!d.error) setOrder(d); })
      .catch(() => null);
  }, [paymentId]);

  const coinAmount = order ? (order.amount / 100 / RATE[coin]) : 0;
  const accent = coin === 'BTC' ? ORANGE : ETH_BLUE;

  async function confirmPaid() {
    setPhase('confirming');
    try {
      const r = await fetch(`/api/mock-crypto/${paymentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay', coin }),
      });
      const d = (await r.json()) as { status?: string; orderId?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? String(r.status));
      setPhase('success');
      setTimeout(() => router.push(`/cs/order-confirmation/${d.orderId}`), 1600);
    } catch (e) {
      setPhase('error');
      setErrorMsg(e instanceof Error ? e.message : 'Neznámá chyba');
    }
  }

  async function cancel() {
    try {
      await fetch(`/api/mock-crypto/${paymentId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', coin }),
      });
    } catch { /* ignore */ }
    router.back();
  }

  const card: React.CSSProperties = { maxWidth: 420, margin: '48px auto', background: '#fff', borderRadius: 20, boxShadow: '0 4px 32px rgba(0,0,0,0.12)', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' };
  const btn = (bg: string): React.CSSProperties => ({ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: bg, color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginTop: 12 });
  const outline: React.CSSProperties = { width: '100%', padding: 12, borderRadius: 12, border: '1.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginTop: 8 };

  return (
    <div style={card}>
      <div style={{ background: `linear-gradient(135deg, ${accent}, #1a1a2e)`, padding: '22px 24px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 26 }}>{coin === 'BTC' ? '₿' : 'Ξ'}</span>
          <span style={{ fontWeight: 800, fontSize: 20 }}>Krypto platba</span>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.85 }}>Powered by Triple-A · on-chain settlement</p>
      </div>

      <div style={{ padding: 24 }}>
        {order && (
          <div style={{ textAlign: 'center', padding: 16, background: '#F9FAFB', borderRadius: 12, marginBottom: 18 }}>
            <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>{order.eventTitle ?? 'Vstupenka'}</p>
            <p style={{ fontSize: 30, fontWeight: 900, color: '#111', margin: '4px 0 0' }}>{fmtFiat(order.amount, order.currency)}</p>
          </div>
        )}

        {phase === 'select' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              {(['BTC', 'ETH'] as Coin[]).map((c) => (
                <button key={c} onClick={() => setCoin(c)}
                  style={{ flex: 1, padding: 12, borderRadius: 10, cursor: 'pointer', fontWeight: 700,
                    border: coin === c ? `2px solid ${c === 'BTC' ? ORANGE : ETH_BLUE}` : '1.5px solid #E5E7EB',
                    background: coin === c ? (c === 'BTC' ? '#FFF7ED' : '#EEF2FF') : '#fff',
                    color: c === 'BTC' ? ORANGE : ETH_BLUE }}>
                  {c === 'BTC' ? '₿ Bitcoin' : 'Ξ Ethereum'}
                </button>
              ))}
            </div>
            <button style={btn(accent)} onClick={() => setPhase('awaiting')}>Pokračovat → {coin}</button>
            <button style={outline} onClick={() => void cancel()}>Zrušit</button>
          </>
        )}

        {phase === 'awaiting' && order && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 6 }}>Pošli přesně tuto částku na adresu:</p>
            <p style={{ fontSize: 22, fontWeight: 900, color: accent, margin: '0 0 12px' }}>
              {coinAmount.toFixed(coin === 'BTC' ? 6 : 5)} {coin}
            </p>
            <div style={{ display: 'inline-block', padding: 10, border: '2px solid #E5E7EB', borderRadius: 12 }}><FakeQR size={150} /></div>
            <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#374151', wordBreak: 'break-all', background: '#F3F4F6', padding: '8px 10px', borderRadius: 8, margin: '12px 0' }}>{ADDR[coin]}</p>
            <p style={{ fontSize: 11, color: '#9CA3AF' }}>Po potvrzení v síti ({coin === 'BTC' ? '~10 min' : '~15 s'}) ti vystavíme vstupenky.</p>
            <button style={btn(accent)} onClick={() => void confirmPaid()}>Odeslal jsem platbu →</button>
            <button style={outline} onClick={() => void cancel()}>Zrušit</button>
          </div>
        )}

        {phase === 'confirming' && (
          <div style={{ textAlign: 'center', padding: '28px 0' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', border: `6px solid #F3F4F6`, borderTop: `6px solid ${accent}`, margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ fontWeight: 700, color: accent }}>Ověřuji transakci on-chain…</p>
          </div>
        )}

        {phase === 'success' && (
          <div style={{ textAlign: 'center', padding: '28px 0' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>✅</div>
            <p style={{ fontWeight: 800, fontSize: 20, color: '#065F46' }}>Platba potvrzena!</p>
            <p style={{ color: '#6B7280', fontSize: 14, marginTop: 6 }}>Přesměrovávám na potvrzení…</p>
          </div>
        )}

        {phase === 'error' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <p style={{ fontWeight: 700, color: '#991B1B' }}>Chyba</p>
            <p style={{ fontSize: 13, color: '#6B7280', marginTop: 6 }}>{errorMsg}</p>
            <button style={outline} onClick={() => router.back()}>Zpět</button>
          </div>
        )}

        <p style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
          Demo mode · V produkci Triple-A hosted checkout + on-chain webhook · směnný kurz fixován při platbě
        </p>
      </div>
    </div>
  );
}

'use client';

/**
 * Mock Wero A2A platební stránka.
 * Simuluje reálný EPI Wero flow: zadání telefonu → push notifikace bance →
 * SEPA Instant settlement (∼5 s) → potvrzení.
 * Alternativa: QR kód pro banking app.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Tab = 'phone' | 'qr';
type Phase =
  | 'idle'          // zadání telefonu / zobrazení QR
  | 'sending'       // "Odesílám request do banky…"
  | 'waiting'       // countdown SEPA Instant (5 s)
  | 'success'       // zelená fajfka
  | 'rejected'      // odmítnuto
  | 'error';

interface OrderInfo {
  amount: number;
  currency: string;
  eventTitle: string | null;
  status: string;
}

const WERO_PURPLE = '#6D28D9';
const WERO_LIGHT  = '#EDE9FE';

function formatAmount(halire: number, currency: string): string {
  const amt = halire / 100;
  if (currency === 'CZK') return amt.toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
  return amt.toLocaleString('cs-CZ', { style: 'currency', currency });
}

/** Pseudo QR — mřížka čtverečků, vizuálně věrohodná ale nefunkční */
function FakeQR({ size = 160 }: { size?: number }) {
  const cells = 21;
  const cell = size / cells;
  // Deterministická pseudonáhoda pro konzistentní zobrazení
  const pattern = Array.from({ length: cells }, (_, r) =>
    Array.from({ length: cells }, (_, c) => {
      if ((r < 7 && c < 7) || (r < 7 && c > cells - 8) || (r > cells - 8 && c < 7)) return 1; // rohové značky
      return ((r * 13 + c * 7 + r * c) % 3 === 0) ? 1 : 0;
    }),
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} fill="white" />
      {pattern.map((row, r) =>
        row.map((filled, c) =>
          filled ? (
            <rect
              key={`${r}-${c}`}
              x={c * cell + 1}
              y={r * cell + 1}
              width={cell - 1}
              height={cell - 1}
              fill="#1a1a1a"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

function WeroLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `linear-gradient(135deg, ${WERO_PURPLE}, #4C1D95)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 900,
          fontSize: 18,
          letterSpacing: -1,
        }}
      >
        W
      </div>
      <span style={{ fontWeight: 800, fontSize: 22, color: WERO_PURPLE, letterSpacing: -0.5 }}>
        Wero
      </span>
    </div>
  );
}

export default function MockWeroPage() {
  const params = useParams();
  const router = useRouter();
  const paymentId = String(params.paymentId);

  const [tab, setTab] = useState<Tab>('phone');
  const [phase, setPhase] = useState<Phase>('idle');
  const [phone, setPhone] = useState('+420 ');
  const [countdown, setCountdown] = useState(5);
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Načtení informací o objednávce
  useEffect(() => {
    void fetch(`/api/mock-wero/${paymentId}`)
      .then((r) => r.json())
      .then((d: OrderInfo & { error?: string }) => {
        if (!d.error) setOrder(d);
      })
      .catch(() => null);
  }, [paymentId]);

  // Spuštění A2A flow
  async function startFlow() {
    setPhase('sending');
    // Simulace: request do banky (1 s)
    await delay(1000);
    setPhase('waiting');
    setCountdown(5);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current!);
          void settle();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function settle() {
    try {
      const r = await fetch(`/api/mock-wero/${paymentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay' }),
      });
      const d = (await r.json()) as { status?: string; orderId?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? String(r.status));
      setPhase('success');
      setTimeout(() => { router.push(`/cs/order-confirmation/${d.orderId}`); }, 1500);
    } catch (e) {
      setPhase('error');
      setErrorMsg(e instanceof Error ? e.message : 'Neznámá chyba');
    }
  }

  async function reject() {
    setPhase('sending');
    try {
      await fetch(`/api/mock-wero/${paymentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
    } catch { /* ignore */ }
    setPhase('rejected');
  }

  function delay(ms: number) {
    return new Promise<void>((res) => setTimeout(res, ms));
  }

  // ─── Styles (inline pro izolaci od global CSS) ───────────────────────────────

  const card: React.CSSProperties = {
    maxWidth: 400,
    margin: '48px auto',
    background: '#fff',
    borderRadius: 20,
    boxShadow: '0 4px 32px rgba(109,40,217,0.12)',
    overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
  };

  const header: React.CSSProperties = {
    background: `linear-gradient(135deg, ${WERO_PURPLE} 0%, #4C1D95 100%)`,
    padding: '24px 24px 20px',
    color: '#fff',
  };

  const body: React.CSSProperties = { padding: '24px' };

  const amountBox: React.CSSProperties = {
    textAlign: 'center',
    padding: '16px',
    background: WERO_LIGHT,
    borderRadius: 12,
    marginBottom: 20,
  };

  const tabBar: React.CSSProperties = {
    display: 'flex',
    gap: 0,
    background: '#F3F4F6',
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 0',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    background: active ? '#fff' : 'transparent',
    color: active ? WERO_PURPLE : '#6B7280',
    boxShadow: active ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
    transition: 'all 0.15s',
  });

  const primaryBtn: React.CSSProperties = {
    width: '100%',
    padding: '14px',
    borderRadius: 12,
    border: 'none',
    background: WERO_PURPLE,
    color: '#fff',
    fontWeight: 700,
    fontSize: 16,
    cursor: 'pointer',
    marginTop: 16,
  };

  const outlineBtn: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    borderRadius: 12,
    border: `1.5px solid #E5E7EB`,
    background: '#fff',
    color: '#6B7280',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    marginTop: 8,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1.5px solid #D1D5DB',
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: 1,
    boxSizing: 'border-box',
    outline: 'none',
  };

  // ─── Fáze UI ─────────────────────────────────────────────────────────────────

  function renderPhase() {
    if (phase === 'sending') {
      return (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📡</div>
          <p style={{ fontWeight: 700, fontSize: 16, color: WERO_PURPLE }}>
            Odesílám platební request…
          </p>
          <p style={{ color: '#6B7280', fontSize: 14, marginTop: 8 }}>
            Kontaktujeme tvoji banku přes SEPA Instant
          </p>
        </div>
      );
    }

    if (phase === 'waiting') {
      return (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              border: `6px solid ${WERO_LIGHT}`,
              borderTop: `6px solid ${WERO_PURPLE}`,
              margin: '0 auto 20px',
              animation: 'spin 1s linear infinite',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ fontWeight: 700, fontSize: 18, color: WERO_PURPLE }}>
            Čekám na potvrzení banky
          </p>
          <div
            style={{
              fontSize: 48,
              fontWeight: 900,
              color: WERO_PURPLE,
              margin: '12px 0',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {countdown}
          </div>
          <p style={{ color: '#6B7280', fontSize: 13 }}>
            SEPA Instant transfer — typicky 5–10 sekund
          </p>
          <div
            style={{
              marginTop: 16,
              padding: '10px 16px',
              background: '#FEF3C7',
              borderRadius: 10,
              fontSize: 13,
              color: '#92400E',
            }}
          >
            📱 Ve tvé banking appce se objevila push notifikace
          </div>
        </div>
      );
    }

    if (phase === 'success') {
      return (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: '#D1FAE5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 36,
              margin: '0 auto 16px',
            }}
          >
            ✅
          </div>
          <p style={{ fontWeight: 800, fontSize: 20, color: '#065F46' }}>Platba proběhla!</p>
          <p style={{ color: '#6B7280', fontSize: 14, marginTop: 8 }}>Přesměrovávám na potvrzení…</p>
        </div>
      );
    }

    if (phase === 'rejected') {
      return (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
          <p style={{ fontWeight: 700, fontSize: 16, color: '#991B1B' }}>Platba odmítnuta</p>
          <p style={{ color: '#6B7280', fontSize: 13, marginTop: 8 }}>
            Vrátíme tě zpět na výběr platby.
          </p>
          <button style={outlineBtn} onClick={() => router.back()}>
            Zpět
          </button>
        </div>
      );
    }

    if (phase === 'error') {
      return (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <p style={{ fontWeight: 700, color: '#991B1B' }}>Chyba při zpracování</p>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 8 }}>{errorMsg}</p>
          <button style={outlineBtn} onClick={() => router.back()}>Zpět</button>
        </div>
      );
    }

    // idle — phone nebo QR
    return (
      <>
        <div style={tabBar}>
          <button style={tabBtn(tab === 'phone')} onClick={() => setTab('phone')}>
            📱 Telefonem
          </button>
          <button style={tabBtn(tab === 'qr')} onClick={() => setTab('qr')}>
            📷 QR kódem
          </button>
        </div>

        {tab === 'phone' ? (
          <div>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 8 }}>
              Zadej telefonní číslo spojené s tvým bankovním účtem. Banka ti pošle push notifikaci.
            </p>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={inputStyle}
              placeholder="+420 777 000 111"
              autoComplete="tel"
            />
            <div style={{ marginTop: 10, fontSize: 12, color: '#9CA3AF', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['Air Bank', 'ČSOB', 'Komerční banka', 'Raiffeisen', 'Fio banka', 'mBank'].map((b) => (
                <span
                  key={b}
                  style={{ padding: '2px 8px', background: '#F3F4F6', borderRadius: 6, fontSize: 11 }}
                >
                  {b}
                </span>
              ))}
            </div>
            <button
              style={{
                ...primaryBtn,
                opacity: phone.trim().length < 9 ? 0.5 : 1,
              }}
              disabled={phone.trim().length < 9}
              onClick={() => void startFlow()}
            >
              Zaplatit přes Wero →
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
              Naskenuj QR kód ve své banking appce a potvrď platbu.
            </p>
            <div
              style={{
                display: 'inline-block',
                padding: 12,
                background: '#fff',
                border: '2px solid #E5E7EB',
                borderRadius: 12,
                marginBottom: 16,
              }}
            >
              <FakeQR size={160} />
            </div>
            <p style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>
              QR kód je platný 10 minut
            </p>
            <button style={primaryBtn} onClick={() => void startFlow()}>
              Potvrdil jsem v banking appce →
            </button>
          </div>
        )}

        <button style={outlineBtn} onClick={() => void reject()}>
          Zrušit platbu
        </button>

        <p
          style={{
            fontSize: 11,
            color: '#9CA3AF',
            textAlign: 'center',
            marginTop: 16,
            lineHeight: 1.5,
          }}
        >
          Demo mode · Wero je iniciativa EPI (European Payments Initiative) ·
          V produkci proběhne SEPA Instant přes certifikované banky
        </p>
      </>
    );
  }

  return (
    <div style={card}>
      {/* Header */}
      <div style={header}>
        <WeroLogo />
        <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.85 }}>
          Okamžitá platba z účtu na účet
        </p>
      </div>

      {/* Body */}
      <div style={body}>
        {/* Částka */}
        {order && (
          <div style={amountBox}>
            <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
              {order.eventTitle ?? 'Vstupenka'}
            </p>
            <p
              style={{
                fontSize: 32,
                fontWeight: 900,
                color: WERO_PURPLE,
                margin: '4px 0 0',
              }}
            >
              {formatAmount(order.amount, order.currency)}
            </p>
            <p style={{ fontSize: 11, color: '#9CA3AF', margin: '2px 0 0' }}>
              Příjemce: Tixly s.r.o.
            </p>
          </div>
        )}

        {renderPhase()}
      </div>
    </div>
  );
}

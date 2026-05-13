'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/scanner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, eventCode }),
      });
      if (!res.ok) {
        setError('Přihlášení selhalo.');
        return;
      }
      const data = (await res.json()) as { token: string; eventId: string };
      localStorage.setItem('scanner_token', data.token);
      localStorage.setItem('scanner_event_id', data.eventId);
      router.push('/scanner');
    } catch {
      setError('Chyba sítě.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ color: '#6C47FF' }}>Přihlášení</h1>
      <form onSubmit={handleSubmit}>
        <label style={labelStyle}>E-mail</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <label style={labelStyle}>Kód akce</label>
        <input
          type="text"
          required
          value={eventCode}
          onChange={(e) => setEventCode(e.target.value)}
          style={inputStyle}
        />
        {error && <p style={{ color: '#ff4646' }}>{error}</p>}
        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? 'Přihlašuji…' : 'Přihlásit'}
        </button>
      </form>
    </main>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', marginTop: 16, marginBottom: 4 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 12,
  fontSize: 16,
  borderRadius: 8,
  border: '1px solid #444',
  background: '#111',
  color: '#fff',
};
const btnStyle: React.CSSProperties = {
  marginTop: 24,
  padding: '12px 24px',
  background: '#6C47FF',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 16,
  cursor: 'pointer',
  width: '100%',
};

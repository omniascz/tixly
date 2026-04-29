'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [eventId, setEventId] = useState('');
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(!!localStorage.getItem('scanner_token'));
  }, []);

  const handleStart = () => {
    if (!eventId.trim()) return;
    localStorage.setItem('scanner_event_id', eventId.trim());
    router.push('/scanner');
  };

  return (
    <main style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ color: '#6C47FF' }}>Tixly Scanner</h1>
      {!hasToken ? (
        <>
          <p>Nejste přihlášeni.</p>
          <button onClick={() => router.push('/login')} style={btnStyle}>
            Přihlásit se
          </button>
        </>
      ) : (
        <>
          <label style={{ display: 'block', marginBottom: 8 }}>
            ID akce
          </label>
          <input
            type="text"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="evt_..."
            style={inputStyle}
          />
          <button onClick={handleStart} style={btnStyle}>
            Spustit skenování
          </button>
        </>
      )}
    </main>
  );
}

const btnStyle: React.CSSProperties = {
  marginTop: 16,
  padding: '12px 24px',
  background: '#6C47FF',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 16,
  cursor: 'pointer',
  width: '100%',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 12,
  fontSize: 16,
  borderRadius: 8,
  border: '1px solid #444',
  background: '#111',
  color: '#fff',
};

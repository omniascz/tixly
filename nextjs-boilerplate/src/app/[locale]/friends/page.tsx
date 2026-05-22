'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Friend {
  userId: string;
  email: string;
  name: string | null;
  friendsSince: string;
}

interface IncomingRequest {
  requestId: string;
  fromEmail: string;
  fromName: string | null;
  message: string | null;
  sentAt: string;
}

interface OutgoingRequest {
  requestId: string;
  toEmail: string;
  toName: string | null;
  sentAt: string;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function FriendsPage(): JSX.Element {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([]);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    try {
      const [fr, rq] = await Promise.all([
        authFetch('/api/social/friends'),
        authFetch('/api/social/friend-requests'),
      ]);
      if (fr.ok) {
        const data = (await fr.json()) as { friends: Friend[] };
        setFriends(data.friends);
      }
      if (rq.ok) {
        const data = (await rq.json()) as {
          incoming: IncomingRequest[];
          outgoing: OutgoingRequest[];
        };
        setIncoming(data.incoming);
        setOutgoing(data.outgoing);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function sendRequest(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await authFetch('/api/social/friends', {
        method: 'POST',
        body: JSON.stringify({
          targetEmail: email,
          message: message || undefined,
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(b.message ?? b.error ?? `HTTP ${r.status}`);
        return;
      }
      setSuccess('Žádost odeslána.');
      setEmail('');
      setMessage('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function respond(requestId: string, action: 'accept' | 'decline'): Promise<void> {
    const r = await authFetch(`/api/social/friend-requests/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (r.ok) {
      setSuccess(action === 'accept' ? 'Přijato.' : 'Odmítnuto.');
      await load();
    }
  }

  async function cancel(requestId: string): Promise<void> {
    const r = await authFetch(`/api/social/friend-requests/${requestId}`, {
      method: 'DELETE',
    });
    if (r.ok) await load();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-3xl font-bold">Přátelé na Tixly</h1>
        <p className="text-sm text-muted-foreground">
          Sleduj, kam tvoji přátelé jdou. Při výběru akce uvidíš „X přátel jde".
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Přidat přítele</CardTitle>
          <CardDescription>Zadej email — musí být registrovaný na Tixly.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void sendRequest(e)} className="space-y-3">
            <Input
              type="email"
              placeholder="kamarad@example.cz"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="friend-email"
            />
            <Input
              placeholder="Zpráva (volitelné)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={300}
            />
            <Button type="submit" disabled={busy || !email} data-testid="send-friend-request">
              {busy ? 'Odesílám…' : 'Odeslat žádost'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {incoming.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Přijaté žádosti ({incoming.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {incoming.map((r) => (
              <div
                key={r.requestId}
                className="flex items-center justify-between gap-2 rounded-md border p-2"
                data-testid={`incoming-${r.requestId}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.fromName ?? r.fromEmail}</div>
                  {r.message ? (
                    <div className="truncate text-xs text-muted-foreground">{r.message}</div>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  onClick={() => void respond(r.requestId, 'accept')}
                  data-testid={`accept-${r.requestId}`}
                >
                  Přijmout
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void respond(r.requestId, 'decline')}
                >
                  Odmítnout
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Tvoji přátelé ({friends.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {friends.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím žádní přátelé. Pošli první žádost!
            </p>
          ) : (
            <div className="space-y-1">
              {friends.map((f) => (
                <div
                  key={f.userId}
                  className="rounded-md border p-2 text-sm"
                  data-testid={`friend-${f.userId}`}
                >
                  <div className="font-medium">{f.name ?? f.email}</div>
                  <div className="text-xs text-muted-foreground">
                    Přáteli od {new Date(f.friendsSince).toLocaleDateString('cs-CZ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {outgoing.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Odeslané žádosti ({outgoing.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {outgoing.map((r) => (
              <div
                key={r.requestId}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <div>
                  Čeká: <strong>{r.toName ?? r.toEmail}</strong>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void cancel(r.requestId)}
                >
                  Zrušit
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

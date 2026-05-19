'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Member {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  created_at: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  invited_by_email: string;
  created_at: string;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'staff'>('staff');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await authFetch('/api/admin/team');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { members: Member[]; invites: Invite[] };
      setMembers(j.members);
      setInvites(j.invites);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/admin/team', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        id?: string;
        inviteUrl?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(`Pozvánka odeslána na ${inviteEmail}.`);
      setInviteEmail('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    setError(null);
    const res = await authFetch(`/api/admin/team/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    await load();
  }

  async function removeMember(userId: string) {
    if (!confirm('Opravdu odstranit člena z týmu?')) return;
    setError(null);
    const res = await authFetch(`/api/admin/team/${userId}`, { method: 'DELETE' });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tým"
        description="Pozvi členy týmu a nastav jejich oprávnění. Owner může pozvat / měnit role / odstranit."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Pozvat člena</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={invite} className="flex flex-wrap items-center gap-2">
            <Input
              type="email"
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="max-w-xs"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'staff')}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="admin">Admin</option>
              <option value="staff">Staff (scanner / read-only)</option>
            </select>
            <Button type="submit" disabled={busy || !inviteEmail}>
              {busy ? 'Posílám…' : 'Pozvat'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Členové týmu ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím jen ty.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">E-mail</th>
                  <th>Jméno</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="text-right">Akce</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id} className="border-b">
                    <td className="py-2">{m.email}</td>
                    <td>{m.name ?? '—'}</td>
                    <td>
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.user_id, e.target.value)}
                        className="rounded border bg-background px-2 py-1 text-xs"
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="staff">Staff</option>
                      </select>
                    </td>
                    <td>
                      <span
                        className={
                          m.status === 'active'
                            ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800'
                            : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800'
                        }
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => removeMember(m.user_id)}
                        className="text-xs text-rose-700 hover:underline"
                      >
                        Odstranit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {invites.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Čekající pozvánky ({invites.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">E-mail</th>
                  <th>Role</th>
                  <th>Pozval</th>
                  <th>Vyprší</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className="border-b">
                    <td className="py-2">{i.email}</td>
                    <td>{i.role}</td>
                    <td className="text-xs text-muted-foreground">{i.invited_by_email}</td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(i.expires_at).toLocaleDateString('cs-CZ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

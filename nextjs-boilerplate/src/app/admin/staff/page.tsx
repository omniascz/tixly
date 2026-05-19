'use client';

import { FormEvent, useEffect, useState } from 'react';
import { UserCog, UserPlus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'staff';
  status: string;
  createdAt: string;
}

const ROLE_LABELS: Record<string, { label: string; tone: string; description: string }> = {
  owner: {
    label: 'Owner',
    tone: 'bg-violet-100 text-violet-800',
    description: 'Plná kontrola — výplaty, billing, staff management',
  },
  admin: {
    label: 'Admin',
    tone: 'bg-blue-100 text-blue-800',
    description: 'Spravovat akce, objednávky, marketing — bez billing',
  },
  staff: {
    label: 'Staff',
    tone: 'bg-slate-100 text-slate-700',
    description: 'Read-only přístup + scanner — bez editace',
  },
};

export default function StaffPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [currentRole, setCurrentRole] = useState<string>('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'staff'>('staff');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    const token = localStorage.getItem('accessToken');
    const r = await fetch('/api/admin/staff', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) {
      const d = (await r.json()) as { members: Member[]; currentUserId: string; currentRole: string };
      setMembers(d.members);
      setCurrentUserId(d.currentUserId);
      setCurrentRole(d.currentRole);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email, role }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.message ?? d.error ?? `HTTP ${r.status}`);
        return;
      }
      setFeedback(`Uživatel ${email} přidán jako ${ROLE_LABELS[role].label}.`);
      setEmail('');
      await reload();
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  async function handleChangeRole(member: Member, newRole: 'admin' | 'staff') {
    if (member.role === newRole) return;
    const token = localStorage.getItem('accessToken');
    const r = await fetch(`/api/admin/staff/${member.userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ role: newRole }),
    });
    if (r.ok) {
      setFeedback(`${member.email} → ${ROLE_LABELS[newRole].label}`);
      await reload();
    } else {
      const d = await r.json();
      setError(d.message ?? d.error);
    }
  }

  async function handleRemove(member: Member) {
    if (!window.confirm(`Odebrat ${member.email} z týmu?`)) return;
    const token = localStorage.getItem('accessToken');
    const r = await fetch(`/api/admin/staff/${member.userId}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) {
      setFeedback(`${member.email} odebrán.`);
      await reload();
    } else {
      const d = await r.json();
      setError(d.message ?? d.error);
    }
  }

  const isOwner = currentRole === 'owner';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Personál"
        description="Členové tvého týmu — owner, admin, scanner staff. Pro pozvánku potřebuješ email už registrovaného uživatele."
      />

      {feedback ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          {feedback}
        </p>
      ) : null}

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Pozvat člena</CardTitle>
            <CardDescription>
              Uživatel se musí nejdříve zaregistrovat na <code>/register</code>. Pak ho přidáš podle e-mailu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-48">
                <label className="mb-1 block text-xs font-medium">E-mail</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="kolega@firma.cz"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Role</label>
                <select
                  className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'staff')}
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Button type="submit" disabled={loading} className="gap-1">
                <UserPlus className="h-4 w-4" />
                {loading ? 'Přidávám…' : 'Pozvat'}
              </Button>
              {error ? (
                <p className="basis-full text-sm text-destructive">{error}</p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Tým ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
              <UserCog className="h-8 w-8" />
              Zatím žádní členové.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Uživatel</th>
                  <th>Role</th>
                  <th>Stav</th>
                  <th>Přidán</th>
                  {isOwner ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const labelInfo = ROLE_LABELS[m.role];
                  const isYou = m.userId === currentUserId;
                  return (
                    <tr key={m.userId} className="border-b">
                      <td className="py-2">
                        <div className="font-medium">
                          {m.name ?? m.email.split('@')[0]}
                          {isYou ? (
                            <span className="ml-2 text-xs text-muted-foreground">(ty)</span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </td>
                      <td>
                        {isOwner && !isYou && m.role !== 'owner' ? (
                          <select
                            className="h-8 rounded border border-input bg-background px-2 text-xs"
                            value={m.role}
                            onChange={(e) =>
                              handleChangeRole(m, e.target.value as 'admin' | 'staff')
                            }
                          >
                            <option value="admin">Admin</option>
                            <option value="staff">Staff</option>
                          </select>
                        ) : (
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${labelInfo?.tone ?? ''}`}
                          >
                            {labelInfo?.label ?? m.role}
                          </span>
                        )}
                        {labelInfo ? (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {labelInfo.description}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className="text-xs text-muted-foreground">{m.status}</span>
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {new Date(m.createdAt).toLocaleDateString('cs-CZ')}
                      </td>
                      {isOwner ? (
                        <td className="text-right">
                          {!isYou && m.role !== 'owner' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemove(m)}
                              className="text-rose-700 hover:bg-rose-50"
                              title="Odebrat"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

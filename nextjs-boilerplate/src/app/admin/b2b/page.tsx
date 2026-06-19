'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface B2BAccount {
  id: string;
  company_name: string;
  ico: string;
  dic: string | null;
  contact_email: string;
  billing_email: string | null;
  account_code: string;
  credit_balance_halire: string;
  monthly_limit_halire: string | null;
  status: string;
  created_at: string;
  user_count: string;
  computed_balance: string;
}

interface B2BUser {
  id: string;
  email: string;
  name: string;
  monthly_limit_halire: string | null;
  is_admin: boolean;
  joined_at: string | null;
  invite_token: string | null;
  created_at: string;
}

function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const token =
    typeof window !== 'undefined'
      ? (localStorage.getItem('accessToken') ?? '')
      : '';
  return fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  });
}

export default function B2BAccountsPage() {
  const [accounts, setAccounts] = useState<B2BAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [ico, setIco] = useState('');
  const [dic, setDic] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');

  const [depositAccountId, setDepositAccountId] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');

  const [usersAccountId, setUsersAccountId] = useState<string | null>(null);
  const [users, setUsers] = useState<B2BUser[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteIsAdmin, setInviteIsAdmin] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      const r = await authFetch('/api/admin/b2b');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { accounts: B2BAccount[] };
      setAccounts(d.accounts);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const r = await authFetch('/api/admin/b2b', {
        method: 'POST',
        body: JSON.stringify({
          companyName,
          ico,
          dic: dic || undefined,
          contactEmail,
          billingEmail: billingEmail || undefined,
          monthlyLimitHalire: monthlyLimit ? Math.round(parseFloat(monthlyLimit) * 100) : undefined,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFeedback('Firma vytvořena.');
      setShowCreate(false);
      setCompanyName(''); setIco(''); setDic(''); setContactEmail(''); setBillingEmail(''); setMonthlyLimit('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeposit(e: FormEvent) {
    e.preventDefault();
    if (!depositAccountId) return;
    setBusy(true);
    setFeedback(null);
    try {
      const amountHalire = Math.round(parseFloat(depositAmount) * 100);
      const r = await authFetch(`/api/admin/b2b/${depositAccountId}/deposit`, {
        method: 'POST',
        body: JSON.stringify({ amountHalire, note: depositNote || undefined }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { newBalance: number };
      setFeedback(`Dobito. Nový zůstatek: ${(d.newBalance / 100).toLocaleString('cs-CZ')} Kč`);
      setDepositAccountId(null);
      setDepositAmount('');
      setDepositNote('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openUsers(accountId: string) {
    setUsersAccountId(accountId);
    setUsers([]);
    try {
      const r = await authFetch(`/api/admin/b2b/${accountId}/users`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { users: B2BUser[] };
      setUsers(d.users);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!usersAccountId) return;
    setBusy(true);
    setFeedback(null);
    try {
      const r = await authFetch(`/api/admin/b2b/${usersAccountId}/users`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, name: inviteName, isAdmin: inviteIsAdmin }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { user: { id: string; invite_token: string } };
      setFeedback(`Pozvánka vytvořena. Token: ${d.user.invite_token}`);
      setInviteEmail(''); setInviteName(''); setInviteIsAdmin(false);
      await openUsers(usersAccountId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveUser(userId: string) {
    if (!usersAccountId) return;
    if (!confirm('Opravdu odebrat uživatele?')) return;
    setBusy(true);
    try {
      await authFetch(`/api/admin/b2b/${usersAccountId}/users`, {
        method: 'DELETE',
        body: JSON.stringify({ userId }),
      });
      await openUsers(usersAccountId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(account: B2BAccount) {
    const newStatus = account.status === 'active' ? 'suspended' : 'active';
    setBusy(true);
    try {
      await authFetch('/api/admin/b2b', {
        method: 'PATCH',
        body: JSON.stringify({ id: account.id, status: newStatus }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="B2B firemní účty" />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {feedback ? <p className="text-sm text-emerald-700">{feedback}</p> : null}

      <div className="flex justify-end">
        <Button onClick={() => setShowCreate((v) => !v)} variant="default">
          {showCreate ? 'Zrušit' : 'Přidat firmu'}
        </Button>
      </div>

      {showCreate ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Nová firma</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Název firmy *</label>
                <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">IČO *</label>
                <Input value={ico} onChange={(e) => setIco(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">DIČ</label>
                <Input value={dic} onChange={(e) => setDic(e.target.value)} placeholder="CZ12345678" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kontaktní email *</label>
                <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Fakturační email</label>
                <Input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Měsíční limit (Kč)</label>
                <Input type="number" min="0" step="1" value={monthlyLimit} onChange={(e) => setMonthlyLimit(e.target.value)} placeholder="neomezeno" />
              </div>
              <div className="col-span-full flex justify-end">
                <Button type="submit" disabled={busy}>Vytvořit</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {depositAccountId ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Dobití kreditu</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleDeposit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Částka (Kč) *</label>
                <Input type="number" min="1" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Poznámka</label>
                <Input value={depositNote} onChange={(e) => setDepositNote(e.target.value)} placeholder="Faktura č. 2026/001" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !depositAmount}>Dobít</Button>
                <Button type="button" variant="outline" onClick={() => setDepositAccountId(null)}>Zrušit</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {usersAccountId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Uživatelé — {accounts.find((a) => a.id === usersAccountId)?.company_name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {users.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Jméno</th>
                      <th className="px-3 py-2 text-left">Admin</th>
                      <th className="px-3 py-2 text-left">Připojil se</th>
                      <th className="px-3 py-2 text-left">Akce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-t">
                        <td className="px-3 py-2">{u.email}</td>
                        <td className="px-3 py-2">{u.name}</td>
                        <td className="px-3 py-2">{u.is_admin ? 'Ano' : 'Ne'}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {u.joined_at ? new Date(u.joined_at).toLocaleDateString('cs-CZ') : 'Čeká na přijetí'}
                        </td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void handleRemoveUser(u.id)}>
                            Odebrat
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Žádní uživatelé.</p>
            )}

            <div className="border-t pt-4">
              <p className="mb-2 text-sm font-medium">Přidat uživatele</p>
              <form onSubmit={handleInvite} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">Email *</label>
                  <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Jméno *</label>
                  <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} required />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="invite-admin" checked={inviteIsAdmin} onChange={(e) => setInviteIsAdmin(e.target.checked)} />
                  <label htmlFor="invite-admin" className="text-xs">Firemní admin (vidí transakce a zaměstnance)</label>
                </div>
                <div className="col-span-full flex gap-2">
                  <Button type="submit" disabled={busy}>Pozvat</Button>
                  <Button type="button" variant="outline" onClick={() => setUsersAccountId(null)}>Zavřít</Button>
                </div>
              </form>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="px-3 py-2 text-left">Firma</th>
              <th className="px-3 py-2 text-left">IČO</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-right">Kredit</th>
              <th className="px-3 py-2 text-right">Uživatelé</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Kód</th>
              <th className="px-3 py-2 text-left">Akce</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const balance = parseInt(a.credit_balance_halire, 10);
              return (
                <tr key={a.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{a.company_name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.ico}</td>
                  <td className="px-3 py-2 text-xs">{a.contact_email}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {(balance / 100).toLocaleString('cs-CZ')} Kč
                  </td>
                  <td className="px-3 py-2 text-right">{a.user_count}</td>
                  <td className="px-3 py-2">
                    <Badge variant={a.status === 'active' ? 'default' : 'destructive'} className="text-xs">
                      {a.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{a.account_code}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => { setDepositAccountId(a.id); setDepositAmount(''); setDepositNote(''); }}>
                        Dobít kredit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void openUsers(a.id)}>
                        Uživatelé
                      </Button>
                      <Button size="sm" variant={a.status === 'active' ? 'destructive' : 'default'} disabled={busy} onClick={() => void toggleStatus(a)}>
                        {a.status === 'active' ? 'Pozastavit' : 'Aktivovat'}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {accounts.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Žádné firemní účty.</p>
        ) : null}
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface AccountData {
  id: string;
  company_name: string;
  ico: string;
  contact_email: string;
  account_code: string;
  credit_balance_halire: string;
  monthly_limit_halire: string | null;
  status: string;
}

interface Transaction {
  id: string;
  type: string;
  amount_halire: string;
  balance_after: string;
  note: string | null;
  created_at: string;
  user_email: string | null;
  user_name: string | null;
}

interface User {
  id: string;
  email: string;
  name: string;
  monthly_limit_halire: string | null;
  is_admin: boolean;
  joined_at: string | null;
  created_at: string;
}

interface DashboardData {
  account: AccountData;
  spentThisMonthHalire: number;
  transactions: Transaction[];
  users: User[];
  isAdmin: boolean;
}

const typeLabelMap: Record<string, string> = {
  deposit: 'Dobití',
  purchase: 'Nákup',
  refund: 'Vrácení',
  adjustment: 'Úprava',
};

export default function B2BDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('b2bToken');
    if (!token) {
      router.replace('/b2b/login');
      return;
    }
    fetch('/api/b2b/account', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401) { router.replace('/b2b/login'); return null; }
        return r.json() as Promise<DashboardData>;
      })
      .then((d) => { if (d) setData(d); })
      .catch(() => setError('Nepodařilo se načíst data.'));
  }, [router]);

  if (error) return <p className="p-8 text-destructive">{error}</p>;
  if (!data) return <p className="p-8 text-muted-foreground">Načítám…</p>;

  const { account, spentThisMonthHalire, transactions, users, isAdmin } = data;
  const balance = parseInt(account.credit_balance_halire, 10);
  const userCount = isAdmin ? users.length : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{account.company_name}</h1>
        <Badge variant={account.status === 'active' ? 'default' : 'destructive'}>
          {account.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1 pt-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Kredit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-700">
              {(balance / 100).toLocaleString('cs-CZ')} Kč
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Utraceno tento měsíc</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {(spentThisMonthHalire / 100).toLocaleString('cs-CZ')} Kč
            </p>
          </CardContent>
        </Card>
        {userCount !== null ? (
          <Card>
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">Uživatelé</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{userCount}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Pro dobití kreditu kontaktujte Tixly na{' '}
        <a href="mailto:billing@tixly.cz" className="underline">billing@tixly.cz</a>{' '}
        nebo zašlete platbu na účet s poznámkou kódu účtu{' '}
        <strong>{account.account_code}</strong>.
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Transakce</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádné transakce.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Datum</th>
                  <th className="px-3 py-2 text-left">Typ</th>
                  <th className="px-3 py-2 text-right">Částka</th>
                  <th className="px-3 py-2 text-right">Zůstatek</th>
                  <th className="px-3 py-2 text-left">Zaměstnanec</th>
                  <th className="px-3 py-2 text-left">Poznámka</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const amount = parseInt(tx.amount_halire, 10);
                  const balanceAfter = parseInt(tx.balance_after, 10);
                  return (
                    <tr key={tx.id} className="border-t">
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(tx.created_at).toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={tx.type === 'deposit' ? 'default' : tx.type === 'refund' ? 'secondary' : 'outline'} className="text-xs">
                          {typeLabelMap[tx.type] ?? tx.type}
                        </Badge>
                      </td>
                      <td className={`px-3 py-2 text-right font-mono text-xs ${amount > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {amount > 0 ? '+' : ''}{(amount / 100).toLocaleString('cs-CZ')} Kč
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {(balanceAfter / 100).toLocaleString('cs-CZ')} Kč
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {tx.user_name ?? tx.user_email ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{tx.note ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin && users.length > 0 ? (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Zaměstnanci</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Jméno</th>
                  <th className="px-3 py-2 text-right">Limit/měsíc</th>
                  <th className="px-3 py-2 text-left">Datum přidání</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2 text-right text-xs font-mono">
                      {u.monthly_limit_halire ? `${(parseInt(u.monthly_limit_halire, 10) / 100).toLocaleString('cs-CZ')} Kč` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString('cs-CZ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

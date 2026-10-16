'use client';

import { useState } from 'react';
import { Wallet, Download } from 'lucide-react';
import Link from 'next/link';
import { DataTable, Column } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { PageHeader } from '@/components/admin/PageHeader';
import { StatCard } from '@/components/admin/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAdminPayouts } from '@/hooks/useAdminData';
import { formatCzk, formatCzechDateShort } from '@/lib/format';
import type { AdminPayout } from '@/types/admin';

// Kolo 7 (C-57): stránka ukazuje jen to, co je pravda. Dřív si z objednávek vyráběla minulé měsíce
// jako „Vyplaceno" a vypisovala natvrdo vymyšlený bankovní účet. Vyplaceno = výplata ve stavu paid,
// tj. převod potvrzený platform adminem (datum + reference) nebo bankou.
const STATUS: Record<AdminPayout['status'], { label: string; tone: string }> = {
  estimate: { label: 'Odhad — není výplata', tone: 'bg-slate-100 text-slate-600' },
  pending: { label: 'Připravuje se', tone: 'bg-slate-100 text-slate-700' },
  approved: { label: 'Schváleno', tone: 'bg-sky-100 text-sky-800' },
  processing: { label: 'Odesílá se (banka)', tone: 'bg-amber-100 text-amber-800' },
  awaiting_manual_transfer: { label: 'Čeká na ruční převod', tone: 'bg-amber-100 text-amber-800' },
  paid: { label: 'Vyplaceno', tone: 'bg-emerald-100 text-emerald-800' },
  failed: { label: 'Selhalo', tone: 'bg-rose-100 text-rose-800' },
  cancelled: { label: 'Zrušeno', tone: 'bg-slate-100 text-slate-500' },
};

const columns: Column<AdminPayout>[] = [
  {
    key: 'period',
    header: 'Období',
    render: (row) => (
      <div>
        <div className="font-medium">
          {formatCzechDateShort(row.periodStart)} – {formatCzechDateShort(row.periodEnd)}
        </div>
        <div className="text-xs text-muted-foreground">{row.status === 'estimate' ? 'dopočteno z objednávek' : row.id}</div>
      </div>
    ),
  },
  {
    key: 'gross',
    header: 'Hrubé tržby',
    className: 'text-right',
    render: (row) => <div className="text-right">{formatCzk(row.grossHalire)}</div>,
  },
  {
    key: 'fees',
    header: 'Poplatky',
    className: 'text-right',
    render: (row) => (
      <div className="text-right text-muted-foreground">−{formatCzk(row.feesHalire)}</div>
    ),
  },
  {
    key: 'net',
    header: 'K výplatě',
    className: 'text-right',
    render: (row) => (
      <div className="text-right font-semibold">{formatCzk(row.netHalire)}</div>
    ),
  },
  {
    key: 'status',
    header: 'Stav',
    render: (row) => {
      const s = STATUS[row.status] ?? { label: row.status, tone: 'bg-slate-100 text-slate-700' };
      return (
        <span data-testid="payout-status" className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>
          {s.label}
        </span>
      );
    },
  },
  {
    key: 'paidAt',
    header: 'Vyplaceno',
    render: (row) => (
      <span className="text-muted-foreground">
        {row.status === 'paid' && row.paidAt ? (
          <>
            {formatCzechDateShort(row.transferDate ?? row.paidAt)}
            {row.bankReference ? <span className="block text-xs">ref. {row.bankReference}</span> : null}
          </>
        ) : (
          '—'
        )}
      </span>
    ),
  },
];

export default function AdminPayoutsPage() {
  const query = useAdminPayouts();
  const payouts = query.data?.payouts ?? [];
  const isEstimate = query.data?.source === 'computed';
  const iban = query.data?.payoutIban ?? null;

  const totalPaid = payouts.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.netHalire, 0);
  const totalPending = payouts
    .filter((p) => !['paid', 'cancelled', 'failed'].includes(p.status))
    .reduce((sum, p) => sum + p.netHalire, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Výplaty"
        description="Výplatní období: tržby za vstupenky minus vratky a provize platformy."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatCard title="Vyplaceno celkem" value={formatCzk(totalPaid)} hint="Jen potvrzené převody" />
        <StatCard
          title={isEstimate ? 'Odhad k výplatě' : 'Čeká na výplatu'}
          value={formatCzk(totalPending)}
          hint={isEstimate ? 'Dopočteno z objednávek, výplata zatím nevznikla' : undefined}
        />
      </div>

      {isEstimate && payouts.length > 0 ? (
        <p data-testid="payouts-estimate-note" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Zatím vám nebyla vystavena žádná výplata. Níže je jen odhad z prodaných vstupenek — nejde o odeslané peníze.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Export pro účetní</CardTitle>
          <CardDescription>
            Měsíční CSV se všemi tržbami a DPH rozpisem (jako podklad daňového přiznání).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthExport />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bankovní účet pro výplaty</CardTitle>
          <CardDescription>
            Výplatu v Kč převádí platforma ručně; jako vyplacenou ji uvidíte až po potvrzení převodu (datum a reference).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            {iban ? (
              <div data-testid="payout-iban" className="font-mono">{iban}</div>
            ) : (
              <div data-testid="payout-iban-missing" className="text-rose-700">Účet pro výplaty není vyplněný.</div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              Změnu účtu provedete v <Link href="/admin/settings" className="underline">Nastavení</Link>.
            </div>
          </div>
        </CardContent>
      </Card>

      {payouts.length === 0 && !query.isLoading ? (
        <EmptyState
          title="Zatím žádné výplaty"
          description="Jakmile se objeví zaplacené objednávky, sestavíme první výplatní období."
          icon={<Wallet className="h-8 w-8" aria-hidden />}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={payouts}
          rowKey={(p) => p.id}
          loading={query.isLoading}
          emptyMessage="Zatím žádné výplaty"
        />
      )}
    </div>
  );
}

function MonthExport() {
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/admin/payouts/export?month=${month}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tixly-trzby-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div>
          <label htmlFor="payout-month" className="mb-1 block text-xs font-medium">
            Měsíc (YYYY-MM)
          </label>
          <input
            id="payout-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <Button onClick={download} disabled={busy || !month}>
          <Download className="mr-2 h-4 w-4" aria-hidden />
          {busy ? 'Stahuji…' : 'Stáhnout CSV'}
        </Button>
      </div>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      <p className="text-xs text-muted-foreground">
        Obsahuje: datum, kupec, akce, typ lístku, počet, cena s DPH, základ daně,
        sazba DPH, DPH, měna, platba, stav. UTF-8 s BOM (Excel ho přečte správně).
      </p>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function ReportsPage() {
  const [month, setMonth] = useState(currentMonth());

  async function download(path: string, filename: string): Promise<void> {
    const token = localStorage.getItem('accessToken');
    const res = await fetch(path, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      alert(`Stažení selhalo: HTTP ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Účetní reporty"
        description="Měsíční export tržeb. Pošli svému účetnímu — DPH přiznání pro CZ + SR."
      />

      <Card>
        <CardHeader>
          <CardTitle>Vyber měsíc</CardTitle>
          <CardDescription>Formát YYYY-MM. Defaultně aktuální měsíc.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="max-w-48"
            />
            <Button variant="outline" size="sm" onClick={() => setMonth(currentMonth())}>
              Aktuální
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMonth(prevMonth())}>
              Minulý
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>📊 CSV (raw)</CardTitle>
            <CardDescription>
              Univerzální CSV pro Excel / Google Sheets. Všechny paid objednávky s DPH rozpisem.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() =>
                download(
                  `/api/admin/payouts/export?month=${month}`,
                  `tixly-trzby-${month}.csv`,
                )
              }
              className="w-full"
            >
              Stáhnout CSV
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>📘 Pohoda XML</CardTitle>
            <CardDescription>
              Stormware Pohoda dataPack 2.0. Import: Soubor → XML → Import.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() =>
                download(
                  `/api/admin/reports/pohoda?month=${month}`,
                  `tixly-pohoda-${month}.xml`,
                )
              }
              className="w-full"
            >
              Stáhnout Pohoda XML
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>📗 Faktury (PDF, hromadně)</CardTitle>
            <CardDescription>
              Všechny vystavené faktury za měsíc v jednom ZIPu (pokud DPH plátce).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() =>
                window.open(`/api/admin/invoices/export?month=${month}`, '_blank')
              }
              className="w-full"
            >
              Otevřít přehled
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>📅 DPH kalkulačka</CardTitle>
          <CardDescription>
            Rychlý overview za měsíc — gross, net, DPH 10 % (CZ kulturní) nebo 5 % (SR).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Pro detailní rozpis stáhni CSV nebo Pohoda XML. Účetní si spočítá DPH přiznání
            ze sloupců „base / vat" v exportu.
          </p>
        </CardContent>
      </Card>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong>Poznámka:</strong> Pohoda XML předpokládá výchozí sazbu DPH z tvého
        profilu (KYC settings). Pro custom sazby per akce (např. SR 5 %) si můžeš v
        Pohodě sazbu přepnout ručně. Money S3 ISDOC export TBD — napiš nám pokud to
        potřebuješ.
      </div>
    </div>
  );
}

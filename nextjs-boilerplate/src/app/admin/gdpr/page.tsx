'use client';

import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const subProcessors = [
  { name: 'Neon Inc.', country: 'USA', purpose: 'Databáze (PostgreSQL)', basis: 'SCCs + DPA' },
  { name: 'Vercel Inc.', country: 'USA', purpose: 'Hosting, CDN, edge funkce', basis: 'SCCs + DPA' },
  { name: 'Resend Inc.', country: 'USA', purpose: 'Transakční e-maily', basis: 'SCCs + DPA' },
  { name: 'GoPay s.r.o.', country: 'CZ', purpose: 'Platební brána', basis: 'EU subjekt' },
];

const retentions = [
  { category: 'Objednávky a účetní doklady', period: '10 let (zákon č. 563/1991 Sb.)' },
  { category: 'Zákaznické profily', period: 'Do odvolání souhlasu / výmazu' },
  { category: 'Marketingové souhlasy', period: '3 roky od udělení' },
  { category: 'Přístupové logy', period: '90 dní' },
  { category: 'Platební tokeny', period: 'Dle podmínek platební brány' },
];

export default function GdprPage() {
  async function downloadDpa() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const res = await fetch('/api/admin/gdpr/dpa', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      alert('Chyba při generování DPA.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DPA-Tixly.pdf';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="GDPR"
        description="Dokumenty a nástroje pro ochranu osobních údajů."
        actions={
          <Button onClick={downloadDpa}>
            Stáhnout DPA (PDF)
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Smlouva o zpracování osobních údajů (DPA)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Smlouva o zpracování osobních údajů dle čl. 28 GDPR mezi vaší organizací (správce) a Tixly s.r.o. (zpracovatel).
            Dokument je generován dynamicky s aktuálními údaji z vašeho profilu.
          </p>
          <Button onClick={downloadDpa} variant="outline">
            Stáhnout DPA (PDF)
          </Button>
          <div className="mt-2 text-xs text-muted-foreground space-y-1">
            <p>Odkazové API pro správu dat zákazníků:</p>
            <p className="font-mono">GET /api/admin/gdpr/export — export dat zákazníka</p>
            <p className="font-mono">DELETE /api/admin/gdpr/delete — výmaz dat zákazníka</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subzpracovatelé</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Název</th>
                <th>Stát</th>
                <th>Účel</th>
                <th>Základ přenosu</th>
              </tr>
            </thead>
            <tbody>
              {subProcessors.map((sp) => (
                <tr key={sp.name} className="border-b">
                  <td className="py-2 font-medium">{sp.name}</td>
                  <td>{sp.country}</td>
                  <td>{sp.purpose}</td>
                  <td className="text-xs text-muted-foreground">{sp.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Doby uchovávání dat</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Kategorie dat</th>
                <th>Doba uchovávání</th>
              </tr>
            </thead>
            <tbody>
              {retentions.map((r) => (
                <tr key={r.category} className="border-b">
                  <td className="py-2 font-medium">{r.category}</td>
                  <td className="text-muted-foreground">{r.period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

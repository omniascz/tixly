'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ChartSummary {
  id: string;
  name: string;
  total_seats: number;
}

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export default function PromoterSeatingChartViewPage() {
  const params = useParams();
  const venueId = String(params.venueId);
  const [chart, setChart] = useState<ChartSummary | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const res = await authFetch(`/api/admin/venues/${venueId}/seating-chart`);
      if (!res.ok) {
        setChart(null);
        return;
      }
      const j = (await res.json()) as { chart: ChartSummary | null };
      setChart(j.chart);
    })();
  }, [venueId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Seating chart"
        description="Sály a seating charts spravuje master admin Tixly. Promotér je pouze čte při tvorbě akce."
      />

      <Card>
        <CardHeader>
          <CardTitle>Aktuální layout</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {chart === undefined ? (
            <p className="text-muted-foreground">Načítám…</p>
          ) : chart === null ? (
            <p className="text-muted-foreground">Pro tento sál ještě nebyl vytvořen seating chart.</p>
          ) : (
            <div>
              <div>
                <strong>{chart.name}</strong> · {chart.total_seats.toLocaleString('cs-CZ')} sedadel
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Layout je read-only z perspektivy promotéra. Pro úpravy kontaktuj master admina Tixly.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-amber-50/30">
        <CardContent className="pt-6 text-sm">
          <p>
            <strong>Proč nemůžu sál upravovat?</strong>
          </p>
          <p className="mt-2 text-muted-foreground">
            Sály a stadiony jsou v Tixly platform-level resource — sdílí je všichni promotéři, takže jejich
            integrita je kritická. Master admin Tixly udržuje katalog (mapování velkých arén, importy ze
            SVG/CSV, kontrola kvality). Promotéři vybírají hotový sál při tvorbě akce.
          </p>
          <p className="mt-2 text-muted-foreground">
            Potřebuješ nový sál nebo úpravu existujícího? Napiš na <a className="underline" href="mailto:support@tixly.cz">support@tixly.cz</a>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

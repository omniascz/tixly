'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Copy, ExternalLink, Monitor } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function KioskDisplayPage() {
  const params = useParams();
  const eventId = String(params.id);
  const [copied, setCopied] = useState(false);

  const appUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? '';

  const kioskUrl = `${appUrl}/cs/kiosk/${eventId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(kioskUrl)}`;

  function copy() {
    void navigator.clipboard.writeText(kioskUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Foyer Kiosk Display"
        description="Zobrazení dostupnosti vstupenek pro recepci / foyer monitor."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Monitor className="h-4 w-4" aria-hidden />
            URL displeje
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
            <code className="flex-1 break-all text-sm font-mono">{kioskUrl}</code>
            <Button variant="outline" size="sm" onClick={copy}>
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {copied ? 'Zkopírováno!' : 'Kopírovat'}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={kioskUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Otevřít
              </a>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            Otevřete tuto URL v prohlížeči na foyer monitoru. Stránka se automaticky obnovuje každých 30 sekund.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">QR kód pro rychlé otevření</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <img
            src={qrUrl}
            alt="QR kód pro kiosk display"
            width={200}
            height={200}
            className="rounded-lg border"
          />
          <p className="text-sm text-muted-foreground text-center">
            Naskenujte QR kódem na mobilním zařízení a otevřete kiosk displej.<br />
            Vhodné pro přenos URL na monitor bez nutnosti ručního zadávání.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

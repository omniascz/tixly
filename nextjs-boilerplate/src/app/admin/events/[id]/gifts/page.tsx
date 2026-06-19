'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface GiftRow {
  id: string;
  claim_token: string;
  recipient_email: string;
  recipient_name: string | null;
  gift_message: string | null;
  claimed_at: string | null;
  claimed_event_title: string | null;
  claimed_event_date: string | null;
  expires_at: string;
  created_at: string;
  buyer_email: string;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function GiftsPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [gifts, setGifts] = useState<GiftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/events/${eventId}/gifts`, {
        headers: authHeaders(),
      });
      if (!r.ok) {
        const d = (await r.json()) as { error?: string };
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      const d = (await r.json()) as { gifts: GiftRow[] };
      setGifts(d.gifts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [eventId]);

  const redeemed = gifts.filter((g) => g.claimed_at).length;
  const pending = gifts.length - redeemed;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dárkové vstupenky"
        description={`Celkem: ${gifts.length} | Uplatněno: ${redeemed} | Čeká: ${pending}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Obnovit
          </Button>
        }
      />

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      {gifts.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Pro tuto akci nejsou žádné dárkové vstupenky.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Příjemce</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Zpráva</th>
                <th className="py-2 pr-4 font-medium">Od kupce</th>
                <th className="py-2 pr-4 font-medium">Uplatněno</th>
                <th className="py-2 pr-4 font-medium">Termín</th>
                <th className="py-2 font-medium">Vyprší</th>
              </tr>
            </thead>
            <tbody>
              {gifts.map((g) => (
                <tr key={g.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="py-2 pr-4 font-medium">
                    {g.recipient_name ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{g.recipient_email}</td>
                  <td className="py-2 pr-4 max-w-[180px] truncate text-muted-foreground" title={g.gift_message ?? ''}>
                    {g.gift_message ? `„${g.gift_message}"` : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground text-xs">{g.buyer_email}</td>
                  <td className="py-2 pr-4">
                    {g.claimed_at ? (
                      <Badge variant="default" className="bg-emerald-600 text-white">
                        {new Date(g.claimed_at).toLocaleDateString('cs-CZ')}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Ne</Badge>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {g.claimed_event_title ? (
                      <>
                        {g.claimed_event_title}
                        {g.claimed_event_date ? (
                          <span className="block text-muted-foreground/70">
                            {new Date(g.claimed_event_date).toLocaleDateString('cs-CZ')}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {new Date(g.expires_at).toLocaleDateString('cs-CZ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

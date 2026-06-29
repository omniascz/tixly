'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Experience {
  id: string; name: string; description: string | null; type: string;
  capacity: number; reserved_count: number; price_halire: number; currency: string;
  requires_ticket: boolean; start_time: string | null; location: string | null;
}

const TYPE_ICON: Record<string, string> = {
  meet_greet: '🤝', soundcheck: '🎤', backstage_tour: '🚪', vip_lounge: '🥂', after_party: '🎉',
};
const TYPE_LABEL: Record<string, string> = {
  meet_greet: 'Meet & Greet', soundcheck: 'Soundcheck', backstage_tour: 'Backstage tour',
  vip_lounge: 'VIP lounge', after_party: 'After party',
};

export function SuperfanSection({ eventId }: { eventId: string }) {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/events/${eventId}/superfan-experiences`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { experiences?: Experience[] } | null) => {
        setExperiences(d?.experiences ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [eventId]);

  if (!loaded || experiences.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">⭐ Super Fan zážitky</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {experiences.map((exp) => {
          const spotsLeft = exp.capacity - exp.reserved_count;
          const full = spotsLeft <= 0;
          return (
            <div key={exp.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-lg">{TYPE_ICON[exp.type] ?? '⭐'}</span>
                    <span className="font-medium text-sm">{exp.name}</span>
                    <Badge variant="outline" className="text-xs">{TYPE_LABEL[exp.type] ?? exp.type}</Badge>
                  </div>
                  {exp.description ? (
                    <p className="text-xs text-muted-foreground mb-1 line-clamp-2">{exp.description}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {exp.location ? <span>📍 {exp.location}</span> : null}
                    {exp.start_time ? (
                      <span>🕐 {new Date(exp.start_time).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    ) : null}
                    {full ? (
                      <span className="font-medium text-rose-600">Obsazeno</span>
                    ) : spotsLeft <= 5 ? (
                      <span className="font-medium text-orange-600">Zbývá jen {spotsLeft} míst!</span>
                    ) : (
                      <span>{spotsLeft} míst volných</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold mb-1">
                    {(exp.price_halire / 100).toLocaleString('cs-CZ')} Kč
                  </p>
                  {exp.requires_ticket ? (
                    <p className="text-xs text-muted-foreground mb-2">vyžaduje vstupenku</p>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={full}
                    onClick={() => {
                      const url = `/cs/my/superfan/${exp.id}`;
                      window.location.href = url;
                    }}
                  >
                    {full ? 'Obsazeno' : 'Rezervovat'}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Rezervace Super Fan zážitků je možná po zakoupení vstupenky v sekci &quot;Moje vstupenky&quot;.
        </p>
      </CardContent>
    </Card>
  );
}

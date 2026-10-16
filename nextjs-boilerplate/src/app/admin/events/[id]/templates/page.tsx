'use client';

/**
 * /admin/events/[id]/templates
 *
 * Uložit aktuální event jako šablonu + přehled uložených šablon promotéra.
 */

import { useEffect, useState } from 'react';
import React from 'react';
import { BookmarkPlus, Layers, CheckCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRouteParams } from '@/lib/next/route-params';

function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <label className={`block text-xs font-medium text-muted-foreground mb-1 ${className ?? ''}`}>{children}</label>;
}


interface SavedTemplate {
  id: string;
  name: string;
  description: string | null;
  template_type: string;
  usage_count: number;
  created_at: string;
}

function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

const TYPE_LABELS: Record<string, string> = {
  full_event: 'Celá akce',
  presale_setup: 'Presale nastavení',
  vip_package: 'VIP balíček',
  discount_bundle: 'Slevy',
  pricing_tiers: 'Cenové hladiny',
};

export default function TemplatesPage(_props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = useParams<{ id: string }>();
  const { id: eventId } = useRouteParams(params);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const loadTemplates = () => {
    setLoading(true);
    void authFetch('/api/admin/event-templates')
      .then(async (r) => {
        const d = (await r.json()) as { templates: SavedTemplate[] };
        setTemplates(d.templates ?? []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(loadTemplates, []);

  async function handleSave() {
    if (!saveName.trim()) return;
    setSaving(true);
    setStatus(null);
    const r = await authFetch(`/api/admin/events/${eventId}/save-as-template`, {
      method: 'POST',
      body: JSON.stringify({ name: saveName.trim(), description: saveDesc || undefined }),
    });
    setSaving(false);
    if (r.ok) {
      setSaveName('');
      setSaveDesc('');
      setStatus({ type: 'ok', msg: 'Šablona uložena.' });
      loadTemplates();
    } else {
      const d = (await r.json()) as { message?: string };
      setStatus({ type: 'err', msg: d.message ?? 'Chyba při ukládání' });
    }
  }

  async function handleApply(templateId: string, templateName: string) {
    if (!confirm(`Použít šablonu "${templateName}" na tuto akci? Přidá ticket types a slevy ze šablony.`)) return;
    setApplying(templateId);
    setStatus(null);
    const r = await authFetch(`/api/admin/event-templates/${templateId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ eventId }),
    });
    setApplying(null);
    if (r.ok) {
      const d = (await r.json()) as { applied: Record<string, unknown> };
      const counts = Object.entries(d.applied ?? {})
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');
      setStatus({ type: 'ok', msg: `Šablona aplikována: ${counts}` });
    } else {
      const d = (await r.json()) as { message?: string };
      setStatus({ type: 'err', msg: d.message ?? 'Chyba při aplikaci šablony' });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Šablony akcí"
        description="Uložte tuto akci jako šablonu pro budoucí použití, nebo aplikujte existující šablonu."
      />

      {status && (
        <div
          className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm ${
            status.type === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-rose-300 bg-rose-50 text-rose-900'
          }`}
        >
          {status.type === 'ok' && <CheckCircle className="h-4 w-4 flex-shrink-0" />}
          {status.msg}
        </div>
      )}

      {/* Save as template */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <BookmarkPlus className="h-4 w-4 text-primary" />
            Uložit tuto akci jako šablonu
          </CardTitle>
          <CardDescription className="text-xs">
            Zkopíruje typy vstupenek, skupinové slevy a VIP balíčky. Použijete je při vytváření dalších akcí jedním kliknutím.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Název šablony *</Label>
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="např. Festival standard, Divadelní večer VIP…"
              />
            </div>
            <div>
              <Label className="text-xs">Popis (volitelný)</Label>
              <Input
                value={saveDesc}
                onChange={(e) => setSaveDesc(e.target.value)}
                placeholder="Co šablona obsahuje"
              />
            </div>
          </div>
          <Button
            className="mt-3"
            size="sm"
            onClick={handleSave}
            disabled={saving || !saveName.trim()}
          >
            <BookmarkPlus className="mr-1.5 h-4 w-4" />
            {saving ? 'Ukládám…' : 'Uložit jako šablonu'}
          </Button>
        </CardContent>
      </Card>

      {/* Existing templates */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Uložené šablony ({templates.length})
        </h3>

        {loading ? (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        ) : templates.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Zatím žádné uložené šablony. Uložte první šablonu výše.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <Card key={t.id} className="relative">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Layers className="h-4 w-4 flex-shrink-0 text-primary" />
                        <span className="font-medium text-sm truncate">{t.name}</span>
                      </div>
                      {t.description && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {TYPE_LABELS[t.template_type] ?? t.template_type}
                        </Badge>
                        {t.usage_count > 0 && (
                          <span className="text-xs text-muted-foreground">
                            Použito {t.usage_count}×
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => handleApply(t.id, t.name)}
                    disabled={applying === t.id}
                  >
                    {applying === t.id ? 'Aplikuji…' : 'Použít na tuto akci'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

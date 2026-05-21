'use client';

import { useEffect, useState } from 'react';
import { FileText, Copy, Tag } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface Template {
  id: string; name: string; description: string | null;
  template_type: string; usage_count: number;
  is_active: boolean; created_at: string;
}

const TEMPLATE_TYPES = [
  { value: 'full_event', label: 'Full event', desc: 'Kompletní setup akce' },
  { value: 'presale_setup', label: 'Presale', desc: 'Presale config + promo kódy' },
  { value: 'vip_package', label: 'VIP balíček', desc: 'VIP ticket type s benefity' },
  { value: 'discount_bundle', label: 'Slevový balíček', desc: 'Group discounts preset' },
  { value: 'pricing_tiers', label: 'Pricing tiers', desc: 'Cenové úrovně' },
] as const;

export default function EventTemplatesPage(): JSX.Element {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyEventId, setApplyEventId] = useState<string>('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateType, setTemplateType] = useState('vip_package');
  const [templateJson, setTemplateJson] = useState(JSON.stringify({
    vip_package: {
      name: 'VIP Backstage',
      description: 'Backstage access + meet & greet',
      price: 250000,
      benefits: ['Backstage access', 'Drink voucher', 'Limited edition merch'],
    },
  }, null, 2));

  useEffect(() => { void load(); }, []);

  async function load(): Promise<void> {
    try {
      const r = await typedGet<{ templates: Template[] }>('/api/admin/event-templates');
      setTemplates(r.templates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(templateJson);
      await typedPost('/api/admin/event-templates', {
        name,
        description: description || undefined,
        templateType,
        templateData: parsed,
      }, { throwOnError: true });
      setShowForm(false);
      setName(''); setDescription('');
      await load();
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('JSON template data neplatné.');
      } else if (err instanceof TypedFetchError) {
        setError((err.body as { error?: string })?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  async function apply(templateId: string): Promise<void> {
    const targetEventId = prompt('Event ID na který aplikovat template:', applyEventId);
    if (!targetEventId) return;
    setApplyEventId(targetEventId);
    try {
      const r = await typedPost<{ applied?: Record<string, number> }>(
        `/api/admin/event-templates/${templateId}/apply`,
        { eventId: targetEventId },
        { throwOnError: true },
      );
      const counts = r.applied ?? {};
      const summary = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ');
      alert(`Template aplikován. ${summary}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Chyba');
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Reusable Event Templates"
        description="TM-style templates pro presale / VIP / discount setupy. Vytvoř jednou, aplikuj na N akcí."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{templates.length} templates</p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : '+ Nový template'}</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Nový template</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Název</label>
              <Input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="např. Standard VIP balíček" maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Popis</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Typ</label>
              <select value={templateType} onChange={(e) => setTemplateType(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {TEMPLATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Template data (JSON)</label>
              <textarea value={templateJson} onChange={(e) => setTemplateJson(e.target.value)}
                rows={12}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
              <p className="mt-1 text-xs text-muted-foreground">
                Pro VIP package: <code>vip_package.{`{name, description, price, benefits[]}`}</code>.
                Pro ticket_types: <code>ticket_types[]</code>.
              </p>
            </div>
            <Button onClick={create} disabled={busy || !name}>
              {busy ? 'Ukládám…' : 'Vytvořit template'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádné templates. Vytvoř první VIP package nebo presale config — pak aplikuj na libovolnou akci jedním kliknutím.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="flex items-center justify-between pt-4">
                <div>
                  <p className="font-semibold">{t.name}</p>
                  {t.description ? <p className="text-sm text-muted-foreground">{t.description}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    <Tag className="inline h-3 w-3" /> {t.template_type}
                    {' · '}
                    Použito {t.usage_count}×
                  </p>
                </div>
                <Button size="sm" onClick={() => apply(t.id)}>
                  <Copy className="mr-1 h-4 w-4" /> Aplikovat
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

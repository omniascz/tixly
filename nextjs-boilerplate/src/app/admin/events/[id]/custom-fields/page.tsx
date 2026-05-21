'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Trash2, GripVertical, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface CustomField {
  id: string;
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: string;
  options: { value: string; label: string }[] | null;
  required: boolean;
  scope: string;
  display_order: number;
}

const FIELD_TYPES = [
  { value: 'text', label: 'Krátký text' },
  { value: 'textarea', label: 'Dlouhý text' },
  { value: 'select', label: 'Výběr (dropdown)' },
  { value: 'multiselect', label: 'Vícenásobný výběr' },
  { value: 'checkbox', label: 'Zaškrtávátko' },
  { value: 'radio', label: 'Přepínač (radio)' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefon' },
  { value: 'date', label: 'Datum' },
  { value: 'number', label: 'Číslo' },
];

export default function CustomFieldsPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [fields, setFields] = useState<CustomField[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [fieldKey, setFieldKey] = useState('');
  const [label, setLabel] = useState('');
  const [helpText, setHelpText] = useState('');
  const [fieldType, setFieldType] = useState<string>('text');
  const [required, setRequired] = useState(false);
  const [scope, setScope] = useState<'order' | 'ticket'>('order');
  const [optionsText, setOptionsText] = useState('');

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const r = await typedGet<{ fields: CustomField[] }>(
        `/api/admin/events/${eventId}/custom-fields`,
      );
      setFields(r.fields ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const needsOptions = ['select', 'multiselect', 'radio'].includes(fieldType);
      const options = needsOptions
        ? optionsText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [value, lbl] = line.includes('|') ? line.split('|') : [line, line];
              return { value: value.trim(), label: (lbl ?? value).trim() };
            })
        : undefined;

      await typedPost(`/api/admin/events/${eventId}/custom-fields`, {
        fieldKey, label, helpText: helpText || undefined,
        fieldType, options, required, scope,
        displayOrder: fields.length * 10 + 10,
      }, { throwOnError: true });

      setShowForm(false);
      setFieldKey(''); setLabel(''); setHelpText('');
      setFieldType('text'); setRequired(false); setOptionsText('');
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const body = err.body as { error?: string; message?: string } | undefined;
        setError(body?.message ?? body?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm('Smazat pole? Existing odpovědi zůstanou v audit logu, ale pole z checkoutu zmizí.')) return;
    try {
      await typedFetch(`/api/admin/events/${eventId}/custom-fields/${id}`, {
        method: 'DELETE', throwOnError: true,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  const needsOptions = ['select', 'multiselect', 'radio'].includes(fieldType);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Doplňkové otázky"
        description="Eventim-style custom checkout fields — sbírej dodatečné info od kupců (dietní preference, kde slyšeli o akci, ...)"
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{fields.length} polí v shopu</p>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Zavřít' : '+ Nové pole'}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Nové pole</CardTitle>
            <CardDescription>
              Zobrazí se v checkoutu pod ticket types. Promoter ho pak vidí v detailu objednávky.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Klíč (snake_case)</label>
                <Input
                  value={fieldKey}
                  onChange={(e) => setFieldKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  placeholder="how_did_you_hear"
                  maxLength={40}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Typ pole</label>
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Label (otázka pro kupce)</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Jak ses o akci dozvěděl?"
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Help text (volitelně)</label>
              <Input
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                placeholder="Pomáhá nám lépe cílit reklamu"
                maxLength={500}
              />
            </div>
            {needsOptions ? (
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Volby (jeden řádek = jedna volba, formát „value|label")
                </label>
                <textarea
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder={'facebook|Facebook\ninstagram|Instagram\nfriend|Od kamaráda'}
                  rows={5}
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                <span>Povinné</span>
              </label>
              <div>
                <label className="mb-1 block text-xs font-medium">Rozsah</label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'order' | 'ticket')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="order">Per objednávka (1× za celou objednávku)</option>
                  <option value="ticket">Per lístek (1× za každý ticket)</option>
                </select>
              </div>
            </div>
            <Button onClick={create} disabled={busy || !fieldKey || !label}>
              <Plus className="mr-1 h-4 w-4" /> Vytvořit pole
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {fields.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádná doplňková pole. Standardní checkout sbírá jen jméno + e-mail.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {fields.map((f) => (
            <Card key={f.id}>
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{f.label}</p>
                      {f.required ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800">
                          povinné
                        </span>
                      ) : null}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                        {FIELD_TYPES.find((t) => t.value === f.field_type)?.label ?? f.field_type}
                      </span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                        {f.scope === 'order' ? 'per objednávka' : 'per lístek'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {f.field_key}
                      {f.help_text ? ` · ${f.help_text}` : ''}
                    </p>
                    {f.options ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Volby: {f.options.map((o) => o.label).join(', ')}
                      </p>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  className="text-rose-600 hover:text-rose-800"
                  aria-label="Smazat"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

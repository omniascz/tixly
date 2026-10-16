'use client';

import { useRef, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  value: string;
  onChange: (url: string) => void;
}

type Mode = 'upload' | 'url';

const MAX_BYTES = 5 * 1024 * 1024;

export function CoverImageUpload({ value, onChange }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>(value ? 'url' : 'upload');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File): Promise<void> => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('Soubor je větší než 5 MB.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Povolené formáty: JPG, PNG, WebP.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/admin/uploads/cover-image', {
        method: 'POST',
        body: fd,
      });
      const json = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !json.url) {
        setError(json.error ?? `HTTP ${r.status}`);
        return;
      }
      onChange(json.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onFile = (f: File | undefined): void => {
    if (f) void upload(f);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode('upload')}
          className={`rounded-md px-3 py-1 ${
            mode === 'upload' ? 'bg-primary text-primary-foreground' : 'bg-muted'
          }`}
        >
          Nahrát soubor
        </button>
        <button
          type="button"
          onClick={() => setMode('url')}
          className={`rounded-md px-3 py-1 ${
            mode === 'url' ? 'bg-primary text-primary-foreground' : 'bg-muted'
          }`}
        >
          Vložit URL
        </button>
      </div>

      {mode === 'upload' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
          className={`rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
          }`}
        >
          <p className="mb-2 text-muted-foreground">
            Přetáhni soubor sem nebo vyber z disku
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? undefined)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? 'Nahrávám…' : 'Vybrat soubor'}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            JPG / PNG / WebP, max 5 MB
          </p>
        </div>
      ) : (
        <Input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
        />
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {value ? (
        <div className="overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="cover preview"
            className="h-48 w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

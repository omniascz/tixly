'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Branding {
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  email_header_html: string | null;
  email_footer_html: string | null;
  hide_powered_by: boolean;
  custom_css: string | null;
  meta_title: string | null;
  meta_description: string | null;
  social_facebook: string | null;
  social_instagram: string | null;
  social_twitter: string | null;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function BrandingPage() {
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#6C47FF');
  const [accentColor, setAccentColor] = useState('#10B981');
  const [emailHeaderHtml, setEmailHeaderHtml] = useState('');
  const [emailFooterHtml, setEmailFooterHtml] = useState('');
  const [hidePoweredBy, setHidePoweredBy] = useState(false);
  const [customCss, setCustomCss] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [facebook, setFacebook] = useState('');
  const [instagram, setInstagram] = useState('');
  const [twitter, setTwitter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/admin/branding');
    if (!res.ok) return;
    const j = (await res.json()) as { branding: Branding | null };
    if (j.branding) {
      setLogoUrl(j.branding.logo_url ?? '');
      setFaviconUrl(j.branding.favicon_url ?? '');
      setPrimaryColor(j.branding.primary_color ?? '#6C47FF');
      setAccentColor(j.branding.accent_color ?? '#10B981');
      setEmailHeaderHtml(j.branding.email_header_html ?? '');
      setEmailFooterHtml(j.branding.email_footer_html ?? '');
      setHidePoweredBy(j.branding.hide_powered_by);
      setCustomCss(j.branding.custom_css ?? '');
      setMetaTitle(j.branding.meta_title ?? '');
      setMetaDescription(j.branding.meta_description ?? '');
      setFacebook(j.branding.social_facebook ?? '');
      setInstagram(j.branding.social_instagram ?? '');
      setTwitter(j.branding.social_twitter ?? '');
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/admin/branding', {
        method: 'PUT',
        body: JSON.stringify({
          logoUrl: logoUrl || null,
          faviconUrl: faviconUrl || null,
          primaryColor: primaryColor || null,
          accentColor: accentColor || null,
          emailHeaderHtml: emailHeaderHtml || null,
          emailFooterHtml: emailFooterHtml || null,
          hidePoweredBy,
          customCss: customCss || null,
          metaTitle: metaTitle || null,
          metaDescription: metaDescription || null,
          socialFacebook: facebook || null,
          socialInstagram: instagram || null,
          socialTwitter: twitter || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Branding uložen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branding"
        description="Logo, barvy, custom CSS, social linky. Aplikuje se na buyer-facing stránky a emaily."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Logo + barvy</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Logo URL</label>
              <Input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://cdn.example.com/logo.png"
              />
              {logoUrl ? (
                <img src={logoUrl} alt="Logo preview" className="mt-2 h-12 max-w-xs object-contain" />
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Favicon URL</label>
              <Input
                type="url"
                value={faviconUrl}
                onChange={(e) => setFaviconUrl(e.target.value)}
                placeholder="https://cdn.example.com/favicon.ico"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 md:col-span-2">
              <div>
                <label className="mb-1 block text-xs uppercase text-muted-foreground">
                  Primary color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-10 w-12 rounded border"
                  />
                  <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase text-muted-foreground">
                  Accent color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-10 w-12 rounded border"
                  />
                  <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email branding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Email header HTML
              </label>
              <textarea
                value={emailHeaderHtml}
                onChange={(e) => setEmailHeaderHtml(e.target.value)}
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                placeholder="<img src='...' style='max-width:200px'>"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Email footer HTML
              </label>
              <textarea
                value={emailFooterHtml}
                onChange={(e) => setEmailFooterHtml(e.target.value)}
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hidePoweredBy}
                onChange={(e) => setHidePoweredBy(e.target.checked)}
              />
              Skrýt „Powered by Tixly" v patičce (premium feature)
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SEO + Open Graph</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Meta title
              </label>
              <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} maxLength={120} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Meta description
              </label>
              <textarea
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                rows={2}
                maxLength={300}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Social links</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Input
              type="url"
              value={facebook}
              onChange={(e) => setFacebook(e.target.value)}
              placeholder="https://facebook.com/..."
            />
            <Input
              type="url"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="https://instagram.com/..."
            />
            <Input
              type="url"
              value={twitter}
              onChange={(e) => setTwitter(e.target.value)}
              placeholder="https://twitter.com/..."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Custom CSS (advanced)</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value)}
              rows={6}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              placeholder=":root { --tixly-radius: 0.25rem; }"
            />
          </CardContent>
        </Card>

        <Button type="submit" disabled={busy}>
          {busy ? 'Ukládám…' : 'Uložit branding'}
        </Button>
      </form>
    </div>
  );
}

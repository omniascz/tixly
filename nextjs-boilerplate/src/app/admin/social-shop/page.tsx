'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Copy, Check, ExternalLink, Facebook, Instagram } from 'lucide-react';

// TikTok icon (Lucide nemá nativní, použijeme SVG)
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.29 6.29 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" />
    </svg>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={copy} className="p-2 rounded-md hover:bg-gray-100 transition-colors">
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-gray-500" />}
    </button>
  );
}

interface FeedCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  feedUrl: string;
  steps: { label: string; detail: string }[];
  docsUrl: string;
  docsLabel: string;
  color: string;
}

function FeedCard({ icon, title, description, feedUrl, steps, docsUrl, docsLabel, color }: FeedCardProps) {
  return (
    <div className={`rounded-2xl border-2 ${color} p-6 space-y-5`}>
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <h3 className="font-semibold text-lg">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      {/* Feed URL */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">URL katalogu</p>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 pl-3 pr-1.5 py-1.5">
          <code className="flex-1 text-xs font-mono break-all">{feedUrl}</code>
          <CopyButton value={feedUrl} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Přidejte <code className="bg-muted px-1 rounded">?promoter_id=UUID</code> pro filtraci na jednoho promotéra.
        </p>
      </div>

      {/* Steps */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Jak nastavit</p>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-bold">
                {i + 1}
              </span>
              <div>
                <span className="font-medium">{s.label}</span>
                {s.detail && <span className="text-muted-foreground"> — {s.detail}</span>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <a
        href={docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm font-medium hover:underline"
      >
        <ExternalLink className="h-4 w-4" />
        {docsLabel}
      </a>
    </div>
  );
}

const BASE = typeof window !== 'undefined' ? window.location.origin : 'https://app.tixly.cz';

export default function SocialShopPage() {
  return (
    <div className="space-y-8 p-6 max-w-4xl">
      <PageHeader
        title="Social Shop katalogy"
        description="Napojte akce na Facebook Shop, Instagram Shopping a TikTok Catalog Ads"
      />

      <div className="rounded-xl border bg-blue-50 p-4 text-sm text-blue-800">
        <strong>Jak to funguje:</strong> Tixly exportuje vaše akce jako product catalog feed.
        Meta a TikTok tento feed automaticky stahují (každou hodinu) a zobrazují vaše akce
        v Shopping sekci, Stories Ads a Reels Ads s přímým odkazem na nákup.
      </div>

      <div className="grid gap-6">
        <FeedCard
          icon={<Facebook className="h-8 w-8 text-blue-600" />}
          title="Facebook Shop + Instagram Shopping"
          description="Jeden feed obsluhuje obě platformy přes Meta Business Suite"
          feedUrl={`${BASE}/api/v1/feed/meta-catalog.json`}
          color="border-blue-200"
          steps={[
            { label: 'Meta Business Suite', detail: 'business.facebook.com → Katalogy' },
            { label: 'Přidat datový zdroj', detail: 'Zvolte „URL datového zdroje"' },
            { label: 'Vložte URL', detail: 'Zkopírujte feed URL výše, frekvence: hodinová' },
            { label: 'Facebook Shop', detail: 'Commerce Manager → Obchod → aktivujte katalog' },
            { label: 'Instagram Shopping', detail: 'Nastavení Instagramu → Nakupování → připojte katalog' },
          ]}
          docsUrl="https://developers.facebook.com/docs/marketing-api/catalog/reference"
          docsLabel="Meta Catalog dokumentace"
        />

        <FeedCard
          icon={<TikTokIcon className="h-8 w-8 text-gray-900" />}
          title="TikTok Catalog Ads"
          description="Dynamický retargeting a Shopping Ads na TikToku"
          feedUrl={`${BASE}/api/v1/feed/tiktok-catalog.json`}
          color="border-gray-200"
          steps={[
            { label: 'TikTok Ads Manager', detail: 'ads.tiktok.com → Assets → Catalog' },
            { label: 'Create Catalog', detail: 'Zvolte „Events" jako typ katalogu' },
            { label: 'Add Data Source', detail: 'Scheduled Feed → vložte URL výše' },
            { label: 'TikTok Shop', detail: 'seller-cs.tiktok.com → pro přímý prodej na platformě (vyžaduje CZ schválení)' },
          ]}
          docsUrl="https://ads.tiktok.com/help/article/product-catalog-specifications"
          docsLabel="TikTok Catalog dokumentace"
        />

        <FeedCard
          icon={<Instagram className="h-8 w-8 text-pink-600" />}
          title="Instagram Shopping (přímé)"
          description="Alternativní přímé napojení přes Instagram bez Facebook Pages"
          feedUrl={`${BASE}/api/v1/feed/meta-catalog.json`}
          color="border-pink-200"
          steps={[
            { label: 'Instagram Pro účet', detail: 'Nastavení → Přepnout na profesionální účet' },
            { label: 'Commerce Manager', detail: 'business.facebook.com → vytvořte katalog (použijte Meta feed URL výše)' },
            { label: 'Pošlete žádost', detail: 'Instagram → Nastavení → Nakupování → Začít' },
            { label: 'Schválení Meta', detail: 'Trvá 3–5 pracovních dní' },
          ]}
          docsUrl="https://help.instagram.com/191462054687226"
          docsLabel="Instagram Shopping setup"
        />
      </div>

      <div className="rounded-xl border p-5 space-y-2 bg-muted/30">
        <h4 className="font-semibold">Parametry feedů</h4>
        <div className="text-sm space-y-1 text-muted-foreground">
          <p><code className="bg-muted px-1 rounded">?promoter_id=UUID</code> — pouze akce konkrétního promotéra</p>
          <p><code className="bg-muted px-1 rounded">?locale=cs|sk|en</code> — jazyk (default cs)</p>
          <p>Feed se aktualizuje každou hodinu automaticky. Smazané nebo vyprodané akce se zobrazí jako &quot;out of stock&quot;.</p>
        </div>
      </div>
    </div>
  );
}

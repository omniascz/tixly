/**
 * Embed layout — override root chrome (žádný header, footer, nav).
 * Pro iframe embedding na promotér's externí web.
 */

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// CORS headers — embed page lze iframe-em z jakéhokoli původu
export const dynamic = 'force-dynamic';

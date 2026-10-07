/**
 * Layout pro /admin/events/[id]/* — sub-menu s navigací mezi všemi
 * features event-detail (30+ sub-pages).
 */
import type { JSX } from 'react';
import { EventDetailNav } from './EventDetailNav';


interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function EventDetailLayout({ children, params }: Props): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <div>
      <EventDetailNav eventId={id} />
      <div>{children}</div>
    </div>
  );
}

import { redirect } from 'next/navigation';

/**
 * /cs/tickets/[id] → redirect na /cs/tickets/[id]/show (default view = QR pas).
 *
 * Aby přímý link z mail/SMS šablon nebo wallet karet fungoval i bez „/show".
 */
export default function TicketRoot({ params }: { params: { locale: string; ticketId: string } }) {
  redirect(`/${params.locale}/tickets/${params.ticketId}/show`);
}

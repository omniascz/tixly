import { redirect } from 'next/navigation';

/**
 * /cs/tickets/[id] → redirect na /cs/tickets/[id]/show (default view = QR pas).
 *
 * Aby přímý link z mail/SMS šablon nebo wallet karet fungoval i bez „/show".
 */
export default async function TicketRoot(props: { params: Promise<{ locale: string; ticketId: string }> }) {
 const params = await props.params;
 redirect(`/${params.locale}/tickets/${params.ticketId}/show`);
}

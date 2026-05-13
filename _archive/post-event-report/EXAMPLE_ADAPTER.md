# Example Database Adapter Implementation

This is a reference implementation showing how to adapt the module to a real database.

## PostgreSQL + Prisma Example

```typescript
import { ReportDbAdapter } from './services/post-event-report.service';
import { PrismaClient } from '@prisma/client';

export class PrismaReportAdapter implements ReportDbAdapter {
  constructor(private prisma: PrismaClient) {}

  async getEventDetails(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { name: true, date: true, capacity: true },
    });
    if (!event) return null;
    return {
      name: event.name,
      date: new Date(event.date),
      capacity: event.capacity,
    };
  }

  async getSalesSummary(eventId: string) {
    const orders = await this.prisma.order.findMany({
      where: { event_id: eventId, status: { in: ['completed', 'refunded'] } },
      select: {
        id: true,
        created_at: true,
        amount: true,
        quantity: true,
        fee_amount: true,
      },
    });

    const ticketsByType = await this.prisma.ticket.groupBy({
      by: ['ticket_type_id'],
      where: { event_id: eventId },
      _sum: { price: true },
      _count: true,
    });

    const ticketsByZone = await this.prisma.ticket.groupBy({
      by: ['zone_id'],
      where: { event_id: eventId },
      _count: true,
    });

    return {
      total_sold: orders.reduce((sum, o) => sum + o.quantity, 0),
      total_revenue: orders.reduce((sum, o) => sum + o.amount, 0),
      total_fees: orders.reduce((sum, o) => sum + o.fee_amount, 0),
      by_type: [], // Map ticket types to names
      by_zone: [],
      orders: orders.map(o => ({
        created_at: new Date(o.created_at),
        amount: o.amount,
        quantity: o.quantity,
      })),
      first_sale_at: orders.length > 0 ? new Date(orders[0].created_at) : null,
      last_sale_at: orders.length > 0 ? new Date(orders[orders.length - 1].created_at) : null,
    };
  }

  async getAttendanceSummary(eventId: string) {
    const scans = await this.prisma.scan.findMany({
      where: { event_id: eventId },
      select: { scanned_at: true },
    });

    const ticketCount = await this.prisma.ticket.count({
      where: { event_id: eventId, status: { in: ['active', 'used', 'refunded'] } },
    });

    const willCall = await this.prisma.willCall.count({
      where: { event_id: eventId, picked_up_at: { not: null } },
    });

    const guestList = await this.prisma.guestListEntry.findMany({
      where: { event_id: eventId },
      select: { checked_in_at: true },
    });

    return {
      total_checked_in: scans.length,
      scan_timestamps: scans.map(s => new Date(s.scanned_at)),
      will_call_pickups: willCall,
      guest_list_total: guestList.length,
      guest_list_checked_in: guestList.filter(g => g.checked_in_at).length,
    };
  }

  async getFinanceSummary(eventId: string) {
    const refunds = await this.prisma.refund.aggregate({
      where: { event_id: eventId },
      _sum: { amount: true },
    });

    const resaleData = await this.prisma.secondaryListing.findMany({
      where: { event_id: eventId },
      select: { ask_price: true, buyer_id: true },
    });

    const promoOrders = await this.prisma.order.findMany({
      where: { event_id: eventId, promo_code: { not: null } },
      select: { discount_amount: true },
    });

    const installments = await this.prisma.installmentPlan.aggregate({
      where: { event_id: eventId, status: { in: ['active', 'partially_paid'] } },
      _sum: { remaining_amount: true },
    });

    return {
      refunds_total: refunds._sum.amount ?? 0,
      resale_volume: resaleData
        .filter(r => r.buyer_id)
        .reduce((sum, r) => sum + r.ask_price, 0),
      resale_commission: Math.floor(
        (resaleData.filter(r => r.buyer_id).reduce((sum, r) => sum + r.ask_price, 0) * 0.1)
      ), // 10% platform fee
      promo_discounts: promoOrders.reduce((sum, o) => sum + (o.discount_amount ?? 0), 0),
      installments_pending: installments._sum.remaining_amount ?? 0,
    };
  }

  async getMarketingSummary(eventId: string) {
    const referralOrders = await this.prisma.order.findMany({
      where: { event_id: eventId, referral_code: { not: null } },
      select: { amount: true },
    });

    const promoCodes = await this.prisma.order.groupBy({
      by: ['promo_code'],
      where: { event_id: eventId, promo_code: { not: null } },
      _count: true,
      _sum: { discount_amount: true },
    });

    const affiliateOrders = await this.prisma.order.findMany({
      where: { event_id: eventId, affiliate_id: { not: null } },
      select: { amount: true },
    });

    return {
      referral_sales: referralOrders.length,
      referral_revenue: referralOrders.reduce((sum, o) => sum + o.amount, 0),
      promo_codes_used: promoCodes.length,
      top_promo_codes: promoCodes
        .sort((a, b) => b._count - a._count)
        .slice(0, 10)
        .map(pc => ({
          code: pc.promo_code ?? 'unknown',
          uses: pc._count,
          discount_total: pc._sum.discount_amount ?? 0,
        })),
      affiliate_sales: affiliateOrders.length,
      affiliate_revenue: affiliateOrders.reduce((sum, o) => sum + o.amount, 0),
    };
  }

  async getResaleSummary(eventId: string) {
    const listings = await this.prisma.secondaryListing.findMany({
      where: { event_id: eventId },
      select: { ask_price: true, buyer_id: true },
    });

    const sold = listings.filter(l => l.buyer_id !== null);

    return {
      total_listings: listings.length,
      total_sold: sold.length,
      prices: sold.map(l => l.ask_price),
    };
  }

  async saveReport(report) {
    await this.prisma.postEventReport.create({
      data: {
        id: report.id,
        event_id: report.event_id,
        event_name: report.event_name,
        event_date: report.event_date,
        generated_at: report.generated_at,
        status: report.status,
        data: JSON.stringify(report), // Store full report as JSON
      },
    });
  }

  async getReport(eventId: string) {
    const record = await this.prisma.postEventReport.findUnique({
      where: { event_id: eventId },
    });
    if (!record) return null;
    return JSON.parse(record.data);
  }

  async listReportsByOrganizer(organizerId: string) {
    const reports = await this.prisma.postEventReport.findMany({
      where: { event: { organizer_id: organizerId } },
      select: {
        event_id: true,
        event_name: true,
        event_date: true,
        generated_at: true,
        status: true,
        data: true, // Contains the full report JSON
      },
      orderBy: { generated_at: 'desc' },
    });

    return reports.map(r => {
      const report = JSON.parse(r.data);
      return {
        event_id: r.event_id,
        event_name: r.event_name,
        event_date: new Date(r.event_date),
        sellthrough_pct: report.sales.sellthrough_pct,
        gross_revenue: report.finance.gross_revenue,
        total_checked_in: report.attendance.total_checked_in,
        status: r.status as 'generating' | 'ready' | 'failed',
        generated_at: r.generated_at ? new Date(r.generated_at) : null,
      };
    });
  }

  async checkOrganizerOwnership(eventId: string, organizerId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { organizer_id: true },
    });
    return event?.organizer_id === organizerId;
  }

  async findEventsToReport(cutoffTime: Date) {
    return await this.prisma.event.findMany({
      where: {
        ends_at: { lte: cutoffTime },
        postEventReport: { none: {} }, // No report yet
      },
      select: { id: true, ends_at: true },
    });
  }
}
```

## Usage

```typescript
import { PrismaClient } from '@prisma/client';
import { initializePostEventReportJob } from '@tixly/post-event-report/job';

const prisma = new PrismaClient();
const adapter = new PrismaReportAdapter(prisma);

initializePostEventReportJob(adapter);
```

## Database Schema (Prisma)

Add to your schema.prisma:

```prisma
model PostEventReport {
  id        String   @id
  event_id  String   @unique
  event     Event    @relation(fields: [event_id], references: [id])
  
  event_name    String
  event_date    DateTime
  generated_at  DateTime @default(now())
  status        String   @default("ready") // generating, ready, failed
  
  data          String   @db.Text // Full report JSON
  
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
}
```

This example shows common patterns but you'll need to adapt based on your actual database schema.

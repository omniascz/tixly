# Post-Event Report Module - Integration Guide

## Overview

The post-event report module automatically generates comprehensive event analytics 2 hours after an event ends. Reports include sales, attendance, finance, marketing, and resale metrics.

## Installation

```bash
cd your-tixly-app
npm install ./post-event-report
```

## Database Adapter Implementation

You must implement the `ReportDbAdapter` interface for your database:

```typescript
import { ReportDbAdapter } from '@tixly/post-event-report/service';

class YourDatabaseAdapter implements ReportDbAdapter {
  async getEventDetails(eventId: string) {
    // Query event name, date, capacity
  }
  
  async getSalesSummary(eventId: string) {
    // Aggregate ticket sales, revenue, by_type, by_zone, orders
  }
  
  async getAttendanceSummary(eventId: string) {
    // Aggregate check-in counts, scan timestamps, will-call, guest-list
  }
  
  async getFinanceSummary(eventId: string) {
    // Aggregate refunds, resale volume, promo discounts, installments
  }
  
  async getMarketingSummary(eventId: string) {
    // Aggregate referral sales, promo codes, affiliate sales
  }
  
  async getResaleSummary(eventId: string) {
    // Aggregate secondary market listings and prices
  }
  
  async saveReport(report: PostEventReport): Promise<void> {
    // Persist report to database
  }
  
  async getReport(eventId: string): Promise<PostEventReport | null> {
    // Retrieve report by event ID
  }
  
  async listReportsByOrganizer(organizerId: string) {
    // List all reports for an organizer (summaries)
  }
  
  async checkOrganizerOwnership(eventId: string, organizerId: string) {
    // Verify organizer owns the event
  }
  
  async findEventsToReport(cutoffTime: Date) {
    // Find events that ended before cutoffTime with no report yet
  }
}
```

## Cron Job Setup

Initialize the report job in your application startup:

```typescript
import { initializePostEventReportJob } from '@tixly/post-event-report/job';

const db = new YourDatabaseAdapter();
initializePostEventReportJob(db); // Runs every 30 minutes

// For testing with custom interval (in milliseconds):
initializePostEventReportJob(db, 5 * 60 * 1000); // 5 minutes
```

## API Route Setup

The module includes three API endpoints. Register them in your Next.js app:

### 1. GET `/api/events/[eventId]/report`
Retrieve post-event report
- Requires organizer authentication
- Returns 404 if report still generating
- Returns 403 if organizer doesn't own event

### 2. GET `/api/organizer/reports`
List all reports for authenticated organizer
- Returns array of PostEventReportSummary objects

### 3. POST `/api/events/[eventId]/report/trigger`
Manually trigger report generation
- Use if automatic job failed
- Returns 201 with generated report
- Returns 403 if organizer doesn't own event

## Usage Example

```typescript
import {
  PostEventReportService,
  type PostEventReport,
} from '@tixly/post-event-report/service';

const service = new PostEventReportService();
const db = new YourDatabaseAdapter();

// Generate a report
const report = await service.generateReport('event_123', db);
console.log(`Gross revenue: ${report.finance.gross_revenue} haléř`);
console.log(`Sellthrough: ${report.sales.sellthrough_pct}%`);

// Get existing report
const existing = await service.getReport('event_123', 'org_456', db);

// List organizer reports
const reports = await service.listReports('org_456', db);
```

## Report Schema

See `src/types/post-event-report.types.ts` for complete PostEventReport and PostEventReportSummary interfaces.

Key metrics:
- **Sales**: Total sold, capacity, sellthrough %, revenue, fees, by ticket type/zone, sales curve
- **Attendance**: Check-ins, no-shows, peak entry time, guest list metrics
- **Finance**: Gross revenue, platform fees, organizer payout, resale volume, refunds, promo discounts
- **Marketing**: Referral sales, promo code usage, affiliate metrics
- **Resale**: Secondary market listings, sold count, average/max price, sellthrough %

## Testing

Run the test suite:

```bash
npm test
npm test:watch
npm test:coverage
```

The module includes 20+ tests for all calculation functions, with special focus on edge cases and rounding.

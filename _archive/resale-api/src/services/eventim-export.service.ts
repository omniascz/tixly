// =============================================================================
// Eventim Export Service — XML/API Export for CZ Market Distribution
// Feature #34: Generate Eventim-compatible XML for Czech ticketing distribution
//
// Eventim format reference: CTS Eventim XML Feed v2 (standard used by eventim.cz)
// Events exported here can be distributed via the Eventim network in CZ/SK
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface EventimExportJob {
  id: string;
  eventId: string;
  promoterId: string;
  status: 'pending' | 'generating' | 'done' | 'failed' | 'submitted';
  xmlPayload: string | null;
  eventimEventId: string | null;
  errorMessage: string | null;
  lastExportedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventData {
  id: string;
  name: string;
  description: string | null;
  dateStart: string;
  dateEnd: string | null;
  venueId: string;
  venueName: string;
  venueCity: string;
  venueCountry: string;
  promoterName: string;
  currency: string;
  ticketTypes: Array<{
    id: string;
    name: string;
    priceHellers: number;
    capacity: number;
    available: number;
  }>;
}

interface JobRow {
  id: string;
  event_id: string;
  promoter_id: string;
  status: string;
  xml_payload: string | null;
  eventim_event_id: string | null;
  error_message: string | null;
  last_exported_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapJob(r: JobRow): EventimExportJob {
  return {
    id: r.id,
    eventId: r.event_id,
    promoterId: r.promoter_id,
    status: r.status as EventimExportJob['status'],
    xmlPayload: r.xml_payload,
    eventimEventId: r.eventim_event_id,
    errorMessage: r.error_message,
    lastExportedAt: r.last_exported_at,
    submittedAt: r.submitted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Generate Eventim-compatible XML for an event.
 *
 * Format follows CTS Eventim XML Feed v2 as used by eventim.cz partners.
 * Prices are output in the main currency unit (not subunits).
 */
export function generateEventimXml(event: EventData): string {
  const priceHellers100 = 100; // CZK subunit divisor
  const formatPrice = (hellers: number) => (hellers / priceHellers100).toFixed(2);
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const ticketTypesXml = event.ticketTypes
    .map(
      (tt) => `    <TicketCategory>
      <Id>${escape(tt.id)}</Id>
      <Name>${escape(tt.name)}</Name>
      <Price currency="${escape(event.currency)}">${formatPrice(tt.priceHellers)}</Price>
      <Capacity>${tt.capacity}</Capacity>
      <Available>${tt.available}</Available>
    </TicketCategory>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<EventimFeed version="2.0" xmlns="urn:eventim:feed:v2">
  <Event>
    <Id>${escape(event.id)}</Id>
    <Name>${escape(event.name)}</Name>
    <Description>${escape(event.description ?? '')}</Description>
    <DateStart>${escape(event.dateStart)}</DateStart>
    <DateEnd>${escape(event.dateEnd ?? event.dateStart)}</DateEnd>
    <Venue>
      <Id>${escape(event.venueId)}</Id>
      <Name>${escape(event.venueName)}</Name>
      <City>${escape(event.venueCity)}</City>
      <Country>${escape(event.venueCountry)}</Country>
    </Venue>
    <Promoter>${escape(event.promoterName)}</Promoter>
    <TicketCategories>
${ticketTypesXml}
    </TicketCategories>
  </Event>
</EventimFeed>`;
}

/**
 * Create or update an export job for an event.
 */
export async function createExportJob(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<EventimExportJob> {
  const rows = await db.query<JobRow>(
    `INSERT INTO eventim_export.export_jobs (event_id, promoter_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING *`,
    [eventId, promoterId],
  );
  return mapJob(rows[0]);
}

/**
 * Generate XML for the export job and update job status.
 */
export async function generateExport(
  jobId: string,
  event: EventData,
  db: DbAdapter,
): Promise<EventimExportJob> {
  if (!event.ticketTypes.length) {
    throw new Error('VALIDATION_ERROR: event must have at least one ticket type');
  }

  const xml = generateEventimXml(event);

  const rows = await db.query<JobRow>(
    `UPDATE eventim_export.export_jobs
     SET status = 'done',
         xml_payload = $2,
         last_exported_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [jobId, xml],
  );

  if (!rows[0]) throw new Error('JOB_NOT_FOUND');

  // Log the action
  await db.execute(
    `INSERT INTO eventim_export.export_log (job_id, action, status, message)
     VALUES ($1, 'generate', 'ok', 'XML generated successfully')`,
    [jobId],
  );

  return mapJob(rows[0]);
}

/**
 * Get the export job for an event.
 */
export async function getExportJob(
  eventId: string,
  db: DbAdapter,
): Promise<EventimExportJob | null> {
  const rows = await db.query<JobRow>(
    `SELECT * FROM eventim_export.export_jobs WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [eventId],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

/**
 * Mark a job as submitted to Eventim (after manual/API submission).
 */
export async function markSubmitted(
  jobId: string,
  eventimEventId: string,
  db: DbAdapter,
): Promise<EventimExportJob> {
  const rows = await db.query<JobRow>(
    `UPDATE eventim_export.export_jobs
     SET status = 'submitted',
         eventim_event_id = $2,
         submitted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND status = 'done'
     RETURNING *`,
    [jobId, eventimEventId],
  );

  if (!rows[0]) throw new Error('JOB_NOT_FOUND or not in done state');

  await db.execute(
    `INSERT INTO eventim_export.export_log (job_id, action, status, message)
     VALUES ($1, 'submit', 'ok', $2)`,
    [jobId, `Submitted to Eventim as event ID: ${eventimEventId}`],
  );

  return mapJob(rows[0]);
}

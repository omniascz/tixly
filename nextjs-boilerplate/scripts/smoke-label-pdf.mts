import { renderTicketLabelPdf } from '../src/lib/tickets/label-pdf';
import { signPrintToken, verifyPrintToken } from '../src/lib/tickets/print-token';
import { writeFileSync } from 'node:fs';

const buf = await renderTicketLabelPdf(
  {
    eventTitle: 'Romeo a Julie — premiéra',
    eventDateStart: '2026-09-12T19:00:00.000Z',
    venueName: 'Divadlo v Celetné — Velký sál',
    buyerName: 'Jan Novák',
    promoterName: 'Divadlo v Celetné',
    brandColorHex: '#7c3aed',
  },
  [
    { ticketId: '8a4f7b2e-1c2d-4e5f-9a0b-1c2d3e4f5a6b', ticketTypeName: 'Základní', seatLabel: 'Přízemí · řada 5 · sedadlo 12', unitPriceHalire: 39000 },
    { ticketId: '1b2c3d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e', ticketTypeName: 'Student', seatLabel: 'Balkon · řada 1 · sedadlo 3', unitPriceHalire: 25000 },
  ],
);

const out = 'C:/Users/omnia/Documents/tixly/sample-ticket-label.pdf';
writeFileSync(out, buf);

const text = buf.toString('latin1');
const mb = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];
const tok = signPrintToken('8a4f7b2e-1c2d-4e5f-9a0b-1c2d3e4f5a6b');

process.stdout.write(
  [
    `bytes=${buf.length}`,
    `MediaBox_count=${mb.length}`,
    `first_MediaBox=${mb[0]?.[1]} x ${mb[0]?.[2]} pt`,
    `token=${tok} (len ${tok.length})`,
    `verify_ok=${verifyPrintToken(tok).ok} -> ${verifyPrintToken(tok).ticketId}`,
    `wrote=${out}`,
  ].join('\n') + '\n',
);

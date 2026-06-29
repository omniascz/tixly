import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

interface MembershipRow {
  id: string;
  membership_code: string;
  valid_until: string | null;
  user_id: string;
  bundle_name: string;
  card_color: string | null;
  user_name: string | null;
  email: string;
}

function hexToRgb(hex: string | null | undefined): [number, number, number] {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return [26, 26, 46];
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)!;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export async function GET(
  req: NextRequest,
  { params }: { params: { membershipId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const r = await db().query<MembershipRow>(
      `SELECT m.id, m.membership_code, m.valid_until, m.user_id,
              b.name AS bundle_name, b.card_color,
              u.name AS user_name, u.email
       FROM tickets.cross_pass_memberships m
       JOIN catalog.cross_pass_bundles b ON b.id = m.bundle_id
       JOIN identity.users u ON u.id = m.user_id
       WHERE m.id = $1`,
      [params.membershipId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const row = r.rows[0];
    if (row.user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [bgR, bgG, bgB] = hexToRgb(row.card_color);

    const W = 243;
    const H = 153;
    const PAD = 12;

    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    doc.rect(0, 0, W, H).fill(`rgb(${bgR}, ${bgG}, ${bgB})`);

    doc.fillColor('#ffffff');
    doc.font('Helvetica-Bold').fontSize(10).text('TIXLY', PAD, PAD, { lineBreak: false });

    const bundleName = row.bundle_name.length > 28 ? row.bundle_name.slice(0, 26) + '…' : row.bundle_name;
    doc.font('Helvetica-Bold').fontSize(11).text(bundleName, PAD, PAD + 20, { width: W - PAD * 2 - 70, lineBreak: false });

    doc.moveTo(PAD, PAD + 35).lineTo(W - PAD - 70, PAD + 35).strokeColor('rgba(255,255,255,0.4)').stroke();

    const memberName = (row.user_name ?? row.email).slice(0, 28);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(9).text(memberName, PAD, PAD + 42, { lineBreak: false });

    const validLabel = row.valid_until
      ? new Date(row.valid_until).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Neomezeno';

    doc.fillColor('rgba(255,255,255,0.7)').font('Helvetica').fontSize(7)
      .text('PLATNOST', PAD, H - 36, { lineBreak: false });
    doc.fillColor('#ffffff').font('Helvetica').fontSize(8)
      .text(validLabel, PAD, H - 26, { lineBreak: false });

    const code = row.membership_code;
    doc.fillColor('rgba(255,255,255,0.7)').font('Helvetica').fontSize(7)
      .text('KOD', PAD, H - 13, { lineBreak: false });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7)
      .text(code, PAD + 22, H - 13, { lineBreak: false });

    let qrPng: Buffer | null = null;
    try {
      qrPng = await QRCode.toBuffer(code, { errorCorrectionLevel: 'M', margin: 1, width: 62, color: { dark: '#000000', light: '#ffffff' } });
    } catch {
      qrPng = null;
    }

    if (qrPng) {
      doc.image(qrPng, W - 70, H - 75, { width: 62, height: 62 });
    }

    await new Promise<void>((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
      doc.end();
    });

    const pdf = Buffer.concat(chunks);

    await db().query(
      `UPDATE tickets.cross_pass_memberships SET card_issued_at = NOW() WHERE id = $1`,
      [row.id],
    );

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="clenska-karta-${code}.pdf"`,
      },
    });
  });
}

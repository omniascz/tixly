import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

interface OnboardingRow {
  id: string;
  promoter_id: string;
  current_step: number;
  completed_steps: number[];
  step_data: Record<string, unknown>;
  completed_at: string | null;
  skipped_at: string | null;
  name: string;
  phone: string | null;
  website: string | null;
  description: string | null;
  logo_url: string | null;
  press_email: string | null;
  iban: string | null;
  bank_name: string | null;
  onboarding_done: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const existing = await db().query<OnboardingRow>(
      `SELECT po.*, p.name, p.phone, p.website, p.description, p.logo_url,
              p.press_email, p.iban, p.bank_name, p.onboarding_done
       FROM platform.promoter_onboarding po
       JOIN platform.promoters p ON p.id = po.promoter_id
       WHERE po.promoter_id = $1`,
      [promoter.promoterId],
    );

    if (existing.rows.length > 0) {
      return NextResponse.json(existing.rows[0]);
    }

    await db().query(
      `INSERT INTO platform.promoter_onboarding (promoter_id) VALUES ($1) ON CONFLICT (promoter_id) DO NOTHING`,
      [promoter.promoterId],
    );

    const fresh = await db().query<OnboardingRow>(
      `SELECT po.*, p.name, p.phone, p.website, p.description, p.logo_url,
              p.press_email, p.iban, p.bank_name, p.onboarding_done
       FROM platform.promoter_onboarding po
       JOIN platform.promoters p ON p.id = po.promoter_id
       WHERE po.promoter_id = $1`,
      [promoter.promoterId],
    );

    return NextResponse.json(fresh.rows[0]);
  });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body = (await req.json().catch(() => ({}))) as {
      currentStep?: number;
      completedSteps?: number[];
      stepData?: Record<string, unknown>;
    };

    const sets: string[] = ['updated_at = NOW()'];
    const args: unknown[] = [];
    let pi = 1;

    if (body.currentStep !== undefined) {
      sets.push(`current_step = $${pi++}`);
      args.push(body.currentStep);
    }
    if (body.completedSteps !== undefined) {
      sets.push(`completed_steps = $${pi++}`);
      args.push(body.completedSteps);
    }
    if (body.stepData !== undefined) {
      sets.push(`step_data = step_data || $${pi++}`);
      args.push(JSON.stringify(body.stepData));
    }

    args.push(promoter.promoterId);

    await db().query(
      `UPDATE platform.promoter_onboarding SET ${sets.join(', ')} WHERE promoter_id = $${pi}`,
      args,
    );

    return NextResponse.json({ ok: true });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body = (await req.json().catch(() => ({}))) as { action?: string };

    if (body.action === 'complete') {
      await db().query(
        `UPDATE platform.promoter_onboarding SET completed_at = NOW(), updated_at = NOW() WHERE promoter_id = $1`,
        [promoter.promoterId],
      );
      await db().query(
        `UPDATE platform.promoters SET onboarding_done = TRUE WHERE id = $1`,
        [promoter.promoterId],
      );
    } else if (body.action === 'skip') {
      await db().query(
        `UPDATE platform.promoter_onboarding SET skipped_at = NOW(), updated_at = NOW() WHERE promoter_id = $1`,
        [promoter.promoterId],
      );
      await db().query(
        `UPDATE platform.promoters SET onboarding_done = TRUE WHERE id = $1`,
        [promoter.promoterId],
      );
    } else {
      return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 422 });
    }

    // ForgeMsg — provision this promoter's org + API key immediately on
    // onboarding completion (the hourly forgemsg-provision cron is the fallback).
    // Fire-and-forget: never block onboarding.
    void (async () => {
      try {
        const { provisionPromoter } = await import('@/lib/forgemsg/provision');
        await provisionPromoter(promoter.promoterId);
      } catch (err) {
        console.error('[onboarding] forgemsg provision failed:', err);
      }
    })();

    return NextResponse.json({ ok: true });
  });
}

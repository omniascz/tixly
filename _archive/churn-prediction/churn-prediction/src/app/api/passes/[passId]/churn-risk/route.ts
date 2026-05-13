/**
 * GET /api/passes/[passId]/churn-risk
 *
 * Returns the latest churn prediction for a specific season pass.
 *
 * Access control: JWT required; caller must be either:
 *   - the owner of the pass (user_id matches JWT sub), OR
 *   - an admin (JWT role = 'admin')
 *
 * Response 200:
 *   {
 *     passId: string
 *     churnProbability: number
 *     riskLevel: 'low' | 'medium' | 'high' | 'critical'
 *     topFactors: TopFeature[]
 *     lastComputedAt: string   // ISO 8601
 *   }
 *
 * Response 401: missing or invalid JWT
 * Response 403: authenticated but not the owner or an admin
 * Response 404: pass not found, or no prediction computed yet
 */

import { NextRequest, NextResponse } from "next/server";
import { TopFeature } from "../../../../../types/churn.types";

// ─── Risk level thresholds ────────────────────────────────────────────────────

type RiskLevel = "low" | "medium" | "high" | "critical";

function classifyRisk(probability: number): RiskLevel {
  if (probability < 0.4) return "low";
  if (probability < 0.6) return "medium";
  if (probability < 0.8) return "high";
  return "critical";
}

// ─── JWT payload shape ────────────────────────────────────────────────────────

interface JwtClaims {
  sub: string;
  role: "user" | "admin" | "organizer";
}

// ─── DB row shapes ────────────────────────────────────────────────────────────

interface LatestPredictionRow {
  pass_id: string;
  user_id: string;
  churn_probability: number;
  top_features: unknown;
  computed_at: string;
}

interface PassOwnerRow {
  user_id: string;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Validates the Authorization header and returns decoded JWT claims.
 *
 * In production this delegates to the shared @tixly/auth package.
 * The stub here validates the token format and reads claims that would have
 * been verified by the upstream middleware.
 */
function extractJwtClaims(request: NextRequest): JwtClaims | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token || token.length < 10) return null;

  // In the real implementation:
  //   import { verifyJwt } from '@tixly/auth';
  //   return verifyJwt(token);
  //
  // For the route to compile without that package, we read claims from a
  // trusted header set by the API gateway after JWT verification.
  const subHeader = request.headers.get("x-user-id");
  const roleHeader = request.headers.get("x-user-role") as JwtClaims["role"] | null;

  if (subHeader === null || roleHeader === null) return null;

  return { sub: subHeader, role: roleHeader };
}

// ─── DB adapter factory ───────────────────────────────────────────────────────

import { DbAdapter } from "../../../../../types/churn.types";

function getDb(): DbAdapter {
  throw new Error(
    "getDb() must be wired to a real DbAdapter before deploying. " +
      "Import from @tixly/db or inject via middleware.",
  );
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { passId: string } },
): Promise<NextResponse> {
  const { passId } = params;

  // ── Auth ─────────────────────────────────────────────────────────────────
  const claims = extractJwtClaims(request);
  if (claims === null) {
    return NextResponse.json(
      { error: "Unauthorized. Provide a valid Bearer token." },
      { status: 401 },
    );
  }

  // ── DB queries ────────────────────────────────────────────────────────────
  let db: DbAdapter;
  try {
    db = getDb();
  } catch (err) {
    console.error("[GET /api/passes/[passId]/churn-risk] DB init error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Verify the pass exists and get its owner
  let passOwner: PassOwnerRow | null;
  try {
    passOwner = await db.queryOne<PassOwnerRow>(
      `SELECT user_id FROM passes.season_passes WHERE id = $1`,
      [passId],
    );
  } catch (err) {
    console.error("[GET /api/passes/[passId]/churn-risk] Pass lookup error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (passOwner === null) {
    return NextResponse.json(
      { error: `Pass not found: ${passId}` },
      { status: 404 },
    );
  }

  // ── Authorisation ─────────────────────────────────────────────────────────
  const isOwner = passOwner.user_id === claims.sub;
  const isAdmin = claims.role === "admin";

  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { error: "Forbidden. You do not have access to this pass." },
      { status: 403 },
    );
  }

  // ── Fetch latest prediction (most recent computed_at) ─────────────────────
  let prediction: LatestPredictionRow | null;
  try {
    prediction = await db.queryOne<LatestPredictionRow>(
      `SELECT pass_id, user_id, churn_probability, top_features, computed_at
       FROM ai.churn_predictions
       WHERE pass_id = $1
       ORDER BY computed_at DESC
       LIMIT 1`,
      [passId],
    );
  } catch (err) {
    console.error(
      "[GET /api/passes/[passId]/churn-risk] Prediction lookup error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (prediction === null) {
    return NextResponse.json(
      {
        error:
          "No churn prediction found for this pass. " +
          "It may not have been scored yet.",
      },
      { status: 404 },
    );
  }

  // ── Build response ────────────────────────────────────────────────────────
  const riskLevel = classifyRisk(prediction.churn_probability);

  return NextResponse.json({
    passId: prediction.pass_id,
    churnProbability: prediction.churn_probability,
    riskLevel,
    topFactors: prediction.top_features as TopFeature[],
    lastComputedAt: prediction.computed_at,
  });
}

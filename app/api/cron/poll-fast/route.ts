import { NextRequest, NextResponse } from "next/server";
import { runFastExitCheck } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fast exit-check endpoint — meant to be hit every ~1 minute by an external
 * scheduler (cron-job.org). Only re-checks OPEN positions for stop/take-profit,
 * so stops fire near target instead of slipping between the 5-min full polls.
 * Auth: same CRON_SECRET, via Authorization header or ?secret= query param.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    const querySecret = request.nextUrl.searchParams.get("secret");
    const ok = auth === `Bearer ${cronSecret}` || querySecret === cronSecret;
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runFastExitCheck();
    if (result.errors.length > 0) {
      console.error("fast exit-check errors", result.errors);
    }
    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      checked: result.checked,
      errors: result.errors,
    });
  } catch (err) {
    console.error("fast exit-check failed", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

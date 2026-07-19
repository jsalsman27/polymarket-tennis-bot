import { NextRequest, NextResponse } from "next/server";
import { runPollCycle } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runPollCycle();
    if (result.errors.length > 0) {
      console.error("poll cycle had per-match errors", result.errors);
    }
    return NextResponse.json({
      ok: true,
      polledAt: new Date().toISOString(),
      polled: result.polled,
      errors: result.errors,
    });
  } catch (err) {
    console.error("poll cycle failed", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

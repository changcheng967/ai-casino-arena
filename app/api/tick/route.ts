import { NextRequest, NextResponse } from "next/server";
import { runTick } from "@/lib/arena/tick";
import { getStore } from "@/lib/arena/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// cron-job.org pings this every minute with ?t=CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cron-secret") ??
    req.nextUrl.searchParams.get("t") ??
    "";
  // Local dev (next dev) allows unauthenticated ticks so the browser can drive
  // the arena without cron. In production the secret is mandatory.
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = await getStore();
  try {
    const report = await runTick(store);
    return NextResponse.json({ ok: true, ...report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export const POST = GET;

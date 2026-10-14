import { NextRequest, NextResponse } from "next/server";
import { runTick } from "@/lib/arena/tick";
import { getStore } from "@/lib/arena/store";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Fluid Hobby max

// cron-job.org pings this every minute with ?t=CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cron-secret") ??
    // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.nextUrl.searchParams.get("t") ??
    "";
  // Local dev (next dev) allows unauthenticated ticks so the browser can drive
  // the arena without cron. In production the secret is mandatory.
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = await getStore();
  // Respond immediately and advance the arena in the background: a tick works
  // ~3 minutes by design, which trips cron services' test timeouts. waitUntil
  // keeps the function alive until the tick finishes; the DB lease still
  // serializes overlapping ticks. Falls back to inline execution outside
  // Vercel (local dev).
  const work = runTick(store)
    .then((report) => {
      if (!report.ran) console.log("tick skipped:", report.reason);
      return report;
    })
    .catch((e: any) => {
      console.error("tick failed:", e?.message ?? e);
      return { ran: false, error: String(e?.message ?? e) };
    });
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(work);
    return NextResponse.json({ ok: true, queued: true });
  } catch {
    const report = await work;
    return NextResponse.json({ ok: true, ...report });
  }
}

export const POST = GET;

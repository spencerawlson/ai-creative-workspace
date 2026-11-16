// Runs one Blender job on a model the browser sends (a GLB body) and
// returns the result file. See lib/server/blender.ts for the limits.
import {
  JobError,
  MAX_UPLOAD,
  blenderJobs,
  blenderOffered,
  isJob,
  runJob,
} from "@/lib/server/blender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

/** The body, refusing more than `max` bytes even without a length. */
async function readCapped(
  req: Request,
  max: number,
): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ job: string }> },
) {
  if (!blenderOffered()) return fail("Blender isn't available here.", 404);
  const { job } = await params;
  if (!isJob(job)) return fail("No such job.", 404);
  const body = await readCapped(req, MAX_UPLOAD);
  if (!body) return fail("That model is too large to send to Blender.", 413);
  const settings = Object.fromEntries(new URL(req.url).searchParams);
  // Only what this server's Blender can do (probed once).
  const can = await blenderJobs();
  const need =
    job === "convert" ? settings.format : job === "retopo" ? "quads" : "render";
  if (
    Object.prototype.hasOwnProperty.call(can, need) &&
    !can[need as keyof typeof can]
  )
    return fail("This server's Blender can't do that job.", 501);
  try {
    const r = await runJob(job, body, settings);
    return new Response(Buffer.from(r.bytes), {
      headers: {
        "Content-Type": r.type,
        "Content-Disposition": `attachment; filename="result${r.ext}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof JobError) return fail(e.message, e.status);
    return fail("Blender couldn't finish that job.", 500);
  }
}

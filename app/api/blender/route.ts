// Whether this server offers Blender jobs (export FBX/USD, clean quads,
// render): the app shows those options only when it does.
import { blenderBusy, blenderJobs } from "@/lib/server/blender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Which jobs this server's Blender can do: none unless it opts in.
  const jobs = await blenderJobs();
  const available = Object.values(jobs).some(Boolean);
  return Response.json(
    { available, jobs, busy: available && blenderBusy() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Whether this server offers Blender jobs (export FBX/USD, clean quads,
// render): the app shows those options only when it does.
import { blenderBusy, blenderOffered } from "@/lib/server/blender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const available = blenderOffered();
  return Response.json(
    { available, busy: available && blenderBusy() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

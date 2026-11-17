// Auto-rigging (lib/server/rig.ts): GET says whether this server
// offers it; POST a GLB with no skeleton, get it back rigged for its
// body, the kind of rig in X-IKO-Rig (human, quadruped or biped).
import { MAX_RIG_UPLOAD, RigError, rigOffered, runRig } from "@/lib/server/rig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

export function GET() {
  return Response.json(
    { available: rigOffered() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** The body, refusing more than `max` bytes even without a length. */
async function readCapped(
  req: Request,
  max: number,
): Promise<Uint8Array | null> {
  if (Number(req.headers.get("content-length") ?? "0") > max) return null;
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

export async function POST(req: Request) {
  if (!rigOffered()) return fail("Auto-rigging isn't available here.", 404);
  const body = await readCapped(req, MAX_RIG_UPLOAD);
  if (!body) return fail("That model is too large to rig here.", 413);
  try {
    const r = await runRig(body);
    return new Response(Buffer.from(r.bytes), {
      headers: {
        "Content-Type": "model/gltf-binary",
        "X-IKO-Rig": r.kind,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof RigError) return fail(e.message, e.status);
    return fail("The model couldn't be rigged.", 500);
  }
}

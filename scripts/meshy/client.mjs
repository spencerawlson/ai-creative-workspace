// A small client for Meshy's API (https://docs.meshy.ai), for scripts
// that run on a developer's machine. The key never goes to the browser:
// the app only ever serves the finished files from its own address.
//
// Every task is created with a POST that returns its id, then polled
// until it is SUCCEEDED or FAILED, waiting what `Retry-After` says (5 s
// without it). Result URLs are signed and expire after about 3 days, so
// callers download what they need straight away.

export const MESHY_BASE = "https://api.meshy.ai";

/** Where each kind of task lives. */
export const ENDPOINTS = {
  textTo3d: "/openapi/v2/text-to-3d",
  imageTo3d: "/openapi/v1/image-to-3d",
  rigging: "/openapi/v1/rigging",
};

const FINAL = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);
/** Meshy's advice: wait at least an hour before giving up on a task. */
const GIVE_UP_MS = 70 * 60 * 1000;

export class MeshyError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status) {
    super(message);
    this.name = "MeshyError";
    this.status = status;
  }
}

/**
 * @param {{
 *   key: string,
 *   fetch?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   log?: (line: string) => void,
 *   base?: string,
 * }} opts
 */
export function createMeshy(opts) {
  if (!opts.key) throw new MeshyError("No Meshy API key (MESHY_API_KEY).");
  const http = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const base = opts.base ?? MESHY_BASE;
  const headers = {
    Authorization: `Bearer ${opts.key}`,
    "Content-Type": "application/json",
  };

  /** @param {Response} res */
  async function problem(res) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.message ?? JSON.stringify(body);
    } catch {
      // No JSON body.
    }
    const why =
      res.status === 401
        ? "the API key was refused"
        : res.status === 402
          ? "creating tasks needs a paid Meshy plan, or the credits ran out"
          : res.status === 403
            ? "this key isn't allowed from this address"
            : res.status === 429
              ? "too many requests or tasks at once"
              : `HTTP ${res.status}`;
    return new MeshyError(
      `Meshy: ${why}${detail ? ` (${detail})` : ""}`,
      res.status,
    );
  }

  return {
    /** Create a task; returns its id. @param {keyof typeof ENDPOINTS} kind @param {object} body */
    async create(kind, body) {
      const res = await http(base + ENDPOINTS[kind], {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw await problem(res);
      const { result } = await res.json();
      if (typeof result !== "string") throw new MeshyError("Meshy: no task id");
      log(`  created ${kind} task ${result}`);
      return result;
    },

    /** One look at a task. @param {keyof typeof ENDPOINTS} kind @param {string} id */
    async get(kind, id) {
      const res = await http(`${base}${ENDPOINTS[kind]}/${id}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw await problem(res);
      return {
        task: await res.json(),
        retryAfter: Number(res.headers.get("Retry-After")) || 5,
      };
    },

    /** Wait for a task to finish; returns it when SUCCEEDED, throws when
     * it fails. @param {keyof typeof ENDPOINTS} kind @param {string} id */
    async wait(kind, id) {
      const start = now();
      let shown = "";
      for (;;) {
        const { task, retryAfter } = await this.get(kind, id);
        const line = `${task.status}${task.progress != null ? ` ${task.progress}%` : ""}`;
        if (line !== shown) log(`  ${kind} ${id}: ${line}`);
        shown = line;
        if (task.status === "SUCCEEDED") return task;
        if (FINAL.has(task.status))
          throw new MeshyError(
            `Meshy ${kind} task ${id} ${task.status.toLowerCase()}: ${task.task_error?.message || "no reason given"}`,
          );
        if (now() - start > GIVE_UP_MS)
          throw new MeshyError(
            `Meshy ${kind} task ${id} still ${task.status} after 70 minutes; run again later to pick it up.`,
          );
        await sleep(retryAfter * 1000);
      }
    },

    /** Download a result file (a signed URL; no key needed). @param {string} url */
    async download(url) {
      const res = await http(url, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok)
        throw new MeshyError(
          `Download failed: HTTP ${res.status}${res.status === 403 ? " (the link may have expired; Meshy keeps results about 3 days)" : ""}`,
          res.status,
        );
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

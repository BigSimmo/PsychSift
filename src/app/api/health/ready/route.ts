import { NextResponse } from "next/server";
import { healthResponse } from "@/lib/health-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// #L29: Railway's healthcheck target, so it cannot be gated behind auth or a
// durable per-request rate limit — the limiter itself would need a database
// round trip to check, defeating the point of bounding unauthenticated
// Supabase load. This route's response never depends on the caller: it forces
// the deep probe, allows it unauthenticated, and `probes: "readiness"` turns
// every optional probe off regardless of any token header (see the contract in
// health-response.ts). So a short in-process cache of the whole computed result
// is safe, and a burst of hits within the window shares one Supabase probe
// instead of paying for one each.
//
// That "never depends on the caller" claim is enforced here rather than assumed
// from the flags above. The cache holds ONLY the caller-invariant readiness
// payload, by two independent constraints: the probe runs against a canonical,
// header-free request (so `HEALTH_DEEP_PROBE_SECRET` / `x-health-deep-token` and
// query flags such as `answer_window` can never influence what is stored), and
// the stored body is an allowlist of top-level keys (so a diagnostic section such
// as `spend` or `ragProgramme` cannot be cached even if a future change to
// `health-response.ts` starts emitting it on this path). Anything that depends on
// the caller's authorization belongs to the per-request path, after the cache
// lookup, and never in `cachedReady`.
const READY_CACHE_TTL_MS = 2_000;

/**
 * The only top-level body keys the shared snapshot may carry. `siteContent` is the
 * public projection and stays governed by its own gate in `health-response.ts`;
 * the operator-only sections (`slo*`, `cache`, `coalescing`, `spend`,
 * `storageCleanup`, `ragProgramme`) are deliberately absent.
 */
const READY_BODY_ALLOWLIST = [
  "status",
  "demoMode",
  "timestamp",
  "uptimeSeconds",
  "deploymentCommitSha",
  "checks",
  "siteContent",
] as const;

type ReadySnapshot = { body: unknown; status: number };

function invariantBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const source = body as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of READY_BODY_ALLOWLIST) {
    if (key in source) kept[key] = source[key];
  }
  return kept;
}

/**
 * A request that carries nothing from the caller: no headers (so no probe token)
 * and no query string. The shared probe is computed from this, never from the
 * request that happened to start it.
 */
function canonicalProbeRequest(request: Request): Request {
  return new Request(new URL("/api/health/ready", request.url).toString());
}

let cachedReady: (ReadySnapshot & { expiresAt: number }) | null = null;

/**
 * The single in-flight probe, so a burst that arrives on a COLD cache shares one
 * Supabase round trip too.
 *
 * The cache alone only collapsed hits that arrived after a probe had already
 * finished. Every hit during the probe itself — the window that matters, because
 * it is exactly when the container is slow — was a fresh miss that started
 * another one. Railway's healthcheck retries during a slow start, so the
 * cold-container case was the one where this endpoint multiplied load rather
 * than bounding it.
 */
let pendingReady: Promise<ReadySnapshot> | null = null;

/**
 * Each caller gets its own response object.
 *
 * `NextResponse` carries a body stream that can only be read once, so handing the
 * same instance to several joined callers would leave all but the first with an
 * already-consumed body. The cached snapshot is plain data for that reason.
 */
function respond(snapshot: ReadySnapshot) {
  return NextResponse.json(snapshot.body, {
    status: snapshot.status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function computeReadySnapshot(request: Request): Promise<ReadySnapshot> {
  // `probes: "readiness"` is the whole contract, and it replaced six `include*: false` lines.
  //
  // Those six were a deny-list, and a deny-list on this endpoint is a deploy outage waiting for
  // its next entry. Whatever gets added to the deep branch is live on Railway's healthcheck
  // until somebody remembers to come back here and switch it off by name. Nobody did, for the
  // ~7 s site-content integrity audit, on an endpoint Railway allows ten seconds: 24 consecutive
  // production deploys built, started cleanly, answered too slowly and were rolled back, and the
  // live site sat on three-day-old code while `main` moved on.
  //
  // Now the endpoint states what it is instead of listing what it is not, so a probe added later
  // is diagnostic-only unless someone deliberately says otherwise in `health-response.ts`.
  // Readiness is a question about THIS CONTAINER: configuration, and one bounded Supabase
  // `select ... limit 1`. Nothing shared, nothing whole-corpus, nothing unbounded.
  const response = await healthResponse(canonicalProbeRequest(request), {
    forceDeep: true,
    allowUnauthenticatedDeep: true,
    probes: "readiness",
  });
  return { body: invariantBody((await response.json()) as unknown), status: response.status };
}

export async function GET(request: Request) {
  const cached = cachedReady;
  if (cached && cached.expiresAt > Date.now()) return respond(cached);

  // Join an in-flight probe rather than starting a second one.
  const joined = pendingReady;
  if (joined) {
    try {
      return respond(await joined);
    } catch {
      return unavailable();
    }
  }

  const operation = computeReadySnapshot(request).then((snapshot) => {
    // The window opens when the probe FINISHES, not when the request arrived.
    // Measuring it from request start meant a probe slower than the interval
    // produced an entry that was already expired on arrival — so the slower the
    // container, the less the cache helped, which is backwards.
    cachedReady = { ...snapshot, expiresAt: Date.now() + READY_CACHE_TTL_MS };
    return snapshot;
  });
  pendingReady = operation;

  try {
    return respond(await operation);
  } catch {
    // Fail closed and coarsely. An unexpected throw is not evidence the container
    // is healthy, and it must never fall back to a stale success: Railway reads
    // the status code to decide whether to keep this container in rotation, and
    // `scripts/lib/deployment-rag-activation.mjs` fails
    // `check:production-readiness` on a non-2xx. Nothing about the error is
    // echoed — a thrown dependency message is exactly the disclosure the 503 path
    // in health-response.ts already refuses to make.
    return unavailable();
  } finally {
    // Cleared on rejection as well, or one failed probe would pin every later
    // caller to the same rejected promise for the life of the process.
    if (pendingReady === operation) pendingReady = null;
  }
}

function unavailable() {
  return NextResponse.json({ status: "degraded" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

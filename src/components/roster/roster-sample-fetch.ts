import {
  DEMO_ME_ID,
  demoMyShifts,
  demoRosterLeave,
  demoRosterRead,
  demoRosterTeams,
} from "@/lib/roster/team/demo-team-core";
import type { RosterReadWhat } from "@/lib/roster/team/model";

/**
 * The signed-out sample of Roster: while it is installed, every Roster screen
 * reads its usual `/api/roster/...` addresses and is answered here, from the
 * invented sample team and doctor (`demo-team-core`), built around today's
 * date. Nothing is sent to the server and nothing is kept.
 *
 * - A read is answered from memory. Fatigue and rest-rule output is left out of
 *   the sample: the team's rules answer as empty, so no warning can appear.
 * - Any write (save, add, remove, swap, leave, settings, file read) is refused
 *   with "The sample doesn't save", before a request is made.
 * - Every other address (not under `/api/roster`) passes straight through to the real `fetch`.
 *
 * Loaded on demand by `RosterSampleGate`, only for a signed-out visitor.
 */

export const ROSTER_SAMPLE_REFUSAL = "The sample doesn't save. Sign in to use your own roster.";

const READS = new Set(["GET", "HEAD"]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function refusal() {
  return json({ error: ROSTER_SAMPLE_REFUSAL, message: ROSTER_SAMPLE_REFUSAL, code: "sample_read_only" }, 400);
}

const notInSample = () => json({ code: "sample_not_found", message: "That isn't in the sample." }, 404);

/** `/api/roster/team/<serviceId>?what=...&from=...&to=...` */
function teamReadFor(search: URLSearchParams, now: Date): Response {
  const what = (search.get("what") ?? "overview") as RosterReadWhat;
  const range = { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined };
  try {
    const answer = demoRosterRead(what, range, now);
    if (what !== "overview") return json(answer);
    // The sample shows no rest or fatigue rules: they await clinician sign-off.
    const overview = answer as ReturnType<typeof demoRosterRead<"overview">>;
    return json({ ...overview, settings: { ...overview.settings, rules: {}, rulesSource: null } });
  } catch {
    return json({ code: "roster_invalid_request", message: "The sample doesn't have that." }, 400);
  }
}

/** Every `/api/roster` request gets an answer here; none ever reaches the server. */
function answer(method: string, pathname: string, search: URLSearchParams): Response {
  const path = pathname
    .replace(/^\/api\/roster\/?/, "")
    .split("/")
    .filter(Boolean);
  if (!READS.has(method)) {
    // The one POST that only asks a question: no link is ever due in the sample.
    if (path[0] === "links" && path[1] === "refresh") return json({ results: [] });
    return refusal();
  }
  const now = new Date();
  switch (path[0]) {
    case "shifts":
      return json({ shifts: demoMyShifts(now), latestImport: null, demoMode: true });
    case "settings":
      return json({
        calendarShifts: false,
        alerts: { changes: true, requests: true },
        rowName: null,
        codes: {},
        demoMode: true,
      });
    case "links":
      return json({ links: [], demoMode: true });
    case "leave":
      return json({ leave: demoRosterLeave(now) });
    case "extra-time":
      return json({ records: [] });
    case "alerts":
      return json({ configured: false, publicKey: null });
    case "team":
      if (path.length === 1) return json({ teams: demoRosterTeams(), actorId: DEMO_ME_ID, sample: true });
      return path.length === 2 ? teamReadFor(search, now) : notInSample();
    default:
      return notInSample();
  }
}

/** Where the request goes, when it is one of ours; null for anything else. */
function rosterRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): { method: string; pathname: string; search: URLSearchParams } | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/roster")) return null;
  const method = (
    init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
  ).toUpperCase();
  return { method, pathname: url.pathname, search: url.searchParams };
}

/**
 * Start answering Roster requests from the sample. Returns the function that
 * puts the real `fetch` back.
 */
export function installRosterSampleFetch(): () => void {
  const real = window.fetch;
  const sample: typeof window.fetch = (input, init) => {
    const request = rosterRequest(input, init);
    if (!request) return real.call(window, input, init);
    return Promise.resolve(answer(request.method, request.pathname, request.search));
  };
  window.fetch = sample;
  return () => {
    if (window.fetch === sample) window.fetch = real;
  };
}

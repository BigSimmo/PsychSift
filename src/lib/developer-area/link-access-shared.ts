import { isDeveloperGatedPath } from "@/lib/developer-area/headers";

/**
 * The parts of the passwordless developer-area credential that must be readable
 * on BOTH sides of the network boundary.
 *
 * `link-access.ts` — which mints and verifies the token — imports `node:crypto`,
 * so a Client Component can never import it. The gate screen nonetheless needs
 * the query-parameter name and the URL shape, because the key field there works
 * by handing the typed secret to the very same `?devkey=` exchange in
 * `src/proxy.ts` rather than by adding a second, parallel verification path.
 * Splitting those constants out keeps one source of truth instead of a string
 * literal repeated in a component, which is the kind of duplicate that drifts
 * silently and leaves a field that can never succeed.
 *
 * Pure constants and pure functions only. Nothing here may import anything that
 * pulls a Node built-in in.
 */

/** Query parameter carrying the secret, e.g. `/admin/developer-hub?devkey=…`. */
export const DEVELOPER_ACCESS_QUERY_PARAM = "devkey";

/**
 * Marker `src/proxy.ts` puts on the redirect when a presented secret did NOT
 * verify, so the gate screen can say "that key wasn't accepted" instead of
 * silently re-rendering an identical form and leaving the owner to guess
 * whether anything happened.
 *
 * It carries no secret and reveals nothing a visitor did not already supply:
 * whoever sees it just typed the value it is a verdict on. The verdict is
 * produced by the server that holds the key, rather than inferred on the client
 * from a flag left in storage, because only the server actually knows.
 */
export const DEVELOPER_ACCESS_ERROR_PARAM = "devkeyerror";

/** Where the gate sends a visitor who asked for nothing in particular. Module-local:
 *  the one place that needs it is the fallback below, and exporting it would invite
 *  a second copy of the area root to drift from `DEVELOPER_GATED_PATH_PREFIXES`. */
const DEVELOPER_AREA_DEFAULT_PATH = "/admin/developer-hub";

/**
 * Splits the gate's `next` into the path it should return the visitor to and
 * whether the previous attempt's key was rejected.
 *
 * **The path is allowlisted, not denylisted.** `next` reaches the gate through a
 * request header, and the value built from it is handed to
 * `window.location.replace` carrying the secret the owner just typed — so a path
 * that escapes to another origin does not merely redirect, it posts the key to
 * whoever owns that origin.
 *
 * An earlier version of this guard rejected a leading `//` and accepted
 * everything else. That is one denylist entry short: a browser normalises `\` to
 * `/` for special schemes and strips tab, CR and LF before parsing, so
 * `/\evil.example`, `/<TAB>/evil.example`, `/<LF>/evil.example` and
 * `/<CR>/evil.example` all pass a `startsWith("//")` test and all resolve to
 * `https://evil.example/?devkey=…`. Measured against WHATWG `URL`, not assumed.
 *
 * So the test is now membership of `DEVELOPER_GATED_PATH_PREFIXES` — the only
 * paths this screen is ever reached from — via the same `isDeveloperGatedPath`
 * the proxy uses. Anything else falls back to the area root, query and all,
 * rather than being repaired into something that merely looks safe.
 *
 * The error marker is stripped from the returned target, so a retry — and the
 * eventual successful redirect — does not carry a stale verdict from an attempt
 * two tries ago.
 */
export function parseDeveloperGateTarget(next: string | null | undefined): {
  target: string;
  keyRejected: boolean;
} {
  const [withoutHash = ""] = (next ?? "").split("#");
  const [requestedPathname = "", search = ""] = withoutHash.split("?");
  const allowed = isDeveloperGatedPath(requestedPathname);
  const pathname = allowed ? requestedPathname : DEVELOPER_AREA_DEFAULT_PATH;
  const params = new URLSearchParams(allowed ? search : "");
  const keyRejected = params.get(DEVELOPER_ACCESS_ERROR_PARAM) === "1";
  params.delete(DEVELOPER_ACCESS_ERROR_PARAM);
  const remaining = params.toString();
  return { target: remaining ? `${pathname}?${remaining}` : pathname, keyRejected };
}

/**
 * The URL that submits a typed developer key: the page the visitor asked for,
 * with the secret attached for `src/proxy.ts` to exchange for the signed cookie
 * and immediately strip.
 *
 * The key field deliberately produces this URL instead of POSTing to a new
 * route. The exchange, the cookie, the constant-time comparison and the
 * stripping redirect are already built and covered by `tests/proxy.test.ts`; a
 * second entry point would be another place the same secret is verified, and
 * the two could not drift apart without one of them quietly failing open.
 */
export function developerKeyUnlockUrl(next: string | null | undefined, key: string): string {
  const { target } = parseDeveloperGateTarget(next);
  const [pathname = DEVELOPER_AREA_DEFAULT_PATH, search = ""] = target.split("?");
  const params = new URLSearchParams(search);
  params.set(DEVELOPER_ACCESS_QUERY_PARAM, key);
  return `${pathname}?${params.toString()}`;
}

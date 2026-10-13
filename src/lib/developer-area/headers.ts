// Shared between `src/proxy.ts` and the Server Components it signals to
// (`src/app/mockups/layout.tsx`, `DeveloperAreaGate`). Pure string constants only
// — no side effects, no stateful singletons — so this is safe to import from a
// Proxy file per its "no shared modules/globals" guidance.
//
// Deliberately not under `src/lib/mockups/**` or anything matching `*mockup*`:
// this is real production authorization code (it runs in `src/proxy.ts` on
// every request), and `no-restricted-imports` forbids production code from
// depending on anything path-matched as mockup/design-scratch.

/** Set to "1" by proxy.ts only for the gated prefixes below; stripped from every
 *  other /mockups/** request so a client cannot spoof it and read a hidden
 *  design-scratch mockup by sending the header itself. */
export const DEVELOPER_AREA_HEADER = "x-developer-area";

/** The exact requested path+query, so a sign-in redirect can return the visitor
 *  to the specific page they asked for (e.g. a deep Care Plan route), not
 *  just the area root. */
export const DEVELOPER_AREA_PATH_HEADER = "x-developer-area-path";

/** Exact prefixes only. A path that merely begins with the same characters —
 *  `/mockups/care-plan-archive`, say — is not a match and stays behind the
 *  blanket production block, because `isDeveloperGatedPath` requires either an
 *  exact hit or a following `/`. Add a prefix here one subtree at a time; never
 *  widen this to `/mockups`. */
export const DEVELOPER_GATED_PATH_PREFIXES = [
  "/admin/developer-hub",
  "/admin/care-plan",
  "/mockups/development",
  "/mockups/care-plan",
] as const;

/**
 * Whether a pathname is inside one of the gated subtrees. Exact-or-slash, so a
 * look-alike such as `/mockups/care-plan-archive` is NOT a match.
 *
 * Lives here, beside the prefixes, because two callers need it and they cannot
 * share code any other way: `src/proxy.ts` runs on the server, and
 * `link-access-shared.ts` is reachable from a Client Component. A second copy of
 * this predicate is exactly the duplicate that drifts — and one of its callers
 * is a security guard, where drifting means failing open.
 */
export function isDeveloperGatedPath(pathname: string): boolean {
  return DEVELOPER_GATED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

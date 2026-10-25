import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { isAdministratorUser } from "@/lib/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEVELOPER_ACCESS_COOKIE, developerAccessTokenValid } from "@/lib/developer-area/link-access";

export type DeveloperAccessState = "authorized" | "unauthenticated" | "unauthorized";

export type DeveloperAccessResult = { state: DeveloperAccessState; email: string | null };

/**
 * Whether `DeveloperAreaGate` may skip the administrator sign-in check
 * entirely, without going through `resolveDeveloperAccessState()`.
 *
 * Outside production this always returns true — every other `/mockups/**`
 * route is already unauthenticated there, so the gated subtrees match. In a
 * production-like environment it returns true ONLY under the exact same
 * double-flag pairing `src/proxy.ts`'s `shouldBlockProductionMockups` uses to
 * let the isolated Playwright production build's `@mockup` journeys reach
 * these prefixes (`PLAYWRIGHT_OFFLINE_MODE=true` together with
 * `NEXT_PUBLIC_MOCKUPS_ENABLED=true`). `NEXT_PUBLIC_MOCKUPS_ENABLED=true` on
 * its own must never disable the administrator gate on a real deployment —
 * that was #L30: a single public build-time flag, set alone, opened the
 * Development hub, the Caring Contact and Care Plan prototypes and Ward Flow
 * to any unauthenticated visitor.
 */
export function developerGateBypassAllowed(environment: Record<string, string | undefined> = process.env): boolean {
  if (environment.NODE_ENV !== "production") return true;
  return environment.PLAYWRIGHT_OFFLINE_MODE === "true" && environment.NEXT_PUBLIC_MOCKUPS_ENABLED === "true";
}

/**
 * Gate for the in-progress surfaces linked from Settings ("Development"): the
 * same administrator claim (`app_metadata.site_role === "administrator"`)
 * that already gates document/corpus management, per `src/lib/authorization.ts`.
 * Reused deliberately rather than a new role — a second, parallel authorization
 * concept for a single-admin deployment would be pure duplication.
 */
export const resolveDeveloperAccessState = cache(async (): Promise<DeveloperAccessResult> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { state: "unauthenticated", email: null };

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { state: "unauthenticated", email: null };

  return {
    state: isAdministratorUser(user) ? "authorized" : "unauthorized",
    email: user.email ?? null,
  };
});

/**
 * Whether this request carries a valid passwordless access cookie — the secret
 * link the owner bookmarks, exchanged for a signed cookie by `src/proxy.ts`.
 *
 * A second, independent credential for the same subtree, checked BEFORE the
 * Supabase round trip so the common case (his own laptop, cookie held) renders
 * without an auth call at all. It grants exactly what the administrator claim
 * grants and nothing more: reaching the page. The panels that read live data
 * still require the administrator claim themselves — `environment-facts.ts` and
 * `corpus-health.ts` call `isAdministratorUser` on their own, and degrade to
 * "unavailable" rather than serving a document count to a link holder. That
 * separation is deliberate. Do not "simplify" it by having those panels trust
 * this cookie: the link is a convenience credential that can be forwarded in a
 * message, and the corpus is the clinical library.
 */
export async function developerLinkAccessGranted(): Promise<boolean> {
  const cookieStore = await cookies();
  return developerAccessTokenValid(cookieStore.get(DEVELOPER_ACCESS_COOKIE)?.value);
}

/**
 * The same admission decision `DeveloperAreaGate` makes, as one yes or no, for
 * the developer-hub pages to check for themselves. The layout gate alone is not
 * enough: on a client-side navigation the App Router can skip re-rendering a
 * shared layout, so a hand-made request that claims the layout is already
 * mounted gets the page payload without the gate ever running. Each page that
 * renders repository data on the server therefore checks again and renders
 * nothing when this is false; the layout gate still shows the sign-in screen
 * on an ordinary request. Wrapped in `cache` (as is
 * `resolveDeveloperAccessState`) so the layout and page share one auth lookup.
 */
export const developerAreaRequestAuthorized = cache(async (): Promise<boolean> => {
  if (developerGateBypassAllowed()) return true;
  if (await developerLinkAccessGranted()) return true;
  return (await resolveDeveloperAccessState()).state === "authorized";
});

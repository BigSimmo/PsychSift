// src/lib/caring-contacts-server/session.ts
//
// The demo role switcher. The decision lock requires WA Health enterprise sign-on and states that
// no Caring-Contacts-local credentials exist, so this is deliberately NOT a login and must never
// look like one -- it is a role switcher, labelled as one, that exists because the permission and
// auditor surfaces cannot be demonstrated without it.
//
// The cookie it reads holds only a role name, never a credential. Anything unreadable -- no
// cookie, an empty value, a name that is not one of DEMO_ROLES -- falls back to the coordinator
// rather than throwing: an unreadable cookie must never lock someone out of a demonstration.
// The demonstration itself is unavailable in production until enterprise authentication exists.
import "server-only";

import { cookies } from "next/headers";

import { actorId, teamId, type TeamId } from "@/lib/caring-contacts/ids";
import type { Actor, CaringContactRole } from "@/lib/caring-contacts/permissions";

export const CARING_CONTACTS_ROLE_COOKIE = "caring-contacts-demo-role";

/**
 * The role switcher is a development/test demonstration aid, not authentication.
 *
 * A caller can forge a role-only cookie outside a browser, so `httpOnly` is not
 * an authorization boundary. Until enterprise authentication supplies a real
 * actor, all Caring Contacts routes must fail closed in production — with one
 * narrow, doubly-flagged exception for the isolated Playwright server, argued in
 * full at the return below and pinned by the "the production lock" tests.
 */
export function isCaringContactsDemoEnabled(
  environment = process.env.NODE_ENV,
  // Same shape `shouldBlockProductionMockups` uses for the same reason: `process.env`
  // is an index signature, so a named-optional type is rejected as a weak type.
  runtime: Record<string, string | undefined> = process.env,
): boolean {
  if (environment !== "production") return true;

  // The single exception, and it is the same one `shouldBlockProductionMockups`
  // (src/proxy.ts) already makes for /mockups: the repository-owned isolated
  // Playwright server builds a real production app so the browser gate tests what
  // ships, and that gate is the only check that has ever caught this workspace's
  // rendering defects. Both flags are required, and neither is reachable by a real
  // deployment: `instrumentation.ts` refuses to start a production process with
  // PLAYWRIGHT_OFFLINE_MODE unless NEXT_DIST_DIR is the runner's isolated output
  // AND the process is provider-free (inert loopback Supabase, no service-role key,
  // no OpenAI key), and it throws outright on demo mode in any other production
  // build. So this widens reachability only inside a process that has no providers
  // and no real data to reach.
  return runtime.PLAYWRIGHT_OFFLINE_MODE === "true" && runtime.NEXT_PUBLIC_DEMO_MODE === "true";
}

/** Thrown when code tries to resolve a demo actor in a production process. */
export class CaringContactsDemoUnavailableError extends Error {
  constructor() {
    super("Caring Contacts demo actors are unavailable in production.");
    this.name = "CaringContactsDemoUnavailableError";
  }
}

/** All five roles, in the order the switcher offers them. */
export const DEMO_ROLES: readonly CaringContactRole[] = Object.freeze([
  "coordinator",
  "teamLead",
  "auditor",
  "clinicalProgrammeLead",
  "livedExperienceRepresentative",
]);

const DEFAULT_DEMO_ROLE: CaringContactRole = "coordinator";

/** The one team every demo actor belongs to -- there is no multi-team demo. */
export const DEMO_TEAM_ID: TeamId = teamId("demo-team");

/** True for a value that names one of DEMO_ROLES. Exported so the route handler validates
 * against the same list this module resolves against, rather than a second copy that could drift. */
export function isDemoRole(value: unknown): value is CaringContactRole {
  return typeof value === "string" && (DEMO_ROLES as readonly string[]).includes(value);
}

/** The actor id names the acting role, e.g. `demo-auditor`, so the audit trail can show it. */
export function demoActorForRole(role: CaringContactRole): Actor {
  return { id: actorId(`demo-${role}`), teamId: DEMO_TEAM_ID, roles: [role] };
}

/**
 * Reads the demo role cookie and resolves the actor it names. Falls back to the coordinator for
 * anything unreadable rather than throwing -- see the module note above. That includes the read
 * itself failing (`cookies()` rejecting, or `.get()` throwing), not only an unrecognised value:
 * a caller that let either propagate would produce exactly the locked-out-of-a-demonstration
 * outcome this fallback exists to prevent.
 */
export async function resolveDemoActor(): Promise<Actor> {
  if (!isCaringContactsDemoEnabled()) throw new CaringContactsDemoUnavailableError();
  const role = await readDemoRoleCookie();
  return demoActorForRole(role);
}

async function readDemoRoleCookie(): Promise<CaringContactRole> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(CARING_CONTACTS_ROLE_COOKIE)?.value;
    return isDemoRole(raw) ? raw : DEFAULT_DEMO_ROLE;
  } catch {
    return DEFAULT_DEMO_ROLE;
  }
}

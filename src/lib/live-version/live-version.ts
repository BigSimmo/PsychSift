/**
 * The live version switch: lets the site owner use the newest work on the real
 * site, with real data and real behaviour, before it is turned on for everyone.
 *
 * Work that is not ready for everyone merges behind a preview feature listed in
 * `features.ts`. Testers see it while their switch is on "Newest". Everyone else
 * always gets "Everyone's version" and never sees the switch, whatever their
 * cookie says.
 *
 * Who is a tester is decided on the server from the signed-in user the proxy
 * verified, never from the browser: the administrator (`app_metadata.site_role`,
 * the claim that already gates document upload and the developer area), anyone
 * whose app metadata carries `work_mode_preview: true`, or anyone listed in
 * `WORK_MODE_PREVIEW_USER_IDS`. The cookie only chooses between the two versions
 * for someone already in that audience. No migration and no deploy step.
 *
 * Outside production, and in the isolated offline Playwright build, every preview
 * feature is on by default (so builders and tests see the newest work with no
 * setup), the cookie can still turn it off, and the switch itself is not shown
 * unless the signed-in user is a tester.
 *
 * Pure and isomorphic, so the proxy, the server layout and tests decide the same way.
 */

import { isAdministratorAppMetadata } from "@/lib/authorization";

/** Device cookie holding the tester's choice. Cleared at every account transition. */
export const LIVE_VERSION_COOKIE = "psychsift-live-version";
export const LIVE_VERSION_NEWEST = "newest";
export const LIVE_VERSION_EVERYONE = "everyone";

export type LiveVersionChoice = typeof LIVE_VERSION_NEWEST | typeof LIVE_VERSION_EVERYONE;

export type LiveVersionUser = {
  readonly id: string;
  readonly appMetadata: Record<string, unknown>;
};

export type LiveVersion = {
  /** This reader is a tester, so Settings shows the switch. */
  readonly available: boolean;
  /** Preview features are on for this request. */
  readonly newest: boolean;
};

type LiveVersionEnvironment = Record<string, string | undefined>;

export function liveVersionRelaxed(environment: LiveVersionEnvironment): boolean {
  return environment.NODE_ENV !== "production" || environment.PLAYWRIGHT_OFFLINE_MODE === "true";
}

function testerIds(environment: LiveVersionEnvironment): ReadonlySet<string> {
  return new Set(
    (environment.WORK_MODE_PREVIEW_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** A tester: the administrator, a user flagged in app metadata, or a listed user id. */
export function isLiveVersionTester(user: LiveVersionUser | null, environment: LiveVersionEnvironment): boolean {
  if (!user) return false;
  if (isAdministratorAppMetadata(user.appMetadata)) return true;
  if (user.appMetadata.work_mode_preview === true) return true;
  return testerIds(environment).has(user.id.toLowerCase());
}

export function resolveLiveVersion({
  user,
  environment,
  choice,
}: {
  user: LiveVersionUser | null;
  environment: LiveVersionEnvironment;
  choice?: string | null;
}): LiveVersion {
  const tester = isLiveVersionTester(user, environment);
  const allowed = tester || liveVersionRelaxed(environment);
  // Newest is the default for a tester: the point is to try new work on the real site.
  return { available: tester, newest: allowed && choice !== LIVE_VERSION_EVERYONE };
}

/**
 * What a component sees when no provider is mounted above it: newest in dev and
 * tests (no wrapper needed), everyone's version in a production bundle, so a page
 * that escapes the provider fails safe.
 */
export const LIVE_VERSION_FALLBACK: LiveVersion = {
  available: false,
  newest: process.env.NODE_ENV !== "production",
};

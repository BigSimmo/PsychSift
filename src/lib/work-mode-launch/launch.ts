/**
 * The work-mode launch switch: who sees the new work-mode screens (the routes in
 * `routes.ts` and the links into them). The restyled existing pages and their frame
 * ship to everyone: they replaced the old pages in place, so there is no classic
 * version to fall back to (decision card to Josh, 7 October 2026). Example and sample data is a separate switch, owned by
 * the example-data work; this file decides only which work mode a reader gets.
 *
 * Pure and isomorphic, so the proxy (route hiding), the server layout (what the
 * page renders) and tests all decide the same way from the same three inputs:
 * the signed-in user's verified id and app metadata, the server environment, and
 * the device's own "classic" preference cookie.
 *
 * Three controls, from slowest to fastest, none of which needs a migration:
 *
 *   1. `WORK_MODE_LAUNCH` (server env): `off`, `preview` or `everyone`. The
 *      audience switch. Unset means `preview` in production. Changing it is a
 *      Railway variable change, so the app restarts but nothing is rebuilt.
 *   2. The preview audience: the administrator (`app_metadata.site_role`, the
 *      same claim that already gates the developer area), anyone listed in
 *      `WORK_MODE_PREVIEW_USER_IDS`, or anyone whose app metadata carries
 *      `work_mode_preview: true` (set in the Supabase dashboard, no deploy).
 *   3. The device preference cookie `psychsift-work-mode=classic`. Instant, one
 *      tap in Settings, no deploy: the reader is back without the new screens
 *      on the next page load. It can only turn them off, never on.
 *
 * Outside production, and in the isolated offline Playwright build, the default
 * is `everyone`, so local previews, unit tests and browser
 * journeys keep seeing the new mode with no setup. An explicit env value still wins.
 */

import { isAdministratorAppMetadata } from "@/lib/authorization";

export const WORK_MODE_PREFERENCE_COOKIE = "psychsift-work-mode";
export const WORK_MODE_CLASSIC_PREFERENCE = "classic";

export type WorkModeLaunchSetting = "off" | "preview" | "everyone";

export type WorkModeLaunchUser = {
  readonly id: string;
  readonly appMetadata: Record<string, unknown>;
};

export type WorkModeLaunch = {
  /** Draw the new work-mode frame and allow the new work-mode screens. */
  readonly newWorkMode: boolean;
  /** This reader is in the preview audience (whatever the device preference says). */
  readonly previewAudience: boolean;
  /** The reader chose the classic work mode on this device. */
  readonly classicPreferred: boolean;
  /** The new work mode is on offer to this reader, so Settings shows the classic switch. */
  readonly choiceAvailable: boolean;
};

type LaunchEnvironment = Record<string, string | undefined>;

const LAUNCH_SETTINGS: ReadonlySet<string> = new Set(["off", "preview", "everyone"]);

function relaxedDefaults(environment: LaunchEnvironment): boolean {
  return environment.NODE_ENV !== "production" || environment.PLAYWRIGHT_OFFLINE_MODE === "true";
}

export function workModeLaunchSetting(environment: LaunchEnvironment): WorkModeLaunchSetting {
  const value = environment.WORK_MODE_LAUNCH?.trim().toLowerCase();
  if (value && LAUNCH_SETTINGS.has(value)) return value as WorkModeLaunchSetting;
  // An unrecognised value is a typo in a live switch: fail closed to the preview audience.
  if (value) return "preview";
  return relaxedDefaults(environment) ? "everyone" : "preview";
}

function previewUserIds(environment: LaunchEnvironment): ReadonlySet<string> {
  return new Set(
    (environment.WORK_MODE_PREVIEW_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isWorkModePreviewUser(user: WorkModeLaunchUser | null, environment: LaunchEnvironment): boolean {
  if (!user) return false;
  if (isAdministratorAppMetadata(user.appMetadata)) return true;
  if (user.appMetadata.work_mode_preview === true) return true;
  return previewUserIds(environment).has(user.id.toLowerCase());
}

export function resolveWorkModeLaunch({
  user,
  environment,
  preference,
}: {
  user: WorkModeLaunchUser | null;
  environment: LaunchEnvironment;
  preference?: string | null;
}): WorkModeLaunch {
  const setting = workModeLaunchSetting(environment);
  const relaxed = relaxedDefaults(environment);
  // Relaxed (dev, tests, offline browser build) has no signed-in user to check, so
  // the whole device counts as the preview audience there.
  const previewAudience = relaxed || isWorkModePreviewUser(user, environment);
  const classicPreferred = preference === WORK_MODE_CLASSIC_PREFERENCE;
  const audienceAllowed = setting === "everyone" || (setting === "preview" && previewAudience);
  const newWorkMode = audienceAllowed && !classicPreferred;
  return { newWorkMode, previewAudience, classicPreferred, choiceAvailable: audienceAllowed };
}

/**
 * What a component sees when no launch provider is mounted above it: open in dev
 * and tests (so a component test needs no wrapper), closed in a production bundle,
 * so a page that escapes the provider fails safe to the classic work mode.
 */
export const WORK_MODE_LAUNCH_FALLBACK: WorkModeLaunch =
  process.env.NODE_ENV === "production"
    ? { newWorkMode: false, previewAudience: false, classicPreferred: false, choiceAvailable: false }
    : { newWorkMode: true, previewAudience: true, classicPreferred: false, choiceAvailable: true };

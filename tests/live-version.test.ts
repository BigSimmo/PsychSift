import { describe, expect, it } from "vitest";

import { LIVE_PREVIEW_FEATURES } from "@/lib/live-version/features";
import { isLiveVersionTester, resolveLiveVersion, type LiveVersionUser } from "@/lib/live-version/live-version";
import { resolveWorkModeLaunch } from "@/lib/work-mode-launch/launch";

const PROD = { NODE_ENV: "production" };
const admin: LiveVersionUser = { id: "a1", appMetadata: { site_role: "administrator" } };
const doctor: LiveVersionUser = { id: "D2", appMetadata: {} };

describe("live version switch", () => {
  it("gives a tester the newest version by default and lets them switch to everyone's", () => {
    expect(resolveLiveVersion({ user: admin, environment: PROD })).toEqual({ available: true, newest: true });
    expect(resolveLiveVersion({ user: admin, environment: PROD, choice: "everyone" })).toEqual({
      available: true,
      newest: false,
    });
  });

  it("never shows the switch or the newest version to anyone else, whatever their cookie says", () => {
    expect(resolveLiveVersion({ user: doctor, environment: PROD, choice: "newest" })).toEqual({
      available: false,
      newest: false,
    });
    expect(resolveLiveVersion({ user: null, environment: PROD, choice: "newest" })).toEqual({
      available: false,
      newest: false,
    });
  });

  it("counts the administrator, the app-metadata flag and listed ids as testers, never user-editable metadata", () => {
    expect(isLiveVersionTester(admin, PROD)).toBe(true);
    expect(isLiveVersionTester({ id: "z", appMetadata: { work_mode_preview: true } }, PROD)).toBe(true);
    expect(isLiveVersionTester({ id: "z", appMetadata: { work_mode_preview: "true" } }, PROD)).toBe(false);
    expect(isLiveVersionTester({ id: "z", appMetadata: { site_role: "Administrator " } }, PROD)).toBe(false);
    expect(isLiveVersionTester(doctor, { ...PROD, WORK_MODE_PREVIEW_USER_IDS: "x, d2 " })).toBe(true);
  });

  it("shows the newest work with no switch in dev and tests, and the cookie can still turn it off", () => {
    expect(resolveLiveVersion({ user: null, environment: { NODE_ENV: "test" } })).toEqual({
      available: false,
      newest: true,
    });
    expect(
      resolveLiveVersion({ user: null, environment: { NODE_ENV: "development" }, choice: "everyone" }).newest,
    ).toBe(false);
  });

  it("hides the new work screens from a tester on everyone's version while the launch is in preview", () => {
    expect(resolveWorkModeLaunch({ user: admin, environment: PROD }).newWorkMode).toBe(true);
    const everyone = resolveWorkModeLaunch({ user: admin, environment: PROD, liveVersion: "everyone" });
    expect(everyone).toMatchObject({ newWorkMode: false, choiceAvailable: false });
    // Once launched to everyone, the switch no longer holds them back.
    const launched = { ...PROD, WORK_MODE_LAUNCH: "everyone" };
    expect(resolveWorkModeLaunch({ user: admin, environment: launched, liveVersion: "everyone" }).newWorkMode).toBe(
      true,
    );
  });

  it("keeps feature ids unique and dated", () => {
    const ids = LIVE_PREVIEW_FEATURES.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const feature of LIVE_PREVIEW_FEATURES) expect(feature.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

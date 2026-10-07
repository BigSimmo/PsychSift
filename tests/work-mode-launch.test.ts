import { describe, expect, it } from "vitest";

import {
  isWorkModePreviewUser,
  resolveWorkModeLaunch,
  workModeLaunchSetting,
  type WorkModeLaunchUser,
} from "@/lib/work-mode-launch/launch";
import { matchesWorkModeRoute, NEW_WORK_MODE_ROUTES, workModeRouteHidden } from "@/lib/work-mode-launch/routes";

const PROD = { NODE_ENV: "production" };
const admin: WorkModeLaunchUser = { id: "a1", appMetadata: { site_role: "administrator" } };
const doctor: WorkModeLaunchUser = { id: "D2", appMetadata: {} };

describe("work-mode launch switch", () => {
  it("defaults to the preview audience in production and to everyone elsewhere", () => {
    expect(workModeLaunchSetting(PROD)).toBe("preview");
    expect(workModeLaunchSetting({ NODE_ENV: "development" })).toBe("everyone");
    expect(workModeLaunchSetting({ NODE_ENV: "test" })).toBe("everyone");
    expect(workModeLaunchSetting({ NODE_ENV: "production", PLAYWRIGHT_OFFLINE_MODE: "true" })).toBe("everyone");
  });

  it("fails closed to preview on a typo, and an explicit value wins outside production", () => {
    expect(workModeLaunchSetting({ ...PROD, WORK_MODE_LAUNCH: "evryone" })).toBe("preview");
    expect(workModeLaunchSetting({ NODE_ENV: "development", WORK_MODE_LAUNCH: "off" })).toBe("off");
    expect(workModeLaunchSetting({ ...PROD, WORK_MODE_LAUNCH: " Everyone " })).toBe("everyone");
  });

  it("shows the new work mode in production only to the preview audience", () => {
    expect(resolveWorkModeLaunch({ user: admin, environment: PROD }).newWorkMode).toBe(true);
    expect(resolveWorkModeLaunch({ user: doctor, environment: PROD }).newWorkMode).toBe(false);
    expect(resolveWorkModeLaunch({ user: null, environment: PROD }).newWorkMode).toBe(false);
  });

  it("admits listed user ids and the app-metadata flag, never user-editable metadata", () => {
    expect(isWorkModePreviewUser(doctor, { ...PROD, WORK_MODE_PREVIEW_USER_IDS: "x, d2 " })).toBe(true);
    expect(isWorkModePreviewUser({ id: "z", appMetadata: { work_mode_preview: true } }, PROD)).toBe(true);
    expect(isWorkModePreviewUser({ id: "z", appMetadata: { work_mode_preview: "true" } }, PROD)).toBe(false);
    expect(isWorkModePreviewUser(null, { ...PROD, WORK_MODE_PREVIEW_USER_IDS: "" })).toBe(false);
  });

  it("turns everything off with WORK_MODE_LAUNCH=off, even for the administrator", () => {
    const launch = resolveWorkModeLaunch({ user: admin, environment: { ...PROD, WORK_MODE_LAUNCH: "off" } });
    expect(launch).toMatchObject({ newWorkMode: false, choiceAvailable: false });
  });

  it("lets the device preference roll back instantly, but never switch the mode on", () => {
    const classic = resolveWorkModeLaunch({ user: admin, environment: PROD, preference: "classic" });
    expect(classic).toMatchObject({
      newWorkMode: false,
      sampleScreens: false,
      classicPreferred: true,
      choiceAvailable: true,
    });
    const forced = resolveWorkModeLaunch({ user: doctor, environment: PROD, preference: "new" });
    expect(forced.newWorkMode).toBe(false);
    expect(forced.choiceAvailable).toBe(false);
  });
});

describe("work-mode launch routes", () => {
  const classic = { newWorkMode: false };
  const launched = { newWorkMode: true };

  it("matches whole path segments only", () => {
    expect(matchesWorkModeRoute(NEW_WORK_MODE_ROUTES, "/admin/pay")).toBe(true);
    expect(matchesWorkModeRoute(NEW_WORK_MODE_ROUTES, "/admin/pay/2026")).toBe(true);
    expect(matchesWorkModeRoute(NEW_WORK_MODE_ROUTES, "/admin/pay/")).toBe(true);
    expect(matchesWorkModeRoute(NEW_WORK_MODE_ROUTES, "/admin/payslip")).toBe(false);
    expect(matchesWorkModeRoute(NEW_WORK_MODE_ROUTES, "/admin/compliance")).toBe(false);
  });

  it("hides new-only screens on the classic work mode and leaves existing screens alone", () => {
    expect(workModeRouteHidden("/cme/applications/cv", classic)).toBe(true);
    expect(workModeRouteHidden("/cme/log", classic)).toBe(false);
    expect(workModeRouteHidden("/my-day", classic)).toBe(false);
    expect(workModeRouteHidden("/cme/applications/cv", launched)).toBe(false);
    expect(workModeRouteHidden("/cme/applications?tab=cv#top", classic)).toBe(true);
  });

  it("keeps every entry an absolute path with no trailing slash or query in the path", () => {
    for (const entry of NEW_WORK_MODE_ROUTES) {
      expect(entry.path).toMatch(/^\/[a-z0-9/-]+[a-z0-9]$/);
      expect(entry.owner).not.toBe("");
    }
  });
});

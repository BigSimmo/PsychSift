import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isWorkModePreviewUser,
  resolveWorkModeLaunch,
  WORK_MODE_LAUNCH_DEFAULT,
  workModeLaunchSetting,
  type WorkModeLaunchUser,
} from "@/lib/work-mode-launch/launch";
import { matchesWorkModeRoute, NEW_WORK_MODE_ROUTES, workModeRouteHidden } from "@/lib/work-mode-launch/routes";

const PROD = { NODE_ENV: "production" };
const admin: WorkModeLaunchUser = { id: "a1", appMetadata: { site_role: "administrator" } };
const doctor: WorkModeLaunchUser = { id: "D2", appMetadata: {} };

describe("work-mode launch switch", () => {
  it("defaults to everyone, in production and elsewhere", () => {
    expect(workModeLaunchSetting(PROD)).toBe("everyone");
    expect(workModeLaunchSetting({ NODE_ENV: "development" })).toBe("everyone");
    expect(workModeLaunchSetting({ NODE_ENV: "test" })).toBe("everyone");
    expect(workModeLaunchSetting({ NODE_ENV: "production", PLAYWRIGHT_OFFLINE_MODE: "true" })).toBe("everyone");
  });

  it("fails closed to preview on a typo, and an explicit value wins outside production", () => {
    expect(workModeLaunchSetting({ ...PROD, WORK_MODE_LAUNCH: "evryone" })).toBe("preview");
    expect(workModeLaunchSetting({ NODE_ENV: "development", WORK_MODE_LAUNCH: "off" })).toBe("off");
    expect(workModeLaunchSetting({ ...PROD, WORK_MODE_LAUNCH: " Everyone " })).toBe("everyone");
  });

  it("states the unset default explicitly as everyone, for every reader including signed out", () => {
    expect(WORK_MODE_LAUNCH_DEFAULT).toBe("everyone");
    expect(workModeLaunchSetting({ ...PROD, WORK_MODE_LAUNCH: "" })).toBe("everyone");
    expect(workModeLaunchSetting({ ...PROD, WORK_MODE_LAUNCH: "  " })).toBe("everyone");
    for (const user of [admin, doctor, null]) {
      expect(resolveWorkModeLaunch({ user, environment: PROD })).toMatchObject({
        newWorkMode: true,
        choiceAvailable: true,
      });
    }
  });

  it("rolls back from Railway: off hides the new work mode from everyone, the administrator too", () => {
    const off = { ...PROD, WORK_MODE_LAUNCH: "off" };
    for (const user of [admin, doctor, null]) {
      expect(resolveWorkModeLaunch({ user, environment: off })).toMatchObject({
        newWorkMode: false,
        choiceAvailable: false,
      });
    }
  });

  it("honours a device's classic choice under the everyone default", () => {
    expect(resolveWorkModeLaunch({ user: doctor, environment: PROD, preference: "classic" })).toMatchObject({
      newWorkMode: false,
      classicPreferred: true,
      choiceAvailable: true,
    });
  });

  it("shows the new work mode to everyone in production, or only to the preview audience under preview", () => {
    expect(resolveWorkModeLaunch({ user: doctor, environment: PROD }).newWorkMode).toBe(true);
    const preview = { ...PROD, WORK_MODE_LAUNCH: "preview" };
    expect(resolveWorkModeLaunch({ user: admin, environment: preview }).newWorkMode).toBe(true);
    expect(resolveWorkModeLaunch({ user: doctor, environment: preview }).newWorkMode).toBe(false);
    expect(resolveWorkModeLaunch({ user: null, environment: preview }).newWorkMode).toBe(false);
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
      classicPreferred: true,
      choiceAvailable: true,
    });
    const forced = resolveWorkModeLaunch({
      user: doctor,
      environment: { ...PROD, WORK_MODE_LAUNCH: "preview" },
      preference: "new",
    });
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

  it("matches a new view of an existing page by its query, and leaves the page itself alone", () => {
    const entries = [{ path: "/teaching/example", query: { view: "inbox" }, owner: "test" }];
    expect(matchesWorkModeRoute(entries, "/teaching/example", new URLSearchParams("view=inbox&as=supervisor"))).toBe(
      true,
    );
    expect(matchesWorkModeRoute(entries, "/teaching/example", new URLSearchParams("view=overview"))).toBe(false);
    expect(matchesWorkModeRoute(entries, "/teaching/example")).toBe(false);
  });

  it("leaves every Assessments example screen open to classic readers, who include every signed-out reader", () => {
    for (const href of [
      "/teaching/assessments",
      "/teaching/assessments?view=inbox&as=supervisor",
      "/teaching/assessments?view=overview",
      "/teaching/assessments/record",
      "/teaching/assessments/help",
      "/teaching/assessments/export",
      "/teaching/assessments/trainee",
      "/teaching/assessments/trainee/ash",
    ]) {
      expect(workModeRouteHidden(href, classic)).toBe(false);
    }
  });

  it("keeps My Day's Notifications pages from classic readers", () => {
    for (const href of ["/my-day/notifications", "/my-day/notifications/earlier", "/my-day/notifications/settings"]) {
      expect(workModeRouteHidden(href, classic)).toBe(true);
      expect(workModeRouteHidden(href, launched)).toBe(false);
    }
    expect(workModeRouteHidden("/my-day/alerts", classic)).toBe(false);
  });

  it("keeps every entry an absolute path with no trailing slash or query in the path", () => {
    for (const entry of NEW_WORK_MODE_ROUTES) {
      expect(entry.path).toMatch(/^\/[a-z0-9/-]+[a-z0-9]$/);
      expect(entry.owner).not.toBe("");
    }
  });
});

describe("the launch switch never stops the server booting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("loads the environment with a mistyped WORK_MODE_LAUNCH and leaves the typo for launch.ts to fail closed", async () => {
    vi.resetModules();
    vi.stubEnv("WORK_MODE_LAUNCH", " Evryone ");
    await expect(import("../src/lib/env")).resolves.toBeDefined();
    expect(workModeLaunchSetting({ ...PROD, WORK_MODE_LAUNCH: " Evryone " })).toBe("preview");
  });
});

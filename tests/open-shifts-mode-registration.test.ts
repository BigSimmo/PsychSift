import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { appModeIds, appModeDefinition, appModeHomeHref } from "@/lib/app-modes";
import { APP_MODE_ACCENT, APP_MODE_ICON, CATEGORY_ACCENTS, CATEGORY_ICON_KEYS } from "@/lib/category-identity";
import { activeModeSecondaryNavigationId, modeSecondaryNavigationEntries } from "@/lib/mode-secondary-navigation";
import { isInformationPage } from "@/lib/information-pages";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import {
  isAlwaysStandaloneShellPath,
  isStandaloneModeHomePath,
  standaloneModeHomeHref,
} from "@/lib/search-route-ownership";
import { searchShellPropsForPathname } from "@/lib/search-shell-props";
import { searchCommandSurfaceConfig } from "@/lib/search-command-surface";
import { modePageVisible } from "@/lib/teaching/page-visibility";
import { sharedHomePresentation } from "@/lib/ui-copy";

const ROUTES = [
  "/open-shifts",
  "/open-shifts/shift/service-1/shift-1",
  "/open-shifts/mine",
  "/open-shifts/alerts",
  "/open-shifts/post",
  "/open-shifts/post/new",
  "/open-shifts/post/service-1/shift-1",
  "/open-shifts/board",
  "/open-shifts/log",
];

describe("Open shifts mode registration", () => {
  it("is a mode with Browse, My shifts, Alerts and Post tabs", () => {
    expect(appModeIds).toContain("open-shifts");
    expect(modeSecondaryNavigationEntries("open-shifts").map((entry) => [entry.label, entry.href])).toEqual([
      ["Browse", "/open-shifts"],
      ["My shifts", "/open-shifts/mine"],
      ["Alerts", "/open-shifts/alerts"],
      ["Post", "/open-shifts/post"],
    ]);
  });

  it("marks each tab current on its own page only", () => {
    expect(activeModeSecondaryNavigationId("open-shifts", "/open-shifts")).toBe("open-shifts-browse");
    expect(activeModeSecondaryNavigationId("open-shifts", "/open-shifts/mine")).toBe("open-shifts-mine");
    expect(activeModeSecondaryNavigationId("open-shifts", "/open-shifts/alerts")).toBe("open-shifts-alerts");
    expect(activeModeSecondaryNavigationId("open-shifts", "/open-shifts/post")).toBe("open-shifts-post");
    expect(activeModeSecondaryNavigationId("open-shifts", "/open-shifts/post/new")).toBeNull();
    expect(activeModeSecondaryNavigationId("open-shifts", "/open-shifts/shift/a/b")).toBeNull();
  });

  it("hides Post until poster rights are confirmed, and nothing else", () => {
    expect(modePageVisible("open-shifts", "open-shifts-post", [], null, null)).toBe(false);
    expect(modePageVisible("open-shifts", "open-shifts-post", [], null, false)).toBe(false);
    expect(modePageVisible("open-shifts", "open-shifts-post", [], null, true)).toBe(true);
    for (const id of ["open-shifts-browse", "open-shifts-mine", "open-shifts-alerts"]) {
      expect(modePageVisible("open-shifts", id, [], null, null)).toBe(true);
    }
  });

  it("carries the label, description and no-search-surface shape of a personal mode", () => {
    const mode = appModeDefinition("open-shifts");
    expect(mode.label).toBe("Open shifts");
    expect("href" in mode ? mode.href : null).toBe("/open-shifts");
    expect(mode.search.resultsSurface).toBe("none");
  });

  it("wears the Hand glyph, unique among app modes", () => {
    expect(APP_MODE_ICON["open-shifts"]).toBe("hand");
    expect(CATEGORY_ICON_KEYS).toContain("hand");
    const keys = appModeIds.map((mode) => APP_MODE_ICON[mode]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries a valid category accent", () => {
    expect(CATEGORY_ACCENTS).toContain(APP_MODE_ACCENT["open-shifts"]);
  });

  it("declares its violet identity tokens", () => {
    const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(globalsCss).toContain('[data-mode-identity="open-shifts"]');
    // Work-mode redesign, owner request 6 Oct 2026: Open shifts shares Roster's violet.
    expect(globalsCss).toContain("--mode-identity: #5a45a6;");
    expect(globalsCss).toContain("--mode-identity: #b0a0d8;");
  });

  it("sits in the My Day phone group right after Roster", () => {
    const group = phoneModeGroups.find((entry) => entry.id === "my-day");
    const ids: readonly string[] = group?.modeIds ?? [];
    expect(ids.indexOf("open-shifts")).toBe(ids.indexOf("roster") + 1);
  });

  it("routes a dedicated Open shifts home, not the shared home", () => {
    expect(standaloneModeHomeHref("open-shifts")).toBe("/open-shifts");
    expect(isStandaloneModeHomePath("/open-shifts")).toBe(true);
    expect(isAlwaysStandaloneShellPath("/open-shifts")).toBe(true);
    expect(appModeHomeHref("open-shifts")).toBe("/open-shifts");
  });

  it("mounts the Open shifts shell placement and information-page shape on every route", () => {
    for (const path of ROUTES) {
      expect(searchShellPropsForPathname(path)).toMatchObject({ initialMode: "open-shifts" });
      expect(isInformationPage(path)).toBe(true);
    }
  });

  it("declares a local, non-remote command surface", () => {
    const config = searchCommandSurfaceConfig("open-shifts");
    expect(config).not.toBeNull();
    expect(config?.examples.length).toBeGreaterThan(0);
    expect(config?.suggestions.length).toBeGreaterThan(0);
    expect(config?.remoteSearchEnabled).toBe(false);
  });

  it("carries the shared-home copy", () => {
    expect(sharedHomePresentation["open-shifts"].title).toBe("Open shifts");
    expect(sharedHomePresentation["open-shifts"].subtitle).toBe("Extra shifts in your Roster teams.");
  });
});

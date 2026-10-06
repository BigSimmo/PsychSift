import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { appModeIds, appModeDefinition, appModeHomeHref } from "@/lib/app-modes";
import { APP_MODE_ACCENT, APP_MODE_ICON, CATEGORY_ACCENTS, CATEGORY_ICON_KEYS } from "@/lib/category-identity";
import { modeSecondaryNavigationEntries } from "@/lib/mode-secondary-navigation";
import { isInformationPage } from "@/lib/information-pages";
import {
  isAlwaysStandaloneShellPath,
  isStandaloneModeHomePath,
  standaloneModeHomeHref,
} from "@/lib/search-route-ownership";
import { searchShellPropsForPathname } from "@/lib/search-shell-props";
import { searchCommandSurfaceConfig } from "@/lib/search-command-surface";
import { sharedHomePresentation } from "@/lib/ui-copy";

describe("Roster mode registration", () => {
  it("is a mode with five pages, opening on Shifts", () => {
    expect(appModeIds).toContain("roster");
    expect(modeSecondaryNavigationEntries("roster").map((entry) => entry.label)).toEqual([
      "Shifts",
      "Swaps & leave",
      "Team",
      "Settings",
      "Today",
    ]);
  });

  it("carries the label, description and no-search-surface shape of a personal dashboard mode", () => {
    const mode = appModeDefinition("roster");
    expect(mode.label).toBe("Roster");
    expect("href" in mode ? mode.href : null).toBe("/roster");
    expect(mode.search.resultsSurface).toBe("none");
  });

  it("wears the CalendarRange glyph, unique among app modes", () => {
    expect(APP_MODE_ICON.roster).toBe("calendarRange");
    expect(CATEGORY_ICON_KEYS).toContain("calendarRange");
    const keys = appModeIds.map((mode) => APP_MODE_ICON[mode]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries a valid category accent", () => {
    expect(CATEGORY_ACCENTS).toContain(APP_MODE_ACCENT.roster);
  });

  it("declares the violet identity tokens beside On Call and CME", () => {
    const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(globalsCss).toContain('[data-mode-identity="roster"]');
    // Work-mode redesign, owner request 6 Oct 2026: the mockup's violet.
    expect(globalsCss).toContain("--mode-identity: #5a45a6;");
    expect(globalsCss).toContain("--mode-identity: #b0a0d8;");
  });

  it("routes a dedicated Roster dashboard home, not the shared home", () => {
    expect(standaloneModeHomeHref("roster")).toBe("/roster");
    expect(isStandaloneModeHomePath("/roster")).toBe(true);
    expect(isAlwaysStandaloneShellPath("/roster")).toBe(true);
    expect(appModeHomeHref("roster")).toBe("/roster");
    expect(appModeHomeHref("roster", { query: "night shift", run: true })).toBe("/roster?q=night+shift&run=1");
  });

  it("mounts the roster shell placement for every Roster route", () => {
    expect(searchShellPropsForPathname("/roster")).toMatchObject({ initialMode: "roster" });
    expect(searchShellPropsForPathname("/roster/shifts")).toMatchObject({ initialMode: "roster" });
    expect(searchShellPropsForPathname("/roster/settings")).toMatchObject({ initialMode: "roster" });
  });

  it("classifies every Roster route as an information page, like On Call and CME", () => {
    expect(isInformationPage("/roster")).toBe(true);
    expect(isInformationPage("/roster/shifts")).toBe(true);
    expect(isInformationPage("/roster/settings")).toBe(true);
    expect(isInformationPage("/roster/calendar")).toBe(true);
    for (const path of ["/roster/team", "/roster/swaps", "/roster/requests", "/roster/manage", "/roster/join"]) {
      expect(isInformationPage(path)).toBe(true);
    }
  });

  it("declares a local, non-remote command surface", () => {
    const config = searchCommandSurfaceConfig("roster");
    expect(config).not.toBeNull();
    expect(config?.examples.length).toBeGreaterThan(0);
    expect(config?.suggestions.length).toBeGreaterThan(0);
    expect(config?.remoteSearchEnabled).toBe(false);
  });

  it("carries non-empty shared-home copy", () => {
    expect(sharedHomePresentation.roster.title).toBe("Roster");
    expect(sharedHomePresentation.roster.subtitle.trim().length).toBeGreaterThan(0);
  });
});

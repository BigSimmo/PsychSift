/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { isHeaderAddonSlotOwnedRoute } from "@/components/mode-nav/header-addon-slot";
import { modeSectionIcon } from "@/components/mode-nav/mode-nav-icons";
import { appModeDefinition, appModeHomeHref, appModeIds, appModeSearchConfig } from "@/lib/app-modes";
import { APP_MODE_ACCENT, APP_MODE_ICON } from "@/lib/category-identity";
import { informationPageShellModes, isInformationPage } from "@/lib/information-pages";
import {
  activeModeSecondaryNavigationId,
  modeSecondaryNavigationRegistry,
  modeUsesHeaderModeNav,
} from "@/lib/mode-secondary-navigation";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import { searchCommandSurfaceConfig } from "@/lib/search-command-surface";
import {
  isAlwaysStandaloneShellPath,
  isStandaloneModeHomePath,
  standaloneModeHomeHref,
} from "@/lib/search-route-ownership";
import { searchShellPropsForPathname } from "@/lib/search-shell-props";
import { siteContentModeExclusions } from "@/lib/site-content/site-content-registry";
import { modePageVisible, setTeachingRoles, useTeachingRoles } from "@/lib/teaching/page-visibility";
import { sharedHomePresentation } from "@/lib/ui-copy";
import { universalSearchPreferredDomains } from "@/lib/universal-search-mode-context";

import { phoneChromePlan } from "../scripts/phone-chrome-plan.mjs";

const OCC = "11111111-1111-4111-8111-111111111111";

afterEach(() => setTeachingRoles([]));

describe("Teaching mode registration", () => {
  it("sits right after CPD with no results surface and titles-only search", () => {
    expect(appModeIds).toHaveLength(24);
    expect(appModeIds.indexOf("teaching")).toBe(appModeIds.indexOf("cme") + 1);
    expect(appModeDefinition("teaching")).toMatchObject({ label: "Teaching", href: "/teaching" });
    const search = appModeSearchConfig("teaching");
    expect(search.resultsSurface).toBe("none");
    // Text typed in the main search bar leaves the app (contracts §8): nothing personal is invited into it.
    expect(search.placeholder).toMatch(/session/i);
    expect(`${search.placeholder} ${search.inputAriaLabel} ${search.emptyTitle} ${search.readyTitle}`).not.toMatch(
      /logbook|attendance|supervision|member|patient/i,
    );
    expect(searchCommandSurfaceConfig("teaching")?.remoteSearchEnabled).toBe(false);
    expect(universalSearchPreferredDomains("teaching")).toEqual([]);
  });

  it("owns its home, and no Teaching route wears a composer", () => {
    expect(standaloneModeHomeHref("teaching")).toBe("/teaching");
    expect(isStandaloneModeHomePath("/teaching")).toBe(true);
    expect(isAlwaysStandaloneShellPath("/teaching/week")).toBe(true);
    expect(appModeHomeHref("teaching")).toBe("/teaching");
    expect(searchShellPropsForPathname(`/teaching/session/${OCC}`)).toMatchObject({ initialMode: "teaching" });
    for (const pathname of ["/teaching", "/teaching/week", `/teaching/session/${OCC}`, "/teaching/c/abc"]) {
      expect(isInformationPage(pathname), pathname).toBe(true);
    }
    expect(informationPageShellModes).toContain("teaching");
  });

  it("registers all first-build pages with their icons, and adopts no shared bar", () => {
    expect(modeSecondaryNavigationRegistry.teaching.map(({ id, href }) => [id, href])).toEqual([
      ["today", "/teaching"],
      ["week", "/teaching/week"],
      ["whats-on", "/teaching/whats-on"],
      ["resources", "/teaching/resources"],
      ["logbook", "/teaching/logbook"],
      ["teach", "/teaching/teach"],
      ["supervision", "/teaching/supervision"],
      ["organise", "/teaching/organise"],
    ]);
    expect(activeModeSecondaryNavigationId("teaching", "/teaching/logbook")).toBe("logbook");
    expect(activeModeSecondaryNavigationId("teaching", `/teaching/session/${OCC}`)).toBeNull();
    expect(modeUsesHeaderModeNav("teaching")).toBe(false);
    expect(["today", "week", "logbook", "organise"].map((id) => modeSectionIcon(id)?.displayName)).toEqual([
      "CalendarClock",
      "CalendarClock",
      "NotebookText",
      "SlidersHorizontal",
    ]);
  });

  it("preserves the legacy teaching list until a service approves transfer", () => {
    expect(modeSecondaryNavigationRegistry["on-call"].map((entry) => entry.id)).toContain("teaching");
    expect(activeModeSecondaryNavigationId("on-call", "/on-call/education")).toBe("teaching");
  });

  it("shows Organise only to an organiser or admin, and holds roles in memory only", () => {
    expect(modePageVisible("teaching", "organise", [])).toBe(false);
    expect(modePageVisible("teaching", "organise", ["doctor"])).toBe(false);
    expect(modePageVisible("teaching", "organise", ["doctor", "organiser"])).toBe(true);
    expect(modePageVisible("teaching", "week", [])).toBe(true);
    expect(modePageVisible("cme", "organise", [])).toBe(true);
    const { result } = renderHook(() => useTeachingRoles());
    expect(result.current).toEqual([]);
    act(() => setTeachingRoles(["admin", "doctor", "admin"]));
    expect(result.current).toEqual(["admin", "doctor"]);
  });

  it("claims the header slot on the two pages that mount Teaching's in-page header, and no others", () => {
    expect(isHeaderAddonSlotOwnedRoute(`/teaching/session/${OCC}`)).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute(`/teaching/session/${OCC}/check-in`)).toBe(true);
    for (const pathname of ["/teaching", "/teaching/week", "/teaching/organise", "/teaching/c/complete"]) {
      expect(isHeaderAddonSlotOwnedRoute(pathname), pathname).toBe(false);
    }
  });

  it("gives Teaching's phone chrome an owner, so a copy edit does not escalate to the whole suite", () => {
    const plan = phoneChromePlan(["src/components/teaching/teaching-week.tsx"]);
    expect(plan.phoneRelevant).toBe(true);
    expect(plan.fullRecommended).toBe(false);
  });

  it("has its glyph, its home copy, a place beside CPD on phones, and no site content", () => {
    expect(APP_MODE_ICON.teaching).toBe("presentation");
    expect(APP_MODE_ACCENT.teaching).toBe("rose");
    expect(sharedHomePresentation.teaching.suggestions).toEqual(["grand round", "journal club", "case conference"]);
    // Behind the My Day door, beside CPD (modes review, phase 1).
    expect(phoneModeGroups.find((group) => group.id === "my-day")?.modeIds).toEqual(
      expect.arrayContaining(["teaching", "cme"]),
    );
    expect(siteContentModeExclusions.find((entry) => entry.modeId === "teaching")).toMatchObject({
      modeId: "teaching",
      reason: "private_user_state",
    });
  });
});

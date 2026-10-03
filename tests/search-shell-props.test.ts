import { describe, expect, it } from "vitest";

import { modeSecondaryNavigationRegistry } from "@/lib/mode-secondary-navigation";
import { searchShellPropsForPathname } from "@/lib/search-shell-props";

describe("searchShellPropsForPathname", () => {
  it("gives no Admin page the shared composer (spec review 18)", () => {
    for (const path of ["/admin", "/admin/renewals", "/admin/new-job", "/admin/help"]) {
      expect(searchShellPropsForPathname(path)).toMatchObject({ initialMode: "my-work", searchComposerVisible: false });
    }
  });

  it("gives every My Day page the my-day mode and no shared composer", () => {
    for (const path of ["/my-day", "/my-day/week", "/my-day/hours"]) {
      expect(searchShellPropsForPathname(path)).toMatchObject({ initialMode: "my-day", searchComposerVisible: false });
    }
  });

  it("keeps documents composer visible only on the search route", () => {
    expect(searchShellPropsForPathname("/documents/search")).toMatchObject({
      initialMode: "documents",
      searchComposerVisible: true,
      mobileChromeVisible: true,
    });
    expect(searchShellPropsForPathname("/documents/source")).toMatchObject({
      initialMode: "documents",
      searchComposerVisible: false,
      mobileChromeVisible: false,
    });
  });

  it("scopes favourites and forms mode menus", () => {
    expect(searchShellPropsForPathname("/favourites")).toMatchObject({
      initialMode: "favourites",
      availableModeIds: ["favourites"],
      desktopSearchPlacement: "hero",
    });
    expect(searchShellPropsForPathname("/forms")).toMatchObject({
      initialMode: "forms",
      availableModeIds: ["forms"],
    });
  });

  it("keeps tools in the hero from tablet up and uses the shared phone footer", () => {
    const expectedToolsShell = {
      initialMode: "tools",
      desktopSearchPlacement: "hero",
      mobileHomeComposerPlacement: "footer",
    } as const;

    expect(searchShellPropsForPathname("/tools")).toEqual(expectedToolsShell);
    expect(searchShellPropsForPathname("/tools/interaction-checker")).toEqual(expectedToolsShell);
  });

  it("maps therapy and home fallbacks", () => {
    // Therapy was the one standalone mode home not declaring the hero placement,
    // which left it on a different composer code path from its twelve peers.
    expect(searchShellPropsForPathname("/therapy-compass/search")).toEqual({
      initialMode: "therapy-compass",
      desktopSearchPlacement: "hero",
    });
    expect(searchShellPropsForPathname("/therapy-compass/recommend")).toEqual({
      initialMode: "therapy-compass",
      desktopSearchPlacement: "hero",
      searchComposerVisible: false,
    });
    expect(searchShellPropsForPathname("/therapy-compass/compare")).toEqual({
      initialMode: "therapy-compass",
      desktopSearchPlacement: "hero",
    });
    expect(searchShellPropsForPathname("/")).toEqual({ initialMode: "answer" });
  });

  it("keeps the composer on dictionary search surfaces and drops it on the governance page", () => {
    expect(searchShellPropsForPathname("/dictionary/search")).toEqual({
      initialMode: "dictionary",
      desktopSearchPlacement: "hero",
    });
    expect(searchShellPropsForPathname("/dictionary/sources")).toEqual({
      initialMode: "dictionary",
      desktopSearchPlacement: "hero",
      searchComposerVisible: false,
    });
  });

  it("assigns calculator home and results search to the shared shell", () => {
    expect(searchShellPropsForPathname("/calculators")).toEqual({
      initialMode: "calculators",
      desktopSearchPlacement: "hero",
    });
  });

  it("keeps one Sources composer on catalogue views and hides it on method and detail pages", () => {
    const visible = { initialMode: "sources", desktopSearchPlacement: "hero" } as const;
    expect(searchShellPropsForPathname("/sources")).toEqual(visible);
    expect(searchShellPropsForPathname("/sources/search")).toEqual(visible);
    expect(searchShellPropsForPathname("/sources/topics")).toEqual(visible);
    expect(searchShellPropsForPathname("/sources/publishers")).toEqual(visible);
    expect(searchShellPropsForPathname("/sources/method")).toEqual({ ...visible, searchComposerVisible: false });
    expect(searchShellPropsForPathname("/sources/src_example")).toEqual({ ...visible, searchComposerVisible: false });
  });

  it("derives reserved sources subroutes from modeSecondaryNavigationRegistry so registered routes are never treated as detail pages", () => {
    const visible = { initialMode: "sources", desktopSearchPlacement: "hero" } as const;
    for (const entry of modeSecondaryNavigationRegistry.sources) {
      if (!entry.href) continue;
      const props = searchShellPropsForPathname(entry.href);
      expect(props.initialMode).toBe("sources");
      expect(props.desktopSearchPlacement).toBe("hero");
      if (entry.id === "method") {
        expect(props.searchComposerVisible).toBe(false);
      } else {
        expect(props.searchComposerVisible).not.toBe(false);
        expect(props).toEqual(visible);
      }
    }
  });
});

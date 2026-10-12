import { describe, expect, it } from "vitest";

import {
  ON_SHIFT_LANDING_PATH,
  coldLandingTarget,
  isColdHomeOpen,
  lastPlaceToRemember,
  readLastPlace,
  type ColdLandingFacts,
} from "@/lib/last-place";

const cold: ColdLandingFacts = {
  entry: { pathname: "/", search: "", hash: "" },
  navigationType: "navigate",
  cameFromApp: false,
  landingPreferenceSet: false,
};

describe("lastPlaceToRemember", () => {
  it("keeps plain Work and Clinical page paths", () => {
    expect(lastPlaceToRemember("/on-call")).toBe("/on-call");
    expect(lastPlaceToRemember("/my-day/week")).toBe("/my-day/week");
    expect(lastPlaceToRemember("/dsm/major-depressive-disorder")).toBe("/dsm/major-depressive-disorder");
    expect(lastPlaceToRemember("/")).toBe("/");
  });

  it("never keeps forms part-way through, results pages, set-up or the safety plan", () => {
    expect(lastPlaceToRemember("/cme/new")).toBeNull();
    expect(lastPlaceToRemember("/documents/search")).toBeNull();
    expect(lastPlaceToRemember("/my-day/setup")).toBeNull();
    expect(lastPlaceToRemember("/safety-plan")).toBeNull();
    expect(lastPlaceToRemember("/safety-plan/print")).toBeNull();
    expect(lastPlaceToRemember("/mockups/anything")).toBeNull();
  });

  it("refuses anything that is not a bare same-site path", () => {
    expect(lastPlaceToRemember("/on-call?q=lithium")).toBeNull();
    expect(lastPlaceToRemember("/on-call#top")).toBeNull();
    expect(lastPlaceToRemember("//evil.example/x")).toBeNull();
    expect(lastPlaceToRemember("https://evil.example")).toBeNull();
    expect(lastPlaceToRemember("/a b")).toBeNull();
    expect(lastPlaceToRemember(`/${"a".repeat(200)}`)).toBeNull();
    expect(lastPlaceToRemember("")).toBeNull();
    expect(lastPlaceToRemember(null)).toBeNull();
  });

  it("checks a stored value again on the way out", () => {
    expect(readLastPlace("/teaching")).toBe("/teaching");
    expect(readLastPlace("javascript:alert(1)")).toBeNull();
    expect(readLastPlace(null)).toBeNull();
  });
});

describe("isColdHomeOpen", () => {
  it("is true only for a fresh open of a bare /", () => {
    expect(isColdHomeOpen(cold)).toBe(true);
    expect(isColdHomeOpen({ ...cold, navigationType: null })).toBe(true);
  });

  it("never moves a / that carries a query or a hash", () => {
    expect(isColdHomeOpen({ ...cold, entry: { ...cold.entry, search: "?mode=dsm" } })).toBe(false);
    expect(isColdHomeOpen({ ...cold, entry: { ...cold.entry, search: "?q=lithium" } })).toBe(false);
    expect(isColdHomeOpen({ ...cold, entry: { ...cold.entry, search: "?focus=1" } })).toBe(false);
    expect(isColdHomeOpen({ ...cold, entry: { ...cold.entry, hash: "#main" } })).toBe(false);
  });

  it("keeps today's behaviour for other pages, reloads, Back, in-app arrivals and a set landing view", () => {
    expect(isColdHomeOpen({ ...cold, entry: { ...cold.entry, pathname: "/on-call" } })).toBe(false);
    expect(isColdHomeOpen({ ...cold, navigationType: "reload" })).toBe(false);
    expect(isColdHomeOpen({ ...cold, navigationType: "back_forward" })).toBe(false);
    expect(isColdHomeOpen({ ...cold, cameFromApp: true })).toBe(false);
    expect(isColdHomeOpen({ ...cold, landingPreferenceSet: true })).toBe(false);
  });
});

describe("coldLandingTarget", () => {
  const all = () => true;

  it("opens My Day while a shift is running", () => {
    expect(coldLandingTarget({ onShiftNow: true, lastPlace: "/teaching", routeVisible: all })).toBe(
      ON_SHIFT_LANDING_PATH,
    );
  });

  it("otherwise opens the last page used", () => {
    expect(coldLandingTarget({ onShiftNow: false, lastPlace: "/teaching", routeVisible: all })).toBe("/teaching");
  });

  it("stays on Clinical when the last place was Clinical home or nothing is remembered", () => {
    expect(coldLandingTarget({ onShiftNow: false, lastPlace: "/", routeVisible: all })).toBeNull();
    expect(coldLandingTarget({ onShiftNow: false, lastPlace: null, routeVisible: all })).toBeNull();
  });

  it("skips a page this reader cannot open", () => {
    const hidden = (href: string) => href !== "/teaching" && href !== ON_SHIFT_LANDING_PATH;
    expect(coldLandingTarget({ onShiftNow: false, lastPlace: "/teaching", routeVisible: hidden })).toBeNull();
    expect(coldLandingTarget({ onShiftNow: true, lastPlace: "/on-call", routeVisible: hidden })).toBe("/on-call");
  });
});

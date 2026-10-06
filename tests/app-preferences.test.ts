import { describe, expect, it } from "vitest";

import {
  ANSWER_STYLE_OPTIONS,
  DEFAULT_PREFERENCES,
  DENSITY_OPTIONS,
  JURISDICTION_OPTIONS,
  LANDING_OPTIONS,
  MOTION_OPTIONS,
  POPULATION_OPTIONS,
  normalizePreferences,
} from "../src/components/clinical-dashboard/use-app-preferences";

describe("app preference normalisation", () => {
  it("returns defaults for non-object or empty input", () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences("nope")).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences([])).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid stored values", () => {
    const stored = {
      density: "compact",
      motion: "reduced",
      jurisdiction: "nsw",
      population: "older-adults",
      answerStyle: "comprehensive",
      landing: "search",
      showRecentOnHome: false,
      showProtocolsOnHome: false,
      compactCitations: true,
      saveRecentSearches: false,
      notifyGuidelineUpdates: false,
      notifyProductNews: true,
      notifySavedChanges: false,
      reminders: {
        types: {
          "compliance-dates": { showInApp: false, calendarAlert: "1d", snoozedUntil: null },
          "on-call-checks": { showInApp: true, calendarAlert: "off", snoozedUntil: "2026-10-03" },
          "cpd-year-end": { showInApp: true, calendarAlert: "1w", snoozedUntil: null },
          "cpd-routines": { showInApp: true, calendarAlert: "at-time", snoozedUntil: null },
          shifts: { showInApp: true, calendarAlert: "off", snoozedUntil: null },
          teaching: { showInApp: true, calendarAlert: "1h", snoozedUntil: null },
        },
        quietHours: { enabled: true, start: "22:00", end: "06:00" },
        maxAlertsPerDay: 5,
      },
      workStage: "registrar",
      ranzcpStage: 2,
    };
    expect(normalizePreferences(stored)).toEqual(stored);
  });

  it("falls back per-field when individual values are invalid", () => {
    const result = normalizePreferences({
      density: "microscopic",
      motion: 3,
      jurisdiction: "atlantis",
      population: null,
      answerStyle: "chatty",
      landing: "teleport",
      showRecentOnHome: "yes",
      compactCitations: 1,
    });
    expect(result.density).toBe(DEFAULT_PREFERENCES.density);
    expect(result.motion).toBe(DEFAULT_PREFERENCES.motion);
    expect(result.jurisdiction).toBe(DEFAULT_PREFERENCES.jurisdiction);
    expect(result.population).toBe(DEFAULT_PREFERENCES.population);
    expect(result.answerStyle).toBe(DEFAULT_PREFERENCES.answerStyle);
    expect(result.landing).toBe(DEFAULT_PREFERENCES.landing);
    expect(result.showRecentOnHome).toBe(DEFAULT_PREFERENCES.showRecentOnHome);
    expect(result.compactCitations).toBe(DEFAULT_PREFERENCES.compactCitations);
  });

  it("defaults recent-search recording on and coerces a non-boolean back to it", () => {
    // The privacy control is opt-OUT: a browser that has never been told
    // otherwise keeps remembering recent questions, so an unreadable stored
    // value must not silently turn recording off (or on) by accident.
    expect(DEFAULT_PREFERENCES.saveRecentSearches).toBe(true);
    expect(normalizePreferences({ saveRecentSearches: false }).saveRecentSearches).toBe(false);
    expect(normalizePreferences({ saveRecentSearches: "no" }).saveRecentSearches).toBe(true);
  });

  it("accepts all three motion values and defaults to following the OS", () => {
    // "full" is the explicit opt-in that overrides an OS Reduce Motion request;
    // "system" must stay the default so nobody silently gains motion.
    expect(DEFAULT_PREFERENCES.motion).toBe("system");
    for (const motion of ["system", "reduced", "full"] as const) {
      expect(normalizePreferences({ motion }).motion).toBe(motion);
    }
    expect(normalizePreferences({ motion: "always" }).motion).toBe("system");
    expect(MOTION_OPTIONS.map((option) => option.value)).toEqual(["system", "reduced", "full"]);
  });

  it("keeps every default within its published option set", () => {
    expect(DENSITY_OPTIONS.some((option) => option.value === DEFAULT_PREFERENCES.density)).toBe(true);
    expect(POPULATION_OPTIONS.some((option) => option.value === DEFAULT_PREFERENCES.population)).toBe(true);
    expect(ANSWER_STYLE_OPTIONS.some((option) => option.value === DEFAULT_PREFERENCES.answerStyle)).toBe(true);
    expect(LANDING_OPTIONS.some((option) => option.value === DEFAULT_PREFERENCES.landing)).toBe(true);
    expect(JURISDICTION_OPTIONS.some((option) => option.value === DEFAULT_PREFERENCES.jurisdiction)).toBe(true);
  });
});

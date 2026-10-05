import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES, normalizePreferences, workStageLabel } from "@/lib/account-preferences";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import {
  adminArea,
  cpdArea,
  onCallArea,
  payFortnightWeekday,
  profileTabCount,
  readWorkProfileTab,
  restRules,
  restRulesGate,
  restRulesProvenance,
  rosterArea,
  summariseAdmin,
  teachingArea,
  workplaceNames,
} from "@/lib/work-profile/model";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

const registration = complianceFixture("Medical registration renewal", {
  category: "registration",
  requirementId: "medical-registration-renewal",
  expiresOn: "2027-09-30",
});
const indemnity = complianceFixture("Indemnity insurance declaration", {
  category: "registration",
  requirementId: "professional-indemnity-insurance",
  expiresOn: "2027-06-30",
});
const vaccination = complianceFixture("Influenza vaccination", { category: "Vaccination", expiresOn: "2027-04-01" });

describe("a read that has not finished or failed never claims anything", () => {
  it.each([
    ["loading", "Checking…"],
    ["failed", "Didn’t load"],
    ["signed-out", "Didn’t load"],
  ] as const)("%s shows Not checked on every data-backed area", (status, subtitle) => {
    const rows = [rosterArea({ status }), teachingArea({ status }), cpdArea({ status }, null), adminArea({ status })];
    for (const row of rows) {
      expect(row.state).toBe("not-checked");
      expect(row.label).toBe("Not checked");
      expect(row.subtitle).toBe(subtitle);
    }
  });
});

describe("area rows", () => {
  it("Roster: Start when nothing imported, else the workplace count and the doctor's line", () => {
    expect(rosterArea({ status: "ready", value: { workplaces: 0, rowName: null } })).toMatchObject({
      state: "start",
      label: "Start",
    });
    expect(rosterArea({ status: "ready", value: { workplaces: 2, rowName: "R3" } })).toMatchObject({
      state: "ready",
      subtitle: "2 workplaces · your line R3",
    });
    expect(rosterArea({ status: "ready", value: { workplaces: 1, rowName: null } }).subtitle).toBe("1 workplace");
  });

  it("Teaching: Start with no team, else the number followed", () => {
    expect(teachingArea({ status: "ready", value: { teams: 0 } }).state).toBe("start");
    expect(teachingArea({ status: "ready", value: { teams: 1 } }).subtitle).toBe("1 team followed");
  });

  it("CPD: a registrar's CPD is through training, whatever the CPD read did", () => {
    expect(cpdArea({ status: "failed" }, "registrar", 2)).toMatchObject({
      state: "optional",
      label: "Covered",
      subtitle: "Through your RANZCP training",
    });
    // No RANZCP stage chosen: not assumed to be in training.
    expect(cpdArea({ status: "failed" }, "registrar", null).state).toBe("not-checked");
    expect(cpdArea({ status: "ready", value: { configured: false, routines: 0 } }, "consultant").state).toBe("start");
    expect(cpdArea({ status: "ready", value: { configured: true, routines: 2 } }, null).subtitle).toBe(
      "This year’s plan and 2 routines",
    );
  });

  it("On Call reports the hospital phone setting", () => {
    expect(onCallArea(true).subtitle).toBe("Hospital phone on");
    expect(onCallArea(false).subtitle).toBe("Hospital phone off");
  });
});

describe("Admin never shows a tick and never overstates", () => {
  it("counts recorded compliance dates and names the setup dates not entered", () => {
    const summary = summariseAdmin([registration, vaccination, onCallEntryFixture({ section: "contacts" })], false);
    expect(summary).toEqual({ recorded: 2, missing: ["Indemnity insurance"], partial: false });
    const row = adminArea({ status: "ready", value: summary });
    expect(row.state).toBe("count");
    expect(row.label).toBe("1 not recorded");
    expect(row.subtitle).toBe("Dates you entered; not checked with Ahpra");
  });

  it("with both setup dates entered, shows the recorded figure, still not a tick", () => {
    const row = adminArea({ status: "ready", value: summariseAdmin([registration, indemnity], false) });
    expect(row.state).toBe("count");
    expect(row.label).toBe("2 recorded");
  });

  it("a partial (offline) read says 'At least' rather than an exact figure", () => {
    const partial = summariseAdmin([vaccination], true);
    expect(adminArea({ status: "ready", value: partial })).toMatchObject({
      label: "At least 2 not recorded",
      subtitle: "Only partly loaded · not checked with Ahpra",
    });
    expect(adminArea({ status: "ready", value: summariseAdmin([registration, indemnity], true) }).label).toBe(
      "At least 2 recorded",
    );
  });

  it("a partial read with nothing in it is Not checked, never Start", () => {
    expect(adminArea({ status: "ready", value: summariseAdmin([], true) })).toMatchObject({
      state: "not-checked",
      label: "Not checked",
    });
  });

  it("nothing recorded is a Start step, not a warning", () => {
    expect(adminArea({ status: "ready", value: summariseAdmin([], false) })).toMatchObject({ state: "start" });
  });
});

describe("Profile tab count", () => {
  it("counts setup dates not entered only from a complete read", () => {
    expect(profileTabCount({ status: "ready", value: summariseAdmin([vaccination], false) })).toBe(2);
    expect(profileTabCount({ status: "ready", value: summariseAdmin([vaccination], true) })).toBeUndefined();
    expect(profileTabCount({ status: "failed" })).toBeUndefined();
    expect(
      profileTabCount({ status: "ready", value: summariseAdmin([registration, indemnity], false) }),
    ).toBeUndefined();
    // Nothing recorded at all: the area row says Start, so no badge doubles it.
    expect(profileTabCount({ status: "ready", value: summariseAdmin([], false) })).toBeUndefined();
  });
});

describe("tabs, stage, rules and helpers", () => {
  it("reads the tab from the URL, falling back to Profile", () => {
    expect(readWorkProfileTab("privacy")).toBe("privacy");
    expect(readWorkProfileTab("nonsense")).toBe("profile");
    expect(readWorkProfileTab(null)).toBe("profile");
  });

  it("labels the self-reported stage, with the RANZCP stage for a registrar", () => {
    expect(workStageLabel(null, null)).toBeNull();
    expect(workStageLabel("consultant", null)).toBe("Consultant psychiatrist");
    expect(workStageLabel("registrar", 2)).toBe("Psychiatry registrar · Stage 2");
  });

  it("normalises unknown stored stage values to unset", () => {
    expect(DEFAULT_PREFERENCES.workStage).toBeNull();
    expect(DEFAULT_PREFERENCES.ranzcpStage).toBeNull();
    const normalised = normalizePreferences({ workStage: "chief", ranzcpStage: 7 });
    expect(normalised.workStage).toBeNull();
    expect(normalised.ranzcpStage).toBeNull();
    const kept = normalizePreferences({ workStage: "registrar", ranzcpStage: 3 });
    expect(kept.workStage).toBe("registrar");
    expect(kept.ranzcpStage).toBe(3);
  });

  it("quotes the rest rules from the one signed source, with their clauses", () => {
    const rules = restRules();
    expect(rules.map((rule) => rule.value)).toEqual([
      `${FATIGUE_RULE_SET.rules.minBreakHours.hours} h`,
      `${FATIGUE_RULE_SET.rules.maxHours7d.hours} h`,
      String(FATIGUE_RULE_SET.rules.maxDaysBeforeTwoDaysOff.days),
    ]);
    for (const rule of rules) expect(rule.clause).toBeTruthy();
  });

  it("says plainly when the rules are not signed off", () => {
    const off = restRulesProvenance({ on: false, reason: "unsigned" });
    expect(off).toContain("Roster doesn’t check them now: not yet signed by a named clinician.");
    expect(off).not.toContain("signed off by");
    const lapsed = restRulesGate(Date.parse(`${FATIGUE_RULE_SET.source.reviewBy}T12:00:00Z`) + 2 * 86_400_000);
    expect(lapsed).toEqual({ on: false, reason: "review-date-passed" });
    expect(off).toContain("not a safety judgement");
  });

  it("names the pay-fortnight weekday and rejects bad dates", () => {
    expect(payFortnightWeekday("2026-10-01")).toBe("Thursday");
    expect(payFortnightWeekday("1 Oct")).toBeNull();
    expect(payFortnightWeekday(null)).toBeNull();
  });

  it("lists workplaces from imports and saved codes, once each, sorted", () => {
    expect(
      workplaceNames([{ workplace: "Fiona Stanley" }, { workplace: null }, { workplace: "Fiona Stanley" }], {
        "Royal Perth": {},
      }),
    ).toEqual(["Fiona Stanley", "Royal Perth"]);
  });
});

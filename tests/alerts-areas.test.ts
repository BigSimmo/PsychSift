import { describe, expect, it } from "vitest";

import { areaSummary, type RosterAlertChoices } from "@/lib/alerts/areas";
import { derivePhoneAlertState, deviceKindOf, type PhoneAlertInputs } from "@/lib/alerts/phone-state";
import { DEFAULT_REMINDER_SETTINGS, updateReminderType } from "@/lib/reminders/settings";

const TODAY = "2026-10-05";
const ROSTER_ON: RosterAlertChoices = { phoneOn: true, changes: true, requests: false, calendarShifts: true };

describe("area summaries say what the app will do", () => {
  it("Roster: phone choices, then the evening-before calendar alert", () => {
    const evening = updateReminderType(DEFAULT_REMINDER_SETTINGS, "shifts", { calendarAlert: "evening-before" });
    expect(areaSummary("roster", evening, TODAY, ROSTER_ON)).toBe(
      "Changes straight away · next shift the evening before",
    );
    expect(areaSummary("roster", evening, TODAY, { ...ROSTER_ON, requests: true })).toBe(
      "Changes and requests straight away · next shift the evening before",
    );
    // Phone alerts off on this device: nothing claims it will buzz.
    expect(areaSummary("roster", DEFAULT_REMINDER_SETTINGS, TODAY, { ...ROSTER_ON, phoneOn: false })).toBe(
      "In Roster and My Day",
    );
    // Shifts not on the calendar link: the evening-before alert cannot fire, so it is not claimed.
    expect(areaSummary("roster", evening, TODAY, { ...ROSTER_ON, calendarShifts: false })).toBe(
      "Changes straight away",
    );
  });

  it("Admin renewals are always in My Day, whatever the old switch or a snooze says", () => {
    const hidden = updateReminderType(DEFAULT_REMINDER_SETTINGS, "compliance-dates", {
      showInApp: false,
      snoozedUntil: "2026-10-12",
      calendarAlert: "1w",
    });
    expect(areaSummary("renewals", hidden, TODAY, ROSTER_ON)).toBe("Always in My Day · calendar 1 week before");
  });

  it("CPD and Teaching show hidden, snoozed and calendar states in words", () => {
    expect(areaSummary("cpd", DEFAULT_REMINDER_SETTINGS, TODAY, ROSTER_ON)).toBe("In My Day");
    const snoozed = updateReminderType(DEFAULT_REMINDER_SETTINGS, "cpd-routines", { snoozedUntil: "2026-10-12" });
    expect(areaSummary("cpd", snoozed, TODAY, ROSTER_ON)).toBe("Snoozed until 12 Oct");
    const hidden = updateReminderType(DEFAULT_REMINDER_SETTINGS, "teaching", { showInApp: false, calendarAlert: "1d" });
    expect(areaSummary("teaching", hidden, TODAY, ROSTER_ON)).toBe("Hidden in My Day · calendar 1 day before");
    const mixed = updateReminderType(
      updateReminderType(DEFAULT_REMINDER_SETTINGS, "cpd-routines", { calendarAlert: "1d" }),
      "cpd-year-end",
      { calendarAlert: "1w" },
    );
    expect(areaSummary("cpd", mixed, TODAY, ROSTER_ON)).toBe("In My Day · calendar alerts on");
  });

  it("On Call checks can never reach a calendar", () => {
    expect(areaSummary("on-call", DEFAULT_REMINDER_SETTINGS, TODAY, ROSTER_ON)).toBe("In My Day only");
  });
});

describe("phone alert state on this device", () => {
  const base: PhoneAlertInputs = {
    configured: true,
    supported: true,
    iosNotInstalled: false,
    permission: "granted",
    subscribed: true,
    failed: false,
    sharedDevice: false,
  };

  it("reads each state", () => {
    expect(derivePhoneAlertState(base)).toBe("on");
    expect(derivePhoneAlertState({ ...base, subscribed: false })).toBe("off");
    expect(derivePhoneAlertState({ ...base, subscribed: null })).toBe("checking");
    expect(derivePhoneAlertState({ ...base, configured: null })).toBe("checking");
    expect(derivePhoneAlertState({ ...base, configured: false })).toBe("unconfigured");
    expect(derivePhoneAlertState({ ...base, permission: "denied" })).toBe("blocked");
    expect(derivePhoneAlertState({ ...base, supported: false })).toBe("unsupported");
    expect(derivePhoneAlertState({ ...base, sharedDevice: true })).toBe("shared");
  });

  it("puts the Home Screen step first on an iPhone, even when permission looks denied", () => {
    expect(derivePhoneAlertState({ ...base, iosNotInstalled: true, permission: "denied" })).toBe("needs-home-screen");
  });

  it("never shows a failed check as off", () => {
    expect(derivePhoneAlertState({ ...base, failed: true, subscribed: false })).toBe("error");
  });

  it("names the device", () => {
    expect(deviceKindOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iphone");
    expect(deviceKindOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile")).toBe("phone");
    expect(deviceKindOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("computer");
  });
});

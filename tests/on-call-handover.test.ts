// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { addOnCallCallLogEntry, ON_CALL_CALL_LOG_NAME_MESSAGE } from "@/lib/on-call/call-log";
import {
  onCallPerthHourKey,
  onCallPulseNights,
  onCallPulsePeak,
  parseOnCallCallCounts,
} from "@/lib/on-call/call-counts";
import { ON_CALL_DEVICE_STATE_KEYS, onCallCallCountsStorageKey } from "@/lib/on-call/device-state-keys";
import {
  ON_CALL_HANDOVER_FULL_MESSAGE,
  ON_CALL_HANDOVER_GONE_MESSAGE,
  ON_CALL_HANDOVER_LIMIT,
  clearOnCallHandover,
  emptyOnCallHandoverDraft,
  onCallHandoverCallsNotIn,
  onCallHandoverDateRange,
  onCallHandoverShiftDates,
  onCallHandoverDraftFromCall,
  onCallHandoverExportSummary,
  onCallHandoverHtmlTable,
  onCallHandoverLegalGroups,
  onCallHandoverLegalStatusesMatching,
  onCallHandoverLegalTitle,
  onCallHandoverPatientLabel,
  onCallHandoverRecentLegal,
  onCallHandoverPlainText,
  onCallHandoverStorageKey,
  removeOnCallHandoverPatient,
  saveOnCallHandoverPatient,
  visibleOnCallHandover,
  type OnCallHandoverDraft,
} from "@/lib/on-call/handover";
import { officialForms } from "@/lib/form-register";
import {
  PATIENT_LABEL_EXPIRY_STORAGE_KEY,
  PATIENT_LABEL_KEY_PREFIX,
  clearPatientLabels,
} from "@/lib/patient-label-storage";

const draft = (overrides: Partial<OnCallHandoverDraft> = {}): OnCallHandoverDraft => ({
  ...emptyOnCallHandoverDraft,
  bed: "9",
  ward: "Example Ward",
  story: "Settled overnight",
  plan: "Review in the morning",
  ...overrides,
});

// 02:00 and 03:30 Perth time on 3 Oct 2026.
const twoAm = new Date("2026-10-02T18:00:00Z");
const halfThree = new Date("2026-10-02T19:30:00Z");

function shown(now: Date) {
  return visibleOnCallHandover(
    window.localStorage.getItem(onCallHandoverStorageKey),
    window.localStorage.getItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY),
    now,
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe("handover store", () => {
  it("keeps a patient only through the patient-label store", () => {
    const result = saveOnCallHandoverPatient(null, draft(), twoAm);
    expect(result.ok).toBe(true);
    expect(onCallHandoverStorageKey.startsWith(PATIENT_LABEL_KEY_PREFIX)).toBe(true);
    expect(shown(twoAm).patients).toHaveLength(1);
  });

  it("refuses a name in the bed field and writes nothing", () => {
    const result = saveOnCallHandoverPatient(null, draft({ bed: "Jane Smith" }), twoAm);
    expect(result).toEqual({ ok: false, problem: ON_CALL_CALL_LOG_NAME_MESSAGE });
    expect(window.localStorage.getItem(onCallHandoverStorageKey)).toBeNull();
  });

  it("accepts up to four initials", () => {
    expect(saveOnCallHandoverPatient(null, draft({ bed: "JS" }), twoAm).ok).toBe(true);
  });

  it("refuses an empty record", () => {
    expect(saveOnCallHandoverPatient(null, emptyOnCallHandoverDraft, twoAm).ok).toBe(false);
  });

  it("edits a record in place, keeping its place in the order", () => {
    const first = saveOnCallHandoverPatient(null, draft({ bed: "1" }), twoAm);
    saveOnCallHandoverPatient(null, draft({ bed: "2" }), halfThree);
    if (!first.ok) throw new Error("not saved");
    saveOnCallHandoverPatient(first.patient.id, draft({ bed: "1", review: "yes" }), halfThree);
    const patients = shown(halfThree).patients;
    expect(patients.map((p) => p.bed)).toEqual(["1", "2"]);
    expect(patients[0]!.review).toBe("yes");
  });

  it("deletes one patient and clears them all", () => {
    const first = saveOnCallHandoverPatient(null, draft({ bed: "1" }), twoAm);
    saveOnCallHandoverPatient(null, draft({ bed: "2" }), twoAm);
    if (!first.ok) throw new Error("not saved");
    removeOnCallHandoverPatient(first.patient.id, twoAm);
    expect(shown(twoAm).patients.map((p) => p.bed)).toEqual(["2"]);
    clearOnCallHandover();
    expect(window.localStorage.getItem(onCallHandoverStorageKey)).toBeNull();
  });

  it("refuses a patient past the limit rather than dropping one", () => {
    for (let i = 0; i < ON_CALL_HANDOVER_LIMIT; i += 1) {
      expect(saveOnCallHandoverPatient(null, draft({ bed: String(i + 1) }), twoAm).ok).toBe(true);
    }
    expect(saveOnCallHandoverPatient(null, draft({ bed: "99" }), twoAm)).toEqual({
      ok: false,
      problem: ON_CALL_HANDOVER_FULL_MESSAGE,
    });
  });

  it("never brings a cleared record back from a stale draft", () => {
    const first = saveOnCallHandoverPatient(null, draft(), twoAm);
    if (!first.ok) throw new Error("not saved");
    clearOnCallHandover();
    expect(saveOnCallHandoverPatient(first.patient.id, draft({ plan: "edited" }), twoAm)).toEqual({
      ok: false,
      problem: ON_CALL_HANDOVER_GONE_MESSAGE,
    });
    expect(window.localStorage.getItem(onCallHandoverStorageKey)).toBeNull();
  });

  it("is wiped with every other patient label at sign-out", () => {
    saveOnCallHandoverPatient(null, draft(), new Date());
    clearPatientLabels("account-transition");
    expect(window.localStorage.getItem(onCallHandoverStorageKey)).toBeNull();
  });

  it("shows nothing once the shift's expiry has passed", () => {
    saveOnCallHandoverPatient(null, draft(), twoAm);
    expect(shown(new Date(twoAm.getTime() + 13 * 3_600_000)).patients).toEqual([]);
  });

  it("fails closed on a foreign payload", () => {
    saveOnCallHandoverPatient(null, draft(), twoAm);
    window.localStorage.setItem(onCallHandoverStorageKey, JSON.stringify([{ bed: "9", name: "Jane Smith" }]));
    expect(shown(twoAm).patients).toEqual([]);
  });
});

describe("handover output", () => {
  it("builds plain text and an escaped HTML table, leaving empty fields out of the text", () => {
    saveOnCallHandoverPatient(null, draft({ legal: "<b>Voluntary</b>", review: "yes" }), twoAm);
    const patients = shown(twoAm).patients;
    const text = onCallHandoverPlainText(patients, twoAm);
    expect(text).toContain("1  Bed 9 · Example Ward");
    expect(text).toContain("REVIEW: YES");
    expect(text).toContain("Story  Settled overnight");
    expect(text).not.toContain("Referral");
    const html = onCallHandoverHtmlTable(patients, twoAm);
    expect(html).toContain("&lt;b&gt;Voluntary&lt;/b&gt;");
    expect(html).not.toContain("<b>Voluntary</b>");
  });

  it("turns an open call into a record without inventing anything", () => {
    const result = addOnCallCallLogEntry(
      { label: "4B-12", caller: "ED registrar", note: "Agitated", followUp: "Bloods" },
      twoAm,
    );
    if (!result.ok) throw new Error("not noted");
    const record = onCallHandoverDraftFromCall(result.entry);
    expect(record.bed).toBe("4B-12");
    expect(record.story).toContain("Agitated");
    expect(record.plan).toBe("Bloods");
    expect(record.legal).toBe("");
    expect(record.impression).toBe("");
  });
});

describe("handover helpers (mock-up v10)", () => {
  it("groups every register form under the register's own categories, nothing added or dropped", () => {
    const groups = onCallHandoverLegalGroups();
    expect(groups.reduce((total, group) => total + group.forms.length, 0)).toBe(officialForms.length);
    for (const group of groups) {
      for (const form of group.forms) expect(form.category).toBe(group.category);
    }
    expect(groups.find((group) => group.category === "Inpatient treatment orders")?.forms.map((f) => f.code)).toEqual([
      "6A",
      "6B",
      "6B attachment",
      "6C",
      "6D",
    ]);
  });

  it("searches the register by code or by words", () => {
    const byCode = onCallHandoverLegalGroups("3a").flatMap((group) => group.forms.map((form) => form.code));
    expect(byCode).toContain("3A");
    const byWords = onCallHandoverLegalGroups("detention order").flatMap((group) => group.forms.map((f) => f.code));
    expect(byWords).toContain("3A");
    expect(onCallHandoverLegalGroups("zzzz")).toEqual([]);
    // Held until the wording is signed off (ON_CALL_HANDOVER_LEGAL_STATUSES_ENABLED).
    expect(onCallHandoverLegalStatusesMatching("not under")).toEqual([]);
  });

  it("titles a register code and leaves a plain status untitled", () => {
    expect(onCallHandoverLegalTitle("6A")).toBe("Inpatient treatment order in authorised hospital");
    expect(onCallHandoverLegalTitle("Voluntary")).toBeNull();
    expect(onCallHandoverLegalTitle("")).toBeNull();
  });

  it("offers recent legal values only from this handover, newest first, each once", () => {
    saveOnCallHandoverPatient(null, draft({ bed: "1", legal: "3A" }), twoAm);
    saveOnCallHandoverPatient(null, draft({ bed: "2", legal: "Voluntary" }), halfThree);
    saveOnCallHandoverPatient(null, draft({ bed: "3", legal: "3A" }), new Date(halfThree.getTime() + 60_000));
    expect(onCallHandoverRecentLegal(shown(halfThree).patients)).toEqual(["3A", "Voluntary"]);
  });

  it("labels a bed number as a bed and initials as typed", () => {
    expect(onCallHandoverPatientLabel("12", 0)).toBe("Bed 12");
    expect(onCallHandoverPatientLabel("JS", 0)).toBe("JS");
    expect(onCallHandoverPatientLabel("", 2)).toBe("Patient 3");
  });

  it("summarises an export by count and review, never by names", () => {
    const summary = onCallHandoverExportSummary([draft({ review: "yes" }), draft({ bed: "JS" })]);
    expect(summary).toEqual({
      title: "This handover lists 2 patients",
      detail: "Beds and initials only · 1 for review",
    });
  });

  it("writes the shift's dates across midnight in Perth", () => {
    // 20:00 Sun 4 Oct to 08:00 Mon 5 Oct, Perth.
    expect(onCallHandoverDateRange(Date.parse("2026-10-04T12:00:00Z"), Date.parse("2026-10-05T00:00:00Z"))).toBe(
      "Sun 4 – Mon 5 Oct",
    );
    expect(onCallHandoverDateRange(Date.parse("2026-10-05T01:00:00Z"), Date.parse("2026-10-05T08:00:00Z"))).toBe(
      "Mon 5 Oct",
    );
  });

  it("dates an export by its start alone when the clear time is the 12-hour fallback, not a roster end", () => {
    // Started 14:00 Mon 5 Oct, Perth; the 12-hour fallback clears at 02:00 Tue 6 Oct.
    const started = Date.parse("2026-10-05T06:00:00Z");
    expect(onCallHandoverShiftDates(started, started + 12 * 60 * 60 * 1000)).toBe("Mon 5 Oct");
    // A rostered night, 20:00 Sun 4 to 08:00 Mon 5 Oct, keeps its range.
    expect(onCallHandoverShiftDates(Date.parse("2026-10-04T12:00:00Z"), Date.parse("2026-10-05T00:30:00Z"))).toBe(
      "Sun 4 – Mon 5 Oct",
    );
  });

  it("stops offering a call once it has been made into a record", () => {
    const noted = addOnCallCallLogEntry({ label: "", caller: "ED", note: "Agitated", followUp: "" }, twoAm);
    if (!noted.ok) throw new Error("not noted");
    expect(onCallHandoverCallsNotIn([noted.entry], [])).toHaveLength(1);
    const saved = saveOnCallHandoverPatient(null, onCallHandoverDraftFromCall(noted.entry), twoAm);
    if (!saved.ok) throw new Error("not saved");
    expect(saved.patient.fromCall).toBe(noted.entry.id);
    expect(onCallHandoverCallsNotIn([noted.entry], shown(twoAm).patients)).toEqual([]);
  });
});

describe("shift pulse call counts", () => {
  it("counts a noted call by its Perth hour and keeps nothing else about it", () => {
    addOnCallCallLogEntry({ label: "4B-12", caller: "ED registrar", note: "Agitated", followUp: "" }, twoAm);
    const raw = window.localStorage.getItem(onCallCallCountsStorageKey);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("4B-12");
    expect(raw).not.toContain("Agitated");
    expect(parseOnCallCallCounts(raw).hours).toEqual({ [onCallPerthHourKey(twoAm)]: 1 });
    expect(onCallPerthHourKey(twoAm)).toBe("2026-10-03T02");
  });

  it("is wiped at sign-out with the other On Call stores", () => {
    expect(ON_CALL_DEVICE_STATE_KEYS).toContain(onCallCallCountsStorageKey);
  });

  it("puts a 02:00 call on the night that began the evening before", () => {
    addOnCallCallLogEntry({ label: "", caller: "Ward", note: "x", followUp: "" }, twoAm);
    const nights = onCallPulseNights(window.localStorage.getItem(onCallCallCountsStorageKey), halfThree);
    expect(nights[0]!.label).toBe("Tonight");
    expect(nights[0]!.counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(nights).toHaveLength(5);
  });

  it("names the busiest two hours only once there is enough to say", () => {
    const nights = [{ label: "Tonight", counts: [0, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }];
    expect(onCallPulsePeak(nights)).toBe("21:00 to 23:00");
    expect(onCallPulsePeak([{ label: "Tonight", counts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }])).toBeNull();
  });
});

describe("never searched, never sent to AI", () => {
  it("keeps the handover out of every work-search file", () => {
    for (const file of ["model", "items", "search", "answers", "signals", "terms", "sample"]) {
      const source = readFileSync(`src/lib/work-search/${file}.ts`, "utf8");
      expect(source, file).not.toMatch(/on-call\/handover|on-call\/call-counts/);
    }
  });
});

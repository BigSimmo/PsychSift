import { describe, expect, it } from "vitest";

import { EXAMPLE_ASSESSMENTS_SUPERVISION } from "@/lib/example-data/datasets/assessments-supervision";
import { initialAssessmentsState } from "@/lib/teaching/assessments/model";
import { SAMPLE_SUPERVISOR } from "@/lib/teaching/assessments/sample";
import {
  DEFAULT_ASSESSMENTS_EXPORT,
  EXAMPLE_NOT_SAVED,
  epaCsv,
  epaExportRows,
  exportBlocker,
  exportDoctors,
  statusExportRows,
  exportPreview,
  statusCsv,
  exportButtonLabel,
  exportFiles,
  signedForms,
} from "@/lib/work-screens/assessments/export";
import { patientDetailProblem } from "@/lib/work-screens/assessments/patient-check";
import { extrasReducer, initialExtras, settleForAnotherScreen } from "@/lib/teaching/assessments/extras";
import {
  hoursWords,
  initialTraineeState,
  reopenTraineeState,
  sessionLine,
  traineeReducer,
  traineeView,
  waitingCount,
} from "@/lib/work-screens/assessments/trainee";

const s = initialAssessmentsState();
const supervision = EXAMPLE_ASSESSMENTS_SUPERVISION;
/** Names come from the shared example list, so read them rather than pinning them. */
const doctorName = (id: string) => exportDoctors(s).find((d) => d.id === id)?.name ?? "";

describe("assessments export", () => {
  it("marks every exported row as an example and leaves them all out of the files", () => {
    const rows = epaExportRows(s, { ...DEFAULT_ASSESSMENTS_EXPORT, period: "year" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.id.startsWith("example:")).toBe(true);
    const csv = epaCsv(s, { ...DEFAULT_ASSESSMENTS_EXPORT, period: "year" }, "7 Oct 2026");
    expect(csv).toContain("None recorded for this choice");
    expect(csv).toContain("Feedback text is never exported here.");
    for (const row of rows) expect(csv).not.toContain(row.by);
    expect(statusCsv(s, DEFAULT_ASSESSMENTS_EXPORT, "7 Oct 2026")).not.toContain(doctorName("ben"));
    expect(exportPreview(s, DEFAULT_ASSESSMENTS_EXPORT)).toMatchObject({ saveable: 0 });
    expect(exportBlocker(s, DEFAULT_ASSESSMENTS_EXPORT)).toBe(EXAMPLE_NOT_SAVED);
  });

  it("holds your own doctors only, never another consultant's", () => {
    expect(exportDoctors(s).map((d) => d.id)).toEqual(["sam", "ben", "mia"]);
    const rows = statusExportRows(s, DEFAULT_ASSESSMENTS_EXPORT);
    expect(rows.map((r) => r.supervisor)).toEqual([
      SAMPLE_SUPERVISOR.name,
      SAMPLE_SUPERVISOR.name,
      SAMPLE_SUPERVISOR.name,
    ]);
    expect(statusExportRows(s, { ...DEFAULT_ASSESSMENTS_EXPORT, doctor: "ravi" })).toEqual([]);
  });

  it("starts each file with exactly one byte-order mark and never calls kept rows made up", () => {
    const status = statusCsv(s, DEFAULT_ASSESSMENTS_EXPORT, "7 Oct 2026");
    const epas = epaCsv(s, DEFAULT_ASSESSMENTS_EXPORT, "7 Oct 2026");
    for (const csv of [status, epas]) {
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv.startsWith("\uFEFF\uFEFF")).toBe(false);
      expect(csv.endsWith("\r\n")).toBe(true);
    }
    expect(status).not.toContain("Made-up example");
    expect(status.split("\r\n")[0]).toBe('\uFEFF"Term status","7 Oct 2026"');
    expect(status).toContain("None recorded for this choice");
  });

  it("has no EPAs or forms for a doctor the sample holds no records for", () => {
    const ben = { ...DEFAULT_ASSESSMENTS_EXPORT, doctor: "ben" };
    expect(epaCsv(s, ben, "today")).toContain("None recorded for this choice");
    expect(signedForms(s, ben)).toEqual([]);
  });

  it("adds past terms' signed forms only for the whole year", () => {
    const term = signedForms(s, DEFAULT_ASSESSMENTS_EXPORT);
    const year = signedForms(s, { ...DEFAULT_ASSESSMENTS_EXPORT, period: "year" });
    expect(term.some((f) => f.id === "t4-mid")).toBe(true);
    expect(year.length).toBeGreaterThan(term.length);
    for (const form of year) expect(form.href).toMatch(/^\/teaching\/assessments\?view=pdf&/);
  });

  it("names files by period and doctor, and explains a Save that cannot run", () => {
    expect(exportFiles(DEFAULT_ASSESSMENTS_EXPORT).map((f) => f.name)).toEqual([
      "epas-term-all-doctors.csv",
      "term-status-all-doctors.csv",
    ]);
    expect(exportButtonLabel(DEFAULT_ASSESSMENTS_EXPORT)).toBe("Save 2 spreadsheets");
    expect(exportButtonLabel({ ...DEFAULT_ASSESSMENTS_EXPORT, status: false })).toBe("Save 1 spreadsheet");
    expect(exportBlocker(s, { ...DEFAULT_ASSESSMENTS_EXPORT, epas: false, status: false })).toBe(
      "Open each form below to see its printable copy.",
    );
    expect(exportBlocker(s, { ...DEFAULT_ASSESSMENTS_EXPORT, forms: false, epas: false, status: false })).toBe(
      "Choose what to include.",
    );
  });
});

describe("supervisor's view of a trainee", () => {
  it("returns null for a doctor not in the sample", () => {
    expect(traineeView(s, initialTraineeState, "nobody", supervision)).toBeNull();
  });

  it("shows status, and only what they asked of you, for a doctor another consultant supervises", () => {
    const view = traineeView(s, initialTraineeState, "ravi", supervision)!;
    expect(view.yours).toBe(false);
    // Ravi asked you for an EPA (it is in your inbox), so it shows here too. Sessions and corrections do not.
    expect(view.waiting.map((r) => r.id)).toEqual(["ravi-epa-3"]);
    expect(view.toConfirm).toEqual([]);
    expect(view.recent).toEqual([]);
    expect(view.correction).toBeNull();
    expect(view.timeline.map((t) => t.id)).toEqual(["mid", "epas", "end"]);
    // A doctor who asked you nothing shows status only.
    expect(traineeView(s, initialTraineeState, "tom", supervision)!.waiting).toEqual([]);
  });

  it("counts what waits for you: requests, sessions and an open correction", () => {
    const ben = traineeView(s, initialTraineeState, "ben", supervision)!;
    expect(ben.yours).toBe(true);
    expect(ben.correction?.proposed).toBe("90 min");
    expect(waitingCount(ben, initialTraineeState)).toBe(ben.waiting.length + 1);
    const mia = traineeView(s, initialTraineeState, "mia", supervision)!;
    expect(mia.waiting.some((r) => r.id === "mia-epa-2")).toBe(true);
    expect(waitingCount(mia, initialTraineeState)).toBe(mia.waiting.length + 1);
  });

  it("confirms a session with Undo, and keeps it as To send while offline", () => {
    let state = traineeReducer(initialTraineeState, { type: "confirm", id: "example:sam-s3", offline: false });
    expect(state.sessions["example:sam-s3"]).toBe("sending");
    state = traineeReducer(state, { type: "confirm-undo", id: "example:sam-s3" });
    expect(state.sessions["example:sam-s3"]).toBe("waiting");
    state = traineeReducer(state, { type: "confirm", id: "example:sam-s3", offline: true });
    expect(state.sessions["example:sam-s3"]).toBe("queued");
    state = traineeReducer(state, { type: "confirm-commit", id: "example:sam-s3" });
    const view = traineeView(s, state, "sam", supervision)!;
    expect(view.toConfirm).toEqual([]);
    expect(view.confirmedMinutes).toBe(210);
    expect(hoursWords(view.confirmedMinutes)).toBe("3.5\u00a0h");
    // A confirmed session cannot be undone by a late Undo.
    expect(traineeReducer(state, { type: "confirm-undo", id: "example:sam-s3" }).sessions["example:sam-s3"]).toBe(
      "confirmed",
    );
  });

  it("asks for a correction only with a field chosen, and Undo takes it back", () => {
    expect(
      traineeReducer(initialTraineeState, { type: "ask", id: "example:mia-s1", ask: { field: "", note: "" } }),
    ).toBe(initialTraineeState);
    const asked = traineeReducer(initialTraineeState, {
      type: "ask",
      id: "example:mia-s1",
      ask: { field: "length", note: "90?" },
    });
    expect(asked.sessions["example:mia-s1"]).toBe("asked");
    expect(asked.asks["example:mia-s1"]).toEqual({ field: "length", note: "90?" });
    const undone = traineeReducer(asked, { type: "ask-undo", id: "example:mia-s1" });
    expect(undone.sessions["example:mia-s1"]).toBe("waiting");
    expect(undone.asks["example:mia-s1"]).toBeUndefined();
  });

  it("settles a proposed correction once, with Undo", () => {
    const confirmed = traineeReducer(initialTraineeState, {
      type: "correction",
      id: "example:ben-c1",
      to: "confirmed",
    });
    expect(traineeView(s, confirmed, "ben", supervision)!.correctionStatus).toBe("confirmed");
    expect(traineeReducer(confirmed, { type: "correction", id: "example:ben-c1", to: "later" })).toBe(confirmed);
    const undone = traineeReducer(confirmed, { type: "correction-undo", id: "example:ben-c1", to: "waiting" });
    expect(traineeView(s, undone, "ben", supervision)!.correctionStatus).toBe("waiting");
  });

  it("confirms a correction that was left for later, and Undo puts it back to Later", () => {
    const later = traineeReducer(initialTraineeState, { type: "correction", id: "example:ben-c1", to: "later" });
    expect(traineeReducer(later, { type: "correction", id: "example:ben-c1", to: "later" })).toBe(later);
    const confirmed = traineeReducer(later, { type: "correction", id: "example:ben-c1", to: "confirmed" });
    expect(traineeView(s, confirmed, "ben", supervision)!.correctionStatus).toBe("confirmed");
    const undone = traineeReducer(confirmed, { type: "correction-undo", id: "example:ben-c1", to: "later" });
    expect(traineeView(s, undone, "ben", supervision)!.correctionStatus).toBe("later");
  });

  it("starts a kept confirmation's 10 seconds only from To send", () => {
    const queued = traineeReducer(initialTraineeState, { type: "confirm", id: "example:sam-s3", offline: true });
    const sending = traineeReducer(queued, { type: "confirm-send", id: "example:sam-s3" });
    expect(sending.sessions["example:sam-s3"]).toBe("sending");
    expect(traineeReducer(initialTraineeState, { type: "confirm-send", id: "example:sam-s3" })).toBe(
      initialTraineeState,
    );
  });

  it("answers an EPA request through the inbox's own reducer", () => {
    const sent = traineeReducer(initialTraineeState, {
      type: "extras",
      action: { type: "inbox-send", id: "mia-epa-2", level: "proximal", text: "Clear plan.", at: "10:00" },
    });
    const view = traineeView(s, sent, "mia", supervision)!;
    expect(view.waiting.some((r) => r.id === "mia-epa-2")).toBe(false);
    expect(view.answered.some((r) => r.id === "mia-epa-2")).toBe(true);
  });

  it("shows an answer sent from the inbox, and takes back one still in its 10 seconds when the screen closed", () => {
    const sending = extrasReducer(initialExtras, {
      type: "inbox-send",
      id: "mia-epa-2",
      level: "proximal",
      text: "Clear plan.",
      at: "10:00",
    });
    const sent = extrasReducer(sending, { type: "inbox-commit", id: "mia-epa-2" });
    const fromSent = traineeView(
      s,
      reopenTraineeState(initialTraineeState, settleForAnotherScreen(sent)),
      "mia",
      supervision,
    )!;
    expect(fromSent.answered.some((r) => r.id === "mia-epa-2")).toBe(true);
    const settled = settleForAnotherScreen(sending);
    expect(settled.answers["mia-epa-2"]).toMatchObject({ status: "waiting", level: "proximal", text: "Clear plan." });
    expect(traineeView(s, reopenTraineeState(initialTraineeState, settled), "mia", supervision)!.waiting).toHaveLength(
      1,
    );
  });

  it("opens again with a confirmation in its 10 seconds back to waiting, and one kept offline still kept", () => {
    const reopened = reopenTraineeState(
      { sessions: { a: "sending", b: "queued", c: "confirmed" }, asks: {}, corrections: {} },
      initialExtras,
    );
    expect(reopened.sessions).toEqual({ a: "waiting", b: "queued", c: "confirmed" });
  });

  it("words a session line", () => {
    expect(sessionLine({ date: "Mon 5 Oct", minutes: 60, kind: "Individual" })).toBe(
      "Mon 5 Oct · 60\u00a0min · Individual",
    );
  });
});

describe("patient-detail adapter", () => {
  it("passes empty and ordinary text, and flags what the shared check flags", () => {
    expect(patientDetailProblem("   ")).toBeNull();
    expect(patientDetailProblem("Calm, clear escalation.")).toBeNull();
    const problem = patientDetailProblem("Calm review of bed 12 overnight");
    expect(problem).not.toBeNull();
    expect(problem?.title).toBeTruthy();
  });
});

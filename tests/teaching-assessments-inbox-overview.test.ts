import { describe, expect, it } from "vitest";

import { extrasReducer, initialExtras } from "@/lib/teaching/assessments/extras";
import {
  ageText,
  feedbackProblem,
  filterCounts,
  inboxRequests,
  isWaiting,
  sampleDayOffset,
  sendBlocker,
  sortInbox,
} from "@/lib/teaching/assessments/inbox";
import { assessmentsReducer, initialAssessmentsState, type AssessmentsState } from "@/lib/teaching/assessments/model";
import {
  filterOverview,
  midTermSummary,
  overviewCounts,
  overviewCsv,
  overviewDoctors,
  remindableForms,
  reminderKey,
  supervisorGroups,
} from "@/lib/teaching/assessments/overview";

function at(now: number, ...steps: Parameters<typeof assessmentsReducer>[1][]): AssessmentsState {
  let s = assessmentsReducer(initialAssessmentsState(), { type: "set-now", now });
  for (const step of steps) s = assessmentsReducer(s, step);
  return s;
}

describe("consultant inbox", () => {
  it("counts days on the made-up calendar", () => {
    expect(sampleDayOffset(-1)).toBe(0);
    expect(sampleDayOffset(0)).toBe(21);
    expect(sampleDayOffset(5)).toBe(28);
    expect(ageText(0)).toBe("Today");
    expect(ageText(1)).toBe("1 day");
    expect(ageText(4)).toBe("4 days");
  });

  it("lists Ben's mid-term and the made-up EPAs, overdue only once the window opens", () => {
    const before = inboxRequests(at(-1), {});
    expect(before.map((i) => i.id)).toEqual(["ben-mid", "mia-epa-2", "ella-epa-4", "ravi-epa-3"]);
    expect(before.find((i) => i.id === "ben-mid")!.overdue).toBe(false);
    const during = inboxRequests(at(0), {});
    const ben = during.find((i) => i.id === "ben-mid")!;
    expect(ben.overdue).toBe(true);
    expect(ben.due).toBe("Overdue since Fri 16 Oct");
    expect(sortInbox(during, "oldest")[0]!.id).toBe("ben-mid");
  });

  it("adds Sam's end-of-term and EPA requests from the sample's own story", () => {
    const s = at(
      -1,
      { type: "form-example", who: "self" },
      { type: "form-finish", who: "self" },
      { type: "send-request" },
      { type: "request-epa", epa: 1, who: "sup" },
      { type: "request-epa", epa: 2, who: "reg" },
    );
    const items = inboxRequests(s, {});
    const eot = items.find((i) => i.id === "sam-eot")!;
    expect(eot.open).toEqual({ kind: "href", view: "form" });
    const epa = items.find((i) => i.id === "sam-epa-0")!;
    expect(epa.open).toEqual({ kind: "sheet", index: 0 });
    expect(epa.due).toBe("By Sun 8 Nov");
    // A request to the registrar is not the supervisor's.
    expect(items.some((i) => i.id === "sam-epa-1")).toBe(false);
    const recorded = assessmentsReducer(s, { type: "record-epa", index: 0, level: "proximal" });
    expect(inboxRequests(recorded, {}).find((i) => i.id === "sam-epa-0")!.status).toBe("sent");
  });

  it("filters, counts and sorts what is waiting", () => {
    const items = inboxRequests(at(0), {});
    expect(filterCounts(items)).toEqual({ all: 4, overdue: 1, epas: 3, forms: 1 });
    expect(sortInbox(items, "doctor").map((i) => i.doctor.name)).toEqual([
      "Dr Ben Ortiz",
      "Dr Ella Okafor",
      "Dr Mia Chen",
      "Dr Ravi Kaur",
    ]);
    const later = inboxRequests(at(0), {
      "ella-epa-4": { status: "later", level: null, text: "", reason: "not_this_week" },
    });
    expect(sortInbox(later, "oldest").at(-1)!.id).toBe("ella-epa-4");
    expect(isWaiting(later.find((i) => i.id === "ella-epa-4")!)).toBe(true);
  });

  it("catches patient details in a few lines, and needs a level to send", () => {
    expect(feedbackProblem("")).toBeNull();
    expect(feedbackProblem("Calm, clear escalation. Next time, call the registrar sooner.")).toBeNull();
    const bed = feedbackProblem("Good review of the man in bed 12 overnight");
    expect(bed).not.toBeNull();
    expect(bed!.body).toContain("catches some details, not all");
    expect(feedbackProblem("Saw Mr Smith on the ward")).not.toBeNull();
    expect(feedbackProblem("URN 1234567 reviewed")).not.toBeNull();
    expect(sendBlocker({ level: null, text: "" })).toBe("Choose the supervision the doctor needed.");
    expect(sendBlocker({ level: "direct", text: "" })).toBeNull();
    expect(sendBlocker({ level: "direct", text: "bed 4 was busy" })).toBe("Remove the patient details to send.");
    expect(sendBlocker({ level: "direct", text: "x".repeat(501) })).toBe("Keep it to 500 characters.");
  });
});

describe("inbox and reminder state", () => {
  it("sends with Undo, keeping the answer when undone", () => {
    let s = extrasReducer(initialExtras, { type: "inbox-send", id: "mia-epa-2", level: "proximal", text: "Good" });
    expect(s.answers["mia-epa-2"]!.status).toBe("sending");
    const undone = extrasReducer(s, { type: "inbox-undo", id: "mia-epa-2" });
    expect(undone.answers["mia-epa-2"]).toMatchObject({ status: "waiting", level: "proximal", text: "Good" });
    s = extrasReducer(s, { type: "inbox-commit", id: "mia-epa-2" });
    expect(s.answers["mia-epa-2"]!.status).toBe("sent");
    // Once sent, Undo and a second send change nothing.
    expect(extrasReducer(s, { type: "inbox-undo", id: "mia-epa-2" })).toBe(s);
    expect(extrasReducer(s, { type: "inbox-send", id: "mia-epa-2", level: "direct", text: "" })).toBe(s);
    const item = inboxRequests(at(-1), s.answers).find((i) => i.id === "mia-epa-2")!;
    expect(item.doneLine).toBe("Proximal, with a few lines");
  });

  it("passes a request on, or moves it to Later, and brings it back", () => {
    const passed = extrasReducer(initialExtras, { type: "inbox-cant", id: "ravi-epa-3", reason: "other_consultant" });
    expect(passed.answers["ravi-epa-3"]!.status).toBe("passed");
    const later = extrasReducer(initialExtras, { type: "inbox-cant", id: "ravi-epa-3", reason: "not_this_week" });
    expect(later.answers["ravi-epa-3"]!.status).toBe("later");
    expect(extrasReducer(passed, { type: "inbox-restore", id: "ravi-epa-3" }).answers["ravi-epa-3"]!.status).toBe(
      "waiting",
    );
  });

  it("keeps one reminder a day per form, and takes it back on Undo", () => {
    const key = reminderKey("ravi", "mid", 0);
    const s = extrasReducer(initialExtras, { type: "remind", keys: [key] });
    expect(extrasReducer(s, { type: "remind", keys: [key] })).toBe(s);
    expect(extrasReducer(s, { type: "unremind", keys: [key] }).reminded).toEqual([]);
    expect(reminderKey("ravi", "mid", 1)).not.toBe(key);
  });
});

describe("term overview", () => {
  it("shows status only, overdue first, with Sam's row from the sample", () => {
    const rows = overviewDoctors(at(-1));
    expect(rows).toHaveLength(8);
    expect(rows[0]!.bucket).toBe("overdue");
    const sam = rows.find((r) => r.id === "sam")!;
    expect(sam.mid).toEqual({ status: "done", detail: "Done Fri 2 Oct" });
    expect(sam.end.status).toBe("not_yet");
    const ben = rows.find((r) => r.id === "ben")!;
    expect(ben.mid.status).toBe("due");
    expect(overviewDoctors(at(0)).find((r) => r.id === "ben")!.mid.status).toBe("overdue");
    for (const row of rows) expect(Object.keys(row).sort()).not.toContain("ratings");
  });

  it("summarises the mid-term meter in words", () => {
    const rows = overviewDoctors(at(-1));
    const summary = midTermSummary(rows);
    expect(summary.done + summary.due + summary.overdue).toBe(8);
    expect(summary.label).toBe("Mid-term: 4 done, 2 due, 2 overdue, of 8 doctors.");
    const counts = overviewCounts(rows);
    expect(counts.all).toBe(8);
    expect(filterOverview(rows, "overdue")).toHaveLength(counts.overdue);
  });

  it("offers a reminder only for a due or overdue form", () => {
    const rows = overviewDoctors(at(-1));
    expect(remindableForms(rows.find((r) => r.id === "ravi")!)).toEqual(["mid"]);
    expect(remindableForms(rows.find((r) => r.id === "noah")!)).toEqual([]);
    expect(remindableForms(overviewDoctors(at(0)).find((r) => r.id === "noah")!)).toEqual(["end"]);
    const groups = supervisorGroups(rows);
    expect(groups.map((g) => g.name)).toEqual(["Dr Hana Ito", "Dr Omar Ahmed", "Dr Priya Nair"]);
  });

  it("exports a status-only CSV labelled as made-up", () => {
    const csv = overviewCsv(overviewDoctors(at(-1)), "Mon 5 Oct");
    expect(csv.split("\r\n")[0]).toBe('"Made-up example, not real doctors","Mon 5 Oct"');
    expect(csv).toContain('"Doctor","Grade","Unit","Supervisor","Mid-term","EPAs this term","End-of-term"');
    expect(csv).not.toMatch(/rating|comment/i);
  });
});

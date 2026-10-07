import { describe, expect, it } from "vitest";

import { extrasReducer, initialExtras, remindedKeys } from "@/lib/teaching/assessments/extras";
import {
  EMPTY_ANSWER,
  ageText,
  claCopyText,
  dctRemindersFor,
  doctorSees,
  doctorView,
  feedbackProblem,
  inboxRowStatus,
  filterCounts,
  inboxRequests,
  isWaiting,
  sampleDayOffset,
  sendBlocker,
  sortInbox,
} from "@/lib/teaching/assessments/inbox";
import { assessmentsReducer, initialAssessmentsState, type AssessmentsState } from "@/lib/teaching/assessments/model";
import {
  DEFAULT_EXPORT_OPTIONS,
  assessmentsSampleSearchEntries,
  bulkRecipients,
  cellLabel,
  doctorTimeline,
  exportBlocker,
  filterOverview,
  midTermSummary,
  overviewCounts,
  overviewCsv,
  overviewDoctors,
  nothingDueYet,
  pendingForms,
  reminderMessage,
  remindableForms,
  reminderKey,
  reminderRecords,
  supervisorGroups,
  supervisorMix,
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
    let s = extrasReducer(initialExtras, {
      type: "inbox-send",
      id: "mia-epa-2",
      level: "proximal",
      text: "Good",
      at: "15:02",
    });
    expect(s.answers["mia-epa-2"]!.status).toBe("sending");
    const undone = extrasReducer(s, { type: "inbox-undo", id: "mia-epa-2" });
    expect(undone.answers["mia-epa-2"]).toMatchObject({ status: "waiting", level: "proximal", text: "Good" });
    s = extrasReducer(s, { type: "inbox-commit", id: "mia-epa-2" });
    expect(s.answers["mia-epa-2"]!.status).toBe("sent");
    // Once sent, Undo and a second send change nothing.
    expect(extrasReducer(s, { type: "inbox-undo", id: "mia-epa-2" })).toBe(s);
    expect(extrasReducer(s, { type: "inbox-send", id: "mia-epa-2", level: "direct", text: "", at: "15:03" })).toBe(s);
    const item = inboxRequests(at(-1), s.answers).find((i) => i.id === "mia-epa-2")!;
    expect(item.doneLine).toBe("Sent 15:02 · Proximal, with a few lines");
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
    const ravi = overviewDoctors(at(-1)).find((r) => r.id === "ravi")!;
    const records = reminderRecords(ravi, ["mid"], 0, "09:10");
    expect(records[0]).toMatchObject({ key, supervisor: "Dr Omar Ahmed", doctorName: "Dr Ravi Kaur", at: "09:10" });
    const s = extrasReducer(initialExtras, { type: "remind", records });
    expect(remindedKeys(s)).toEqual([key]);
    expect(extrasReducer(s, { type: "remind", records })).toBe(s);
    expect(extrasReducer(s, { type: "unremind", keys: [key] }).reminders).toEqual([]);
    expect(reminderKey("ravi", "mid", 1)).not.toBe(key);
    expect(pendingForms(ravi, remindedKeys(s), 0)).toEqual([]);
    expect(pendingForms(ravi, remindedKeys(s), 1)).toEqual(["mid"]);
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

describe("inbox rows, passing on, and what the doctor sees", () => {
  it("gives each row one rail and one tag, so colour never carries it alone", () => {
    const items = inboxRequests(at(0), {});
    const byId = (id: string) => items.find((i) => i.id === id)!;
    expect(inboxRowStatus(byId("ben-mid"))).toEqual({ rail: "overdue", tag: "Overdue", tone: "bad" });
    // Ella asked on Tue 29 Sep: by Mon 26 Oct that is weeks of waiting.
    expect(inboxRowStatus(byId("ella-epa-4"))).toMatchObject({ rail: "long", tone: "warm", tag: "3\u00a0weeks" });
    const fresh = inboxRequests(at(-1), {});
    expect(inboxRowStatus(fresh.find((i) => i.id === "ravi-epa-3")!)).toEqual({
      rail: "new",
      tag: "New",
      tone: "accent",
    });
    expect(inboxRowStatus(fresh.find((i) => i.id === "mia-epa-2")!)).toMatchObject({
      rail: "none",
      tag: "3\u00a0days",
    });
    const later = inboxRequests(at(-1), { "mia-epa-2": { ...EMPTY_ANSWER, status: "later", reason: "not_this_week" } });
    expect(inboxRowStatus(later.find((i) => i.id === "mia-epa-2")!).tag).toBe("Later · Mon 08:00");
    const queued = inboxRequests(at(-1), { "mia-epa-2": { ...EMPTY_ANSWER, status: "queued", level: "direct" } });
    expect(inboxRowStatus(queued.find((i) => i.id === "mia-epa-2")!).tag).toBe("To send");
    expect(ageText(7)).toBe("1\u00a0week");
    expect(ageText(15)).toBe("2\u00a0weeks");
  });

  it("says exactly what the doctor sees when a request is passed on", () => {
    expect(doctorSees("not_seen", "Dr Hana Ito")).toBe(
      "Not able to assess this one, as I did not see this work. Try Dr Hana Ito.",
    );
    expect(doctorSees("other_consultant", null)).toBe("Better assessed by another consultant. Ask someone who saw it.");
    expect(doctorSees("not_this_week", "Dr Hana Ito")).toBe("Your supervisor will look at this from Mon 08:00.");
    const s = extrasReducer(initialExtras, {
      type: "inbox-cant",
      id: "ravi-epa-3",
      reason: "other_consultant",
      suggestion: "Dr Omar Ahmed",
    });
    const item = inboxRequests(at(-1), s.answers).find((i) => i.id === "ravi-epa-3")!;
    expect(item.doneLine).toBe("Passed on to another consultant · suggested Dr Omar Ahmed");
    expect(doctorView(item, s.answers["ravi-epa-3"]!)!.words).toBe(
      "Better assessed by another consultant. Try Dr Omar Ahmed.",
    );
    // Later never carries a suggestion.
    const later = extrasReducer(initialExtras, {
      type: "inbox-cant",
      id: "ravi-epa-3",
      reason: "not_this_week",
      suggestion: "Dr Omar Ahmed",
    });
    expect(later.answers["ravi-epa-3"]!.suggestion).toBeNull();
  });

  it("shows the doctor the level and the words, and copies them for Clinical Learning Australia", () => {
    let s = extrasReducer(initialExtras, {
      type: "inbox-send",
      id: "mia-epa-2",
      level: "proximal",
      text: "  Calm, clear escalation.  ",
      at: "11:58",
    });
    s = extrasReducer(s, { type: "inbox-commit", id: "mia-epa-2" });
    const item = inboxRequests(at(-1), s.answers).find((i) => i.id === "mia-epa-2")!;
    const view = doctorView(item, s.answers["mia-epa-2"]!)!;
    expect(view).toEqual({
      heading: "Your supervisor answered",
      when: "Today 11:58 · you asked Fri 2 Oct",
      level: "Proximal supervision",
      words: "Calm, clear escalation.",
    });
    expect(claCopyText(item, s.answers["mia-epa-2"]!)).toBe(
      [
        "EPA 2 · Acutely unwell patient",
        "Supervisor: Dr Priya Nair",
        "Supervision needed: Proximal",
        "Feedback: Calm, clear escalation.",
        "Asked Fri 2 Oct",
      ].join("\n"),
    );
    expect(doctorView(item, EMPTY_ANSWER)).toBeNull();
  });

  it("keeps an offline answer as To send, and Undo brings it back to waiting", () => {
    const queued = extrasReducer(initialExtras, { type: "inbox-queue", id: "mia-epa-2", level: "minimal", text: "Ok" });
    expect(queued.answers["mia-epa-2"]).toMatchObject({ status: "queued", level: "minimal", text: "Ok" });
    const item = inboxRequests(at(-1), queued.answers).find((i) => i.id === "mia-epa-2")!;
    expect(isWaiting(item)).toBe(true);
    expect(item.doneLine).toBe("To send · Minimal, with a few lines");
    const sending = extrasReducer(queued, {
      type: "inbox-send",
      id: "mia-epa-2",
      level: "minimal",
      text: "Ok",
      at: "12:52",
    });
    expect(sending.answers["mia-epa-2"]!.status).toBe("sending");
    expect(extrasReducer(queued, { type: "inbox-undo", id: "mia-epa-2" }).answers["mia-epa-2"]!.status).toBe("waiting");
  });

  it("brings a DCT reminder to this supervisor into the inbox, matched to the request", () => {
    const rows = overviewDoctors(at(0));
    const ben = rows.find((r) => r.id === "ben")!;
    const ravi = rows.find((r) => r.id === "ravi")!;
    const reminders = [...reminderRecords(ben, ["mid"], 0, "09:10"), ...reminderRecords(ravi, ["mid"], 0, "09:12")];
    const items = inboxRequests(at(0), {});
    expect(dctRemindersFor(reminders, items)).toEqual([
      { key: "ben:mid:0", text: "Dr Ben Ortiz · mid-term", at: "09:10", requestId: "ben-mid" },
    ]);
  });
});

describe("term overview reminders, export and words", () => {
  it("writes the reminder in status words only", () => {
    const rows = overviewDoctors(at(-1));
    const ravi = rows.find((r) => r.id === "ravi")!;
    expect(reminderMessage(ravi, "mid")).toBe(
      "Dr Ravi Kaur's mid-term assessment is overdue. Please finish it in Assessments, or tell the MEU if you need more time.",
    );
    const ben = rows.find((r) => r.id === "ben")!;
    expect(reminderMessage(ben, "mid")).toContain("is due Fri 16 Oct");
    for (const row of rows)
      for (const form of ["mid", "end"] as const)
        expect(reminderMessage(row, form)).not.toMatch(/rating|comment|score/i);
  });

  it("lists supervisors to remind, unticking those reminded today", () => {
    const rows = overviewDoctors(at(-1));
    const all = bulkRecipients(rows, [], -1);
    expect(all.map((x) => x.supervisor)).toEqual(["Dr Hana Ito", "Dr Omar Ahmed", "Dr Priya Nair"]);
    expect(all.find((x) => x.supervisor === "Dr Omar Ahmed")!.line).toBe("Dr Ravi Kaur · overdue since fri 2 oct");
    const ahmedKeys = all.find((x) => x.supervisor === "Dr Omar Ahmed")!.items.map((i) => i.key);
    const after = bulkRecipients(rows, ahmedKeys, -1);
    const ahmed = after.find((x) => x.supervisor === "Dr Omar Ahmed")!;
    expect(ahmed.remindedToday).toBe(true);
    expect(ahmed.items).toEqual([]);
    expect(after.at(-1)!.supervisor).toBe("Dr Omar Ahmed");
  });

  it("describes each supervisor's mix and each status mark in words", () => {
    const groups = supervisorGroups(overviewDoctors(at(-1)));
    const ito = groups.find((g) => g.name === "Dr Hana Ito")!;
    expect(supervisorMix(ito).label).toBe("3 doctors · mid-term 1 done, 1 due, 1 overdue");
    const rows = overviewDoctors(at(-1));
    const noah = rows.find((r) => r.id === "noah")!;
    expect(cellLabel("Mid-term", noah.mid)).toBe("Mid-term done");
    expect(cellLabel("EPAs", noah.epas)).toBe("EPAs 3 of 2, at the term target");
    expect(cellLabel("End-of-term", noah.end)).toBe("End-of-term not open yet");
    expect(doctorTimeline(noah).map((t) => t.title)).toEqual([
      "Mid-term assessment",
      "EPAs this term",
      "End-of-term assessment",
    ]);
    expect(nothingDueYet(rows)).toBe(false);
    expect(nothingDueYet(rows.map((r) => ({ ...r, mid: { status: "not_yet", detail: "" } })))).toBe(true);
  });

  it("exports only the columns asked for, with reminder history off by default", () => {
    const rows = overviewDoctors(at(-1));
    expect(DEFAULT_EXPORT_OPTIONS).toEqual({ forms: true, epas: true, history: false });
    const epasOnly = overviewCsv(rows, "Mon 5 Oct", { forms: false, epas: true, history: false });
    expect(epasOnly.split("\r\n")[1]).toBe('"Doctor","Grade","Unit","Supervisor","EPAs this term"');
    const ravi = rows.find((r) => r.id === "ravi")!;
    const withHistory = overviewCsv(rows, "Mon 5 Oct", { ...DEFAULT_EXPORT_OPTIONS, history: true }, [
      ...reminderRecords(ravi, ["mid"], -1, "09:10"),
    ]);
    expect(withHistory).toContain('"09:10","Dr Omar Ahmed","Dr Ravi Kaur","mid-term"');
    expect(overviewCsv(rows, "Mon 5 Oct")).not.toContain("Reminders sent");
    expect(exportBlocker({ forms: false, epas: false, history: true })).toBe(
      "Choose the forms, the EPA counts or both.",
    );
    expect(exportBlocker(DEFAULT_EXPORT_OPTIONS)).toBeNull();
  });

  it("offers work search the two sample pages only", () => {
    const entries = assessmentsSampleSearchEntries();
    expect(entries.map((e) => e.href)).toEqual([
      "/teaching/assessments?view=inbox&as=supervisor",
      "/teaching/assessments?view=overview&as=supervisor",
    ]);
    for (const e of entries) expect(e.title).toMatch(/made-up sample/);
  });
});

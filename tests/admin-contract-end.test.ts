import { describe, expect, it } from "vitest";

import {
  BOTH_REMINDERS_ON,
  buildContractAskedBody,
  buildContractCreateBody,
  buildContractEditBody,
  buildContractRemindersBody,
  buildContractRenewBody,
  CONTRACT_ASKED_TAG_PREFIX,
  CONTRACT_END_SLUG_PREFIX,
  CONTRACT_QUESTIONS,
  CONTRACT_SIX_WEEK_OFF_TAG,
  contractAskedQuestions,
  contractAskMessage,
  contractCalendarFile,
  contractEndSearchRecords,
  contractOpenAskable,
  contractPanelLine,
  contractReminderPoints,
  contractReminders,
  contractStatus,
  contractStrip,
  mailtoHref,
  reminderFields,
  selectContractEnd,
  selectContractEndNeedsYou,
  validateContractForm,
} from "@/lib/admin/contract-end";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

const TODAY = "2026-10-06";
const END = "2027-01-31";

function contractRow(endsOn: string, overrides: Partial<OnCallEntry> = {}, details: Record<string, unknown> = {}) {
  const fields = reminderFields(endsOn, BOTH_REMINDERS_ON);
  return complianceFixture(
    "Contract end",
    { category: "Personal", expiresOn: endsOn, leadTimeDays: fields.leadTimeDays, provenance: "typed", ...details },
    { slug: `${CONTRACT_END_SLUG_PREFIX}abc123`, tags: fields.tags, ...overrides },
  );
}

describe("contract reminder points", () => {
  it("works out 3 months and 6 weeks before the end from the letter date", () => {
    expect(contractReminderPoints(END)).toEqual({ threeMonths: "2026-10-31", sixWeeks: "2026-12-20" });
  });

  it("clamps 3 months back into a shorter month", () => {
    expect(contractReminderPoints("2027-05-31").threeMonths).toBe("2027-02-28");
  });

  it("stores and reads back every reminder choice", () => {
    for (const choice of [
      { threeMonths: true, sixWeeks: true },
      { threeMonths: true, sixWeeks: false },
      { threeMonths: false, sixWeeks: true },
      { threeMonths: false, sixWeeks: false },
    ]) {
      const fields = reminderFields(END, choice);
      const row = contractRow(END, { tags: fields.tags }, { leadTimeDays: fields.leadTimeDays });
      expect(contractReminders(row)).toEqual(choice);
    }
  });
});

describe("contract status and strip", () => {
  it("counts 117 days on the mockup's day and names the next reminder", () => {
    const status = contractStatus(END, TODAY, BOTH_REMINDERS_ON);
    expect(status.daysLeft).toBe(117);
    expect(status.phase).toBe("before-reminders");
    expect(status.nextReminder?.date).toBe("2026-10-31");
    expect(contractPanelLine(status)).toBe("First reminder Sat 31 Oct 2026, in 25 days. Then Sun 20 Dec 2026.");
  });

  it("says a reminder fired today and keeps the next one", () => {
    const status = contractStatus(END, "2026-10-31", BOTH_REMINDERS_ON);
    expect(status.phase).toBe("reminder-today");
    expect(contractPanelLine(status)).toMatch(/^Reminder today: 3 months to go\./);
    expect(contractPanelLine(status)).toMatch(/Next reminder Sun 20 Dec 2026\.$/);
  });

  it("says when both reminders are off, and when the end has passed", () => {
    expect(contractPanelLine(contractStatus(END, TODAY, { threeMonths: false, sixWeeks: false }))).toBe(
      "Both reminders are off. Turn one on below.",
    );
    const passed = contractStatus(END, "2027-02-02", BOTH_REMINDERS_ON);
    expect(passed.phase).toBe("ended");
    expect(passed.daysLeft).toBe(-2);
  });

  it("draws the last six months with a today tick and a full screen-reader sentence", () => {
    const strip = contractStrip(contractStatus(END, TODAY, { threeMonths: true, sixWeeks: false }));
    expect(strip.segments.map((segment) => segment.label)).toEqual(["Aug", "Sep", "Oct", "Nov", "Dec", "Jan"]);
    expect(strip.segments[0]?.filled).toBe(1);
    expect(strip.segments[3]?.filled).toBe(0);
    expect(strip.todayPosition).not.toBeNull();
    expect(strip.accessibleLabel).toContain("Today Tuesday 6 October 2026.");
    expect(strip.accessibleLabel).toContain("6 weeks reminder off");
    expect(strip.accessibleLabel).toContain("Ends Sunday 31 January 2027.");
  });
});

describe("contract form", () => {
  it("asks for the end date and refuses a date that has passed or a wrong year", () => {
    const base = { employer: "", note: "", reminders: BOTH_REMINDERS_ON };
    expect(validateContractForm({ ...base, endsOn: "" }, TODAY).endsOn).toMatch(/end date/);
    expect(validateContractForm({ ...base, endsOn: "2026-01-01" }, TODAY).endsOn).toMatch(/passed/);
    expect(validateContractForm({ ...base, endsOn: "2040-01-01" }, TODAY).endsOn).toMatch(/10 years/);
    expect(validateContractForm({ ...base, endsOn: END }, TODAY)).toEqual({});
  });

  it("catches a patient detail in the note", () => {
    const errors = validateContractForm(
      { endsOn: END, employer: "", note: "Bed 12 patient MRN 1234567", reminders: BOTH_REMINDERS_ON },
      TODAY,
    );
    expect(errors.noteProblem).toBeTruthy();
  });

  it("catches patient details hidden by invisible or full-width characters, and ages in words", () => {
    for (const note of [
      "Mrs\u200BSmith",
      "ｂｅｄ １２",
      "45 year old male",
      "patient John Smith",
      "J Smith",
      "45M",
      "Room 4",
    ]) {
      const errors = validateContractForm({ endsOn: END, employer: "", note, reminders: BOTH_REMINDERS_ON }, TODAY);
      expect(errors.noteProblem, note).toBeTruthy();
    }
  });

  it("lets a hospital in capitals and ordinary admin words through", () => {
    for (const employer of ["RPH", "Fiona Stanley Hospital (FSH)", "KGH"]) {
      expect(validateContractForm({ endsOn: END, employer, note: "", reminders: BOTH_REMINDERS_ON }, TODAY)).toEqual(
        {},
      );
    }
    for (const note of ["MET call roster", "Copy of contract on my USB", "RPH orientation"]) {
      expect(validateContractForm({ endsOn: END, employer: "", note, reminders: BOTH_REMINDERS_ON }, TODAY)).toEqual(
        {},
      );
    }
  });

  it("creates one private compliance row with the end date and the reminder lead time", () => {
    const body = buildContractCreateBody({ endsOn: END, employer: "", note: "", reminders: BOTH_REMINDERS_ON }, "zz9");
    expect(body.slug).toBe(`${CONTRACT_END_SLUG_PREFIX}zz9`);
    expect(body.isPersonal).toBe(true);
    expect(body.details).toMatchObject({ kind: "compliance", category: "Personal", expiresOn: END, leadTimeDays: 92 });
  });

  it("keeps the old end date in history when an edit changes it", () => {
    const row = contractRow(END);
    const body = buildContractEditBody(row, {
      endsOn: "2027-02-28",
      employer: "",
      note: "",
      reminders: BOTH_REMINDERS_ON,
    });
    expect((body.details as { expiryHistory?: string[] }).expiryHistory).toEqual([END]);
  });

  it("turns the 6 week reminder off with a tag and keeps the 3 month lead time", () => {
    const body = buildContractRemindersBody(contractRow(END), { threeMonths: true, sixWeeks: false });
    expect(body?.tags).toContain(CONTRACT_SIX_WEEK_OFF_TAG);
    expect((body?.details as { leadTimeDays: number }).leadTimeDays).toBe(92);
  });
});

describe("asked, waiting", () => {
  it("marks questions as asked in the list's own order and reads them back", () => {
    const row = contractRow(END);
    const body = buildContractAskedBody(row, ["untaken-leave", "training-program"], true);
    expect(body.tags).toEqual([
      `${CONTRACT_ASKED_TAG_PREFIX}training-program`,
      `${CONTRACT_ASKED_TAG_PREFIX}untaken-leave`,
    ]);
    const marked = { ...row, tags: body.tags ?? [] };
    expect(contractAskedQuestions(marked)).toEqual(["training-program", "untaken-leave"]);
    expect(
      contractAskedQuestions({ ...marked, tags: [...marked.tags, `${CONTRACT_ASKED_TAG_PREFIX}made-up`] }),
    ).toEqual(["training-program", "untaken-leave"]);
  });

  it("keeps the reminder tag when a question is marked, and unmarks one", () => {
    const row = contractRow(END, { tags: [CONTRACT_SIX_WEEK_OFF_TAG, `${CONTRACT_ASKED_TAG_PREFIX}in-writing`] });
    const body = buildContractAskedBody(row, ["in-writing"], false);
    expect(body.tags).toEqual([CONTRACT_SIX_WEEK_OFF_TAG]);
  });

  it("builds the message from the questions still open", () => {
    expect(contractOpenAskable([])).toEqual(["training-program", "parental-leave", "untaken-leave", "in-writing"]);
    expect(contractOpenAskable(["training-program", "parental-leave"])).toEqual(["untaken-leave", "in-writing"]);
  });

  it("starts the marks fresh on a new contract unless the doctor keeps them", () => {
    const row = contractRow(END, { tags: [`${CONTRACT_ASKED_TAG_PREFIX}in-writing`] });
    const fresh = buildContractRenewBody(row, "2028-01-31", TODAY);
    const kept = buildContractRenewBody(row, "2028-01-31", TODAY, { keepAnswers: true });
    expect(fresh.ok && fresh.body.tags).toEqual([]);
    expect(kept.ok && kept.body.tags).toEqual([`${CONTRACT_ASKED_TAG_PREFIX}in-writing`]);
  });
});

describe("new contract", () => {
  it("moves the reminders and refuses an earlier, equal or passed date", () => {
    const row = contractRow(END);
    const result = buildContractRenewBody(row, "2028-01-31", TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.body.details as { expiresOn: string; expiryHistory: string[] }).expiresOn).toBe("2028-01-31");
      expect((result.body.details as { expiryHistory: string[] }).expiryHistory).toEqual([END]);
    }
    expect(buildContractRenewBody(row, END, TODAY)).toEqual({ ok: false, reason: "unchanged" });
    expect(buildContractRenewBody(row, "2026-12-01", TODAY)).toEqual({ ok: false, reason: "not-later" });
    expect(buildContractRenewBody(row, "", TODAY)).toEqual({ ok: false, reason: "missing" });
  });
});

describe("asking Medical Workforce", () => {
  it("leaves parental leave dates out and names only the end date", () => {
    const message = contractAskMessage(["training-program", "parental-leave", "untaken-leave"], END);
    expect(message?.subject).toBe("My contract ends Sun 31 Jan 2027");
    expect(message?.body).toContain("whether planned parental leave would fall inside the next contract");
    expect(message?.body).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("returns nothing when no askable question is chosen", () => {
    expect(contractAskMessage(["keep-copy"], END)).toBeNull();
  });

  it("drafts a mail with no address filled in", () => {
    expect(mailtoHref("A b", "C")).toBe("mailto:?subject=A%20b&body=C");
  });

  it("keeps the questions general, with no figures", () => {
    for (const question of CONTRACT_QUESTIONS) expect(question.question).not.toMatch(/\d/);
  });
});

describe("hooks for the main build", () => {
  it("picks the latest contract row when two exist", () => {
    const older = contractRow("2026-12-31");
    const newer = contractRow("2027-06-30");
    expect(selectContractEnd([older, newer])?.id).toBe(newer.id);
    expect(selectContractEnd([{ ...newer, isOwn: false }])).toBeNull();
  });

  it("raises a needs-you item from the first reminder, and after the end", () => {
    const row = contractRow(END);
    expect(selectContractEndNeedsYou([row], new Date("2026-10-06T02:00:00Z"))).toEqual([]);
    const due = selectContractEndNeedsYou([row], new Date("2026-10-31T02:00:00Z"));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ dueOn: "2026-10-31", href: "/admin/contract", area: "admin" });
    expect(selectContractEndNeedsYou([row], new Date("2027-02-05T02:00:00Z"))[0]?.title).toMatch(/has passed/);
  });

  it("offers a search record named for the end date", () => {
    expect(contractEndSearchRecords([contractRow(END)])[0]?.title).toBe("Contract ends Sun 31 Jan 2027");
    expect(contractEndSearchRecords([])[0]?.title).toBe("Contract end tracker");
  });

  it("writes a calendar file with an alert only for reminders still ahead", () => {
    const file = contractCalendarFile(contractRow(END), new Date("2026-11-05T02:00:00Z"));
    expect(file).toContain("BEGIN:VEVENT");
    expect(file?.match(/BEGIN:VALARM/g)).toHaveLength(1);
  });
});

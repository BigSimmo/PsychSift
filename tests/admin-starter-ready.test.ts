import { describe, expect, it } from "vitest";

import { BOTH_REMINDERS_ON, CONTRACT_END_SLUG_PREFIX, reminderFields } from "@/lib/admin/contract-end";
import {
  buildReadyForDayOne,
  READY_ITEM_ORDER,
  readyAccessibleLabel,
  readySearchRecords,
  readyStartsLine,
  readyStatusText,
  selectReadyNeedsYou,
} from "@/lib/admin/ready-for-day-one";
import {
  buildStarterDateBody,
  ESCALATION_LADDER,
  LOCAL_WORDS,
  searchLocalWords,
  selectStarterDates,
  selectStarterNeedsYou,
  STARTER_DATE_SLUG_PREFIX,
  STARTER_OFFICES,
  starterPackSearchRecords,
  starterSavedLine,
  starterWordSuggestion,
  validateStarterDate,
  visaContractClash,
} from "@/lib/admin/starter-pack";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

const NOW = new Date("2026-10-06T01:00:00Z");
const TODAY = "2026-10-06";

function contractRow(endsOn = "2027-01-31") {
  const fields = reminderFields(endsOn, BOTH_REMINDERS_ON);
  return complianceFixture(
    "Contract end",
    { category: "Personal", expiresOn: endsOn, leadTimeDays: fields.leadTimeDays },
    { slug: `${CONTRACT_END_SLUG_PREFIX}c1`, tags: fields.tags },
  );
}

const visaRow = (expiresOn: string) =>
  complianceFixture(
    "Visa",
    { requirementId: "img-visa-requirements", expiresOn },
    { slug: `${STARTER_DATE_SLUG_PREFIX}v1` },
  );

describe("starter pack words", () => {
  it("finds a local word from a word from home", () => {
    const [match] = searchLocalWords("bleep");
    expect(match?.word.term).toBe("Pager");
    expect(match?.fromHome).toBe("bleep");
    expect(searchLocalWords("SHO")[0]?.word.term).toBe("RMO");
    expect(searchLocalWords("attending")[0]?.word.term).toBe("Consultant");
  });

  it("puts a match on the word itself ahead of a match in a meaning", () => {
    const results = searchLocalWords("consultant");
    expect(results[0]?.word.term).toBe("Consultant");
  });

  it("lists every word for an empty search", () => {
    expect(searchLocalWords("  ")).toHaveLength(LOCAL_WORDS.length);
  });

  it("offers each word to search, by its words from home too", () => {
    const pager = starterPackSearchRecords().find((record) => record.title.startsWith("Pager:"));
    expect(pager?.keywords).toContain("bleep");
    expect(pager?.href).toContain("/admin/new-job/starter?word=Pager");
  });
});

describe("suggest a word", () => {
  it("builds a note for Medical Education with the word only", () => {
    expect(starterWordSuggestion("  tea trolley ")).toBe(
      'Hi Medical Education,\n\nI heard the word "tea trolley" and did not know it. Could it go in the starter pack for new doctors?\n\nThanks',
    );
  });
});

describe("who to ask", () => {
  it("climbs from you to the head of department, in order", () => {
    expect(ESCALATION_LADDER.map((step) => step.who)).toEqual([
      "You",
      "Your registrar",
      "Your consultant",
      "Consultant on call",
      "Head of department",
    ]);
  });

  it("names offices only, with no phone numbers", () => {
    for (const office of STARTER_OFFICES) expect(`${office.name} ${office.what}`).not.toMatch(/\d/);
  });
});

describe("your dates", () => {
  it("raises a clash only when the visa ends before the contract", () => {
    expect(visaContractClash(selectStarterDates([visaRow("2027-01-14"), contractRow()]))).toEqual({
      visaEnd: "2027-01-14",
      contractEnd: "2027-01-31",
      daysBefore: 17,
    });
    expect(visaContractClash(selectStarterDates([visaRow("2027-03-01"), contractRow()]))).toBeNull();
    expect(visaContractClash(selectStarterDates([visaRow("2027-01-14")]))).toBeNull();
  });

  it("sends the clash to needs-you while the visa date is ahead", () => {
    const items = selectStarterNeedsYou([visaRow("2027-01-14"), contractRow()], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toContain("Talk to Medical Workforce");
    expect(items[0]?.title).not.toMatch(/visa (?:advice|condition)/i);
  });

  it("sorts the pack's dates soonest first, contract end included", () => {
    const rows = selectStarterDates([contractRow(), visaRow("2027-01-14")]);
    expect(rows.map((row) => row.kind)).toEqual(["visa-end", "contract"]);
  });

  it("asks for a name on an Other date and catches a patient detail in it", () => {
    expect(
      validateStarterDate({ kind: "other", name: "", date: "2026-12-01", leadTimeDays: 42 }, TODAY).name,
    ).toBeTruthy();
    expect(
      validateStarterDate({ kind: "other", name: "Mr Smith bed 4", date: "2026-12-01", leadTimeDays: 42 }, TODAY)
        .nameProblem,
    ).toBeTruthy();
    expect(
      validateStarterDate({ kind: "visa-end", name: "", date: "2026-01-01", leadTimeDays: 42 }, TODAY).date,
    ).toMatch(/passed/);
  });

  it("writes a catalogue date as a private row with the chosen reminder", () => {
    const body = buildStarterDateBody({ kind: "visa-end", name: "", date: "2027-01-14", leadTimeDays: 90 }, "abc");
    expect(body?.slug).toMatch(new RegExp(`^${STARTER_DATE_SLUG_PREFIX}img-visa-requirements-abc$`));
    expect(body?.isPersonal).toBe(true);
    expect(body?.details).toMatchObject({ expiresOn: "2027-01-14", leadTimeDays: 90 });
  });

  it("says when the reminder starts", () => {
    expect(starterSavedLine("Visa end", "2027-01-14", 90)).toBe(
      "Visa end saved. Shown on Admin Today from Fri 16 Oct 2026.",
    );
  });
});

describe("ready for day one", () => {
  const startRow = onCallEntryFixture({
    section: "logistics",
    title: "Email account",
    details: { category: "Logins", jobStartsOn: "2026-11-02" },
  });

  it("keeps the fixed order on every starter", () => {
    const ready = buildReadyForDayOne([], NOW);
    expect(ready.items.map((item) => item.id)).toEqual(READY_ITEM_ORDER);
  });

  it("counts recorded, to do and in progress, and says so in words", () => {
    const own = [
      startRow,
      complianceFixture("Registration", { requirementId: "medical-registration-renewal", expiresOn: "2027-09-30" }),
      contractRow(),
    ];
    const ready = buildReadyForDayOne(own, NOW);
    expect(ready.startsOn).toBe("2026-11-02");
    expect(ready.items.find((item) => item.id === "medical-registration-renewal")?.status).toBe("Recorded");
    expect(ready.items.find((item) => item.id === "contract")?.status).toBe("Recorded");
    expect(ready.items.find((item) => item.id === "logins")?.state).toBe("in-progress");
    expect(readyAccessibleLabel(ready)).toBe(`2 of 8 recorded, ${ready.toDo} to do, 1 in progress.`);
    expect(readyStartsLine(ready, NOW)).toBe("Starts Mon 2 Nov 2026, in 3 weeks");
  });

  it("flags a credential that ends before the start date", () => {
    const own = [
      startRow,
      complianceFixture("WWC", { requirementId: "working-with-children-check", expiresOn: "2026-10-30" }),
    ];
    const item = buildReadyForDayOne(own, NOW).items.find((entry) => entry.id === "working-with-children-check");
    expect(item?.status).toBe("Ends before you start");
    expect(item?.state).toBe("to-do");
  });

  it("copies status words only, never a credential date", () => {
    const own = [
      startRow,
      complianceFixture("Registration", { requirementId: "medical-registration-renewal", expiresOn: "2027-09-30" }),
    ];
    const text = readyStatusText(buildReadyForDayOne(own, NOW), NOW);
    expect(text).toContain("Medical registration: Recorded");
    expect(text).toContain("Not checked with issuers");
    expect(text).not.toContain("2027");
    expect(text).not.toContain("30 Sep");
  });

  it("raises needs-you only within four weeks of the start", () => {
    const later = onCallEntryFixture({
      section: "logistics",
      title: "Email account",
      details: { category: "Logins", jobStartsOn: "2026-12-07" },
    });
    expect(selectReadyNeedsYou([later], NOW)).toEqual([]);
    const close = selectReadyNeedsYou([later], new Date("2026-11-20T01:00:00Z"));
    expect(close[0]?.href).toBe("/admin/new-job/ready");
    expect(readySearchRecords()[0]?.href).toBe("/admin/new-job/ready");
  });
});

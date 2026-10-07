import { describe, expect, it } from "vitest";

import { buildComplianceOverview } from "@/lib/admin/compliance-overview";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { documentFromDraft, documentState, validateDocumentDraft } from "@/lib/work-screens/admin/documents";
import {
  emptyPaperwork,
  isValidPaperwork,
  parsePaperwork,
  type AdminPaperwork,
} from "@/lib/work-screens/admin/paperwork-model";
import { parseHours, payrollMessage, payslipFromDraft, payslipResult, payWindows } from "@/lib/work-screens/admin/pay";
import {
  buildRequestMessage,
  markSent,
  needsChase,
  newRequest,
  recipientForReason,
  recordAnswer,
  reopen,
  sortRequests,
  validateRequestDraft,
  type RequestDraftInput,
} from "@/lib/work-screens/admin/requests";
import { buildSharePack, MAILTO_BODY_LIMIT, shareGroupViews, shareMailtoHref } from "@/lib/work-screens/admin/sharing";
import { documentsListText } from "@/lib/work-screens/admin/documents";
import {
  documentsSample,
  isExampleRecord,
  paySample,
  requestsSample,
  sharingSample,
  taxSample,
  withoutExampleRecords,
  WORKFORCE_SAMPLE_CONTRACT_ENDS,
  WORKFORCE_SAMPLE_DOCTORS,
  WORKFORCE_SAMPLE_EXTENSIONS,
  WORKFORCE_SAMPLE_STARTERS,
} from "@/lib/work-screens/admin/sample";
import { ATO_LINKS, financialYearKey, parseDollars, taxPackCsv } from "@/lib/work-screens/admin/tax";
import { decideExtension, filterDoctors, WORKFORCE_SAMPLE_LABEL } from "@/lib/work-screens/admin/workforce-sample";

const NOW = new Date("2026-10-07T01:00:00Z");

function draft(overrides: Partial<RequestDraftInput> = {}): RequestDraftInput {
  return {
    kind: "more-time",
    title: "Basic life support",
    to: "Medical Workforce",
    dueOn: "2026-09-23",
    askedFor: "2026-10-30",
    reason: "Course full",
    note: "",
    ...overrides,
  };
}

describe("Admin paperwork record", () => {
  it("reads anything unreadable as an empty record, never throwing", () => {
    expect(parsePaperwork(null)).toEqual(emptyPaperwork());
    expect(parsePaperwork("{not json")).toEqual(emptyPaperwork());
    expect(parsePaperwork(JSON.stringify({ version: 99 }))).toEqual(emptyPaperwork());
  });

  it("refuses a record with an unknown field, so nothing unplanned is stored", () => {
    const bad = { ...emptyPaperwork(), patientName: "x" } as unknown as AdminPaperwork;
    expect(isValidPaperwork(bad)).toBe(false);
  });
});

describe("Requests", () => {
  it("asks for a new date after the due date when asking for more time", () => {
    expect(validateRequestDraft(draft({ askedFor: "" })).askedFor).toBeTruthy();
    expect(validateRequestDraft(draft({ askedFor: "2026-09-01" })).askedFor).toBe("Pick a date after it is due.");
    expect(validateRequestDraft(draft())).toEqual({});
  });

  it("writes only what the doctor chose, and a health reason as a word", () => {
    const message = buildRequestMessage(draft({ reason: "Health reason", note: "" }));
    expect(message).toContain("23 Sep 2026 to 30 Oct 2026");
    expect(message).toContain("Reason: Health reason.");
    expect(recipientForReason("Health reason", "Medical Workforce")).toBe("Staff Health");
    expect(recipientForReason("Course full", "Medical Workforce")).toBe("Medical Workforce");
  });

  it("moves from draft to sent with a chase date a week on, and flags it when that passes", () => {
    const request = newRequest(draft(), "req-1", "2026-10-01");
    expect(request.status).toBe("draft");
    const sent = markSent(request, "2026-10-01");
    expect(sent.status).toBe("sent");
    expect(sent.followUpOn).toBe("2026-10-08");
    expect(needsChase(sent, "2026-10-07")).toBe(false);
    expect(needsChase(sent, "2026-10-08")).toBe(true);
    const answered = recordAnswer(sent, "agreed", "", "2026-10-09");
    expect(needsChase(answered, "2026-12-01")).toBe(false);
    expect(reopen(answered).status).toBe("sent");
  });

  it("lists open requests soonest first and keeps answered ones apart", () => {
    const a = markSent(
      newRequest(draft({ title: "A", dueOn: "2026-10-20", askedFor: "2026-11-01" }), "req-a", "2026-10-01"),
      "2026-10-01",
    );
    const b = markSent(
      newRequest(draft({ title: "B", dueOn: "2026-10-10", askedFor: "2026-11-01" }), "req-b", "2026-10-01"),
      "2026-10-01",
    );
    const c = recordAnswer(a, "declined", "", "2026-10-05");
    const { open, done } = sortRequests([a, b, { ...c, id: "req-c" }]);
    expect(open.map((request) => request.title)).toEqual(["B", "A"]);
    expect(done).toHaveLength(1);
  });
});

describe("Sharing", () => {
  const overview = buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, [], NOW, null);

  it("offers no pack while every switch is off", () => {
    const views = shareGroupViews(overview, emptyPaperwork().sharing);
    expect(views.every((view) => !view.on)).toBe(true);
    expect(buildSharePack({ views, audience: "workforce", recipient: "Medical Workforce", now: NOW })).toBeNull();
  });

  it("never puts health items in the Medical Workforce pack", () => {
    const views = shareGroupViews(overview, {
      groups: { registration: true, health: true },
      recipient: "Medical Workforce",
      log: [],
    });
    const workforce = buildSharePack({ views, audience: "workforce", recipient: "Medical Workforce", now: NOW })!;
    const health = buildSharePack({ views, audience: "staff-health", recipient: "Medical Workforce", now: NOW })!;
    expect(workforce.groups).toEqual(["registration"]);
    expect(workforce.text).not.toMatch(/Immunisation requirements/);
    expect(workforce.text).toContain("Not checked with issuers");
    expect(health.to).toBe("Staff Health");
    expect(health.text).toMatch(/Immunisation requirements/);
  });

  it("keeps an email draft short enough for a mail app", () => {
    const views = shareGroupViews(overview, {
      groups: { registration: true, checks: true, training: true, job: true },
      recipient: "MW",
      log: [],
    });
    const pack = buildSharePack({ views, audience: "workforce", recipient: "MW", now: NOW })!;
    const href = shareMailtoHref(pack, "not an email");
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(href.split("body=")[1]!).length).toBeLessThanOrEqual(MAILTO_BODY_LIMIT + 60);
  });
});

describe("Pay", () => {
  it("reads hours typed as decimals or as hours and minutes", () => {
    expect(parseHours("76")).toBe(76);
    expect(parseHours("76,5")).toBe(76.5);
    expect(parseHours("7:30")).toBe(7.5);
    expect(parseHours("abc")).toBeNull();
    expect(parseHours("")).toBeNull();
  });

  it("says the hours match within rounding, and says by how much they differ", () => {
    expect(payslipResult({ payslipOrdinaryHours: 80, rosteredHours: 80.01, loggedExtraHours: 0 }).matches).toBe(true);
    const off = payslipResult({
      payslipOrdinaryHours: 72,
      rosteredHours: 80,
      payslipExtraHours: 0,
      loggedExtraHours: 2,
    });
    expect(off.matches).toBe(false);
    expect(off.ordinary).toEqual({ compare: "fewer", difference: 8 });
    expect(off.extra).toEqual({ compare: "fewer", difference: 2 });
  });

  it("writes a payroll message in hours only, with no pay figure", () => {
    const [current] = payWindows("2026-10-07", null);
    const check = payslipFromDraft(
      { windowIndex: 0, paidOn: "", ordinary: "72", extra: "", rostered: "80", logged: "2", note: "" },
      current,
      "pay-1",
      "2026-10-07",
    );
    const message = payrollMessage(check);
    expect(message).toContain("72 h ordinary hours");
    expect(message).not.toMatch(/\$|rate|award/i);
  });
});

describe("Tax", () => {
  it("files 30 June and 1 July in different financial years", () => {
    expect(financialYearKey("2027-06-30")).toBe("2026");
    expect(financialYearKey("2026-07-01")).toBe("2026");
    expect(financialYearKey("2026-06-30")).toBe("2025");
  });

  it("reads dollars as typed into whole cents", () => {
    expect(parseDollars("146")).toBe(14600);
    expect(parseDollars("$1,034.5")).toBe(103450);
    expect(parseDollars("12.345")).toBeNull();
  });

  it("makes a pack whose cells cannot run as spreadsheet formulas", () => {
    const csv = taxPackCsv(
      {
        ticks: {},
        expenses: [
          { id: "tax-1", on: "2026-08-01", kind: "books", title: "=HYPERLINK(1)", cents: 1000, receiptKept: false },
        ],
      },
      "2026",
    );
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("Not tax advice");
  });
});

describe("Documents", () => {
  it("reads an end date into a plain state", () => {
    expect(documentState({ expiresOn: "2026-10-01" }, "2026-10-07")).toBe("date-passed");
    expect(documentState({ expiresOn: "2026-11-01" }, "2026-10-07")).toBe("ends-soon");
    expect(documentState({}, "2026-10-07")).toBe("no-end-date");
  });

  it("takes http and https links only", () => {
    const base = { title: "Contract", folder: "contracts" as const, issuedOn: "", expiresOn: "", keptAt: "", note: "" };
    expect(validateDocumentDraft({ ...base, url: "javascript:alert(1)" }).url).toBeTruthy();
    expect(validateDocumentDraft({ ...base, url: "https://example.org/file" }).url).toBeUndefined();
    const saved = documentFromDraft({ ...base, url: "" }, "doc-1", "2026-10-07");
    expect("url" in saved).toBe(false);
  });
});

describe("Workforce sample", () => {
  it("is labelled a sample and offers no export", async () => {
    expect(WORKFORCE_SAMPLE_LABEL).toBe("Sample, not your hospital's data");
    const helpers = await import("@/lib/work-screens/admin/workforce-sample");
    expect(Object.keys(helpers).some((name) => /csv|export/i.test(name))).toBe(false);
  });

  it("filters and decides in memory only", () => {
    expect(
      filterDoctors(WORKFORCE_SAMPLE_DOCTORS, "extension", "").every((doctor) =>
        doctor.items.some((item) => item.status === "extension"),
      ),
    ).toBe(true);
    expect(filterDoctors(WORKFORCE_SAMPLE_DOCTORS, "all", "clinic b").map((doctor) => doctor.id)).toEqual([
      "example:doctor-eli",
    ]);
    const decided = decideExtension(WORKFORCE_SAMPLE_EXTENSIONS, "example:ext-ben", "granted", "2026-10-30");
    expect(decided.find((entry) => entry.id === "example:ext-ben")?.decision).toBe("granted");
    expect(WORKFORCE_SAMPLE_EXTENSIONS.find((entry) => entry.id === "example:ext-ben")?.decision).toBe("waiting");
  });
});

describe("Example records", () => {
  const paperwork = [requestsSample(), sharingSample(), documentsSample(), paySample(), taxSample()];
  const ids = [
    ...paperwork.flatMap((record) => [
      ...record.requests,
      ...record.sharing.log,
      ...record.documents,
      ...record.payslips,
      ...Object.values(record.tax).flatMap((year) => year.expenses),
    ]),
    ...WORKFORCE_SAMPLE_DOCTORS,
    ...WORKFORCE_SAMPLE_EXTENSIONS,
    ...WORKFORCE_SAMPLE_STARTERS,
    ...WORKFORCE_SAMPLE_CONTRACT_ENDS,
  ].map((record) => record.id);

  it("all start with example: and each sample reads back as valid", () => {
    expect(ids.length).toBeGreaterThan(20);
    expect(ids.every((value) => value.startsWith("example:"))).toBe(true);
    expect(paperwork.every(isValidPaperwork)).toBe(true);
  });

  it("uses invented names only", () => {
    const names = [...WORKFORCE_SAMPLE_DOCTORS, ...WORKFORCE_SAMPLE_STARTERS].map((doctor) => doctor.name);
    expect(names.every((name) => /Example|Sample|Placeholder|Testcase|Demo|Mock/.test(name))).toBe(true);
  });

  it("are dropped from every file and copied list", () => {
    const own = { id: "doc-own", title: "Own", folder: "contracts" as const, addedOn: "2026-10-07" };
    expect(withoutExampleRecords([...documentsSample().documents, own]).map((doc) => doc.id)).toEqual(["doc-own"]);
    expect(isExampleRecord({ id: "example:x" })).toBe(true);
    expect(documentsListText(documentsSample().documents, "2026-10-07")).not.toMatch(/Employment contract/);
    const csv = taxPackCsv(taxSample().tax["2026"]!, "2026");
    expect(csv).not.toMatch(/Textbook|Medical registration/);
    expect(csv).toContain("0 items");
  });
});

describe("Official links", () => {
  it("points at the top-level ATO page only", () => {
    expect(ATO_LINKS.map((link) => link.href)).toEqual(["https://www.ato.gov.au/"]);
  });
});

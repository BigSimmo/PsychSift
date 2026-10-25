import { describe, expect, it, vi } from "vitest";

import { cpdApplicationsSchema } from "@/lib/cme/applications";
import { examPrepSchema, termTrackerSchema } from "@/lib/teaching/term-tracker";
import { emptyPaperwork, type AdminPaperwork } from "@/lib/work-screens/admin/paperwork-model";
import { firstPaperworkPatientProblem } from "@/lib/work-screens/admin/patient-check";
import { writeWorkSyncSection } from "@/lib/work-sync/account-work-sync";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";

function createMockAdminClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ upsert }));
  return {
    client: { from } as unknown as Parameters<typeof writeWorkSyncSection>[0],
    upsert,
    from,
  };
}

describe("R11: Admin paperwork server-side patient-detail validation", () => {
  it("accepts clean AdminPaperwork records and rejects patient details across requests, sharing, documents, payslips, and expenses", () => {
    const clean: AdminPaperwork = {
      ...emptyPaperwork(),
      requests: [
        {
          id: "req-1",
          kind: "leave",
          title: "Annual leave request",
          to: "Medical Workforce",
          message: "Requesting two weeks of annual leave in November.",
          status: "sent",
          createdOn: "2026-10-01",
        },
      ],
      documents: [
        {
          id: "doc-1",
          title: "AHPRA Registration Certificate",
          folder: "registration",
          keptAt: "OneDrive Work Folder",
          addedOn: "2026-10-01",
        },
      ],
    };

    expect(firstPaperworkPatientProblem(clean, 2026)).toBeNull();

    const withPatientInRequest: AdminPaperwork = {
      ...emptyPaperwork(),
      requests: [
        {
          id: "req-phi",
          kind: "other",
          title: "Discharge summary follow-up",
          to: "Medical Workforce",
          message: "Patient MRN 12345678 needs review",
          status: "draft",
          createdOn: "2026-10-01",
        },
      ],
    };
    expect(firstPaperworkPatientProblem(withPatientInRequest, 2026)).toBeTruthy();

    const withPatientInDocument: AdminPaperwork = {
      ...emptyPaperwork(),
      documents: [
        {
          id: "doc-phi",
          title: "Case note",
          folder: "other",
          note: "Patient DOB 14/03/1984",
          addedOn: "2026-10-01",
        },
      ],
    };
    expect(firstPaperworkPatientProblem(withPatientInDocument, 2026)).toBeTruthy();

    const withPatientInPayslip: AdminPaperwork = {
      ...emptyPaperwork(),
      payslips: [
        {
          id: "pay-phi",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-14",
          payslipOrdinaryHours: 76,
          rosteredHours: 76,
          loggedExtraHours: 2,
          note: "Overtime recall for UMI 8765432",
          checkedOn: "2026-09-15",
        },
      ],
    };
    expect(firstPaperworkPatientProblem(withPatientInPayslip, 2026)).toBeTruthy();

    const withPatientInExpense: AdminPaperwork = {
      ...emptyPaperwork(),
      tax: {
        "2026": {
          ticks: {},
          expenses: [
            {
              id: "exp-phi",
              on: "2026-10-02",
              kind: "other",
              title: "Parking for patient MRN 12345678",
              cents: 1500,
              receiptKept: true,
            },
          ],
        },
      },
    };
    expect(firstPaperworkPatientProblem(withPatientInExpense, 2026)).toBeTruthy();
  });

  it("refuses writeWorkSyncSection('adminPaperwork') with 422 patient_detail before touching the database", async () => {
    const { client, upsert } = createMockAdminClient();
    const flagged: AdminPaperwork = {
      ...emptyPaperwork(),
      requests: [
        {
          id: "req-1",
          kind: "question",
          title: "Roster query",
          to: "Medical Workforce",
          message: "Covered call for Patient MRN 12345678",
          status: "draft",
          createdOn: "2026-10-01",
        },
      ],
    };

    await expect(writeWorkSyncSection(client, OWNER_ID, "adminPaperwork", flagged)).rejects.toMatchObject({
      status: 422,
      details: { code: "patient_detail" },
    });
    expect(upsert).not.toHaveBeenCalled();

    const clean = emptyPaperwork();
    const saved = await writeWorkSyncSection(client, OWNER_ID, "adminPaperwork", clean);
    expect(saved.value).toEqual(clean);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("reads this year in the work time zone, so early on 1 January in Perth a two-digit new year is not a birth date", async () => {
    vi.useFakeTimers();
    try {
      // 01:00 on 1 January 2027 in Perth, still 31 December 2026 in UTC.
      vi.setSystemTime(new Date("2026-12-31T17:00:00.000Z"));
      const { client, upsert } = createMockAdminClient();
      const paperwork: AdminPaperwork = {
        ...emptyPaperwork(),
        requests: [
          {
            id: "req-1",
            kind: "leave",
            title: "Annual leave request",
            to: "Medical Workforce",
            message: "Requesting leave from 4 Jan 27 to 15 Jan 27.",
            status: "draft",
            createdOn: "2027-01-01",
          },
        ],
      };
      expect(firstPaperworkPatientProblem(paperwork, 2026)).toBeTruthy();
      expect(firstPaperworkPatientProblem(paperwork, 2027)).toBeNull();
      const saved = await writeWorkSyncSection(client, OWNER_ID, "adminPaperwork", paperwork);
      expect(saved.value).toEqual(paperwork);
      expect(upsert).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("R12: Teaching and CPD backup schemas reject unknown nested properties", () => {
  it("rejects unknown nested properties in termTrackerSchema, examPrepSchema, and cpdApplicationsSchema", () => {
    const validTermTracker = {
      version: 1 as const,
      currentTermId: "t1",
      terms: [
        {
          id: "t1",
          number: 1,
          unit: "Adult Inpatient",
          site: "SCGH",
          startsOn: "2026-02-02",
          endsOn: "2026-08-02",
          supervisor: "Dr Example",
          milestones: {
            start: { dueOn: "2026-02-16", doneOn: "2026-02-15" },
            mid: { dueOn: "2026-05-01", doneOn: null },
            end: { dueOn: "2026-07-25", doneOn: null },
          },
          goals: [{ id: "g1", text: "Complete two EPAs", done: false }],
          toRaise: [{ id: "r1", text: "Discuss night cover" }],
          meeting: { on: "2026-05-01", time: "14:00", place: "Clinic room 2" },
        },
      ],
      epas: [{ id: "e1", termId: "t1", epa: 1 as const, on: "2026-03-10" }],
      targets: { perTerm: 2, perYear: 10 },
    };
    expect(termTrackerSchema.safeParse(validTermTracker).success).toBe(true);
    expect(
      termTrackerSchema.safeParse({
        ...validTermTracker,
        terms: [{ ...validTermTracker.terms[0]!, unvalidatedPatientNote: "MRN 12345678" }],
      }).success,
    ).toBe(false);
    expect(
      termTrackerSchema.safeParse({
        ...validTermTracker,
        terms: [
          {
            ...validTermTracker.terms[0]!,
            goals: [{ id: "g1", text: "Complete two EPAs", done: false, secretPhi: "DOB 01/01/1980" }],
          },
        ],
      }).success,
    ).toBe(false);

    const validExamPrep = {
      version: 1 as const,
      exam: { name: "Written Exam", on: "2026-11-15", planStartsOn: "2026-08-01" },
      study: { "2026-10-01": 120 },
      topics: [{ id: "top1", name: "Psychopharmacology", percent: 45 }],
      group: { title: "Study group", on: "2026-10-14", time: "17:00", place: "Library" },
    };
    expect(examPrepSchema.safeParse(validExamPrep).success).toBe(true);
    expect(
      examPrepSchema.safeParse({
        ...validExamPrep,
        topics: [{ id: "top1", name: "Psychopharmacology", percent: 45, extraNestedPhi: "leak" }],
      }).success,
    ).toBe(false);

    const validCpdApplications = {
      version: 1,
      dates: [
        {
          stage: "close" as const,
          on: "2026-07-01",
          time: "17:00",
          source: "Jobs WA",
          remind: true,
          addedOn: "2026-06-15",
        },
      ],
      referees: [
        {
          id: "r1",
          name: "Dr Example",
          role: "Consultant, SCGH",
          status: "agreed" as const,
          history: [{ kind: "status" as const, status: "agreed" as const, on: "2026-06-15" }],
        },
      ],
      statement: "Applying for psychiatry registrar position.",
      hiddenCvLines: [],
    };
    expect(cpdApplicationsSchema.safeParse(validCpdApplications).success).toBe(true);
    expect(
      cpdApplicationsSchema.safeParse({
        ...validCpdApplications,
        referees: [
          {
            ...validCpdApplications.referees[0]!,
            extraPhiField: "Patient NHI ABC1234",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("refuses writeWorkSyncSection with 400 invalid_work_backup when backup sections contain unknown nested properties", async () => {
    const { client, upsert } = createMockAdminClient();

    await expect(
      writeWorkSyncSection(client, OWNER_ID, "teachingTermTracker", {
        version: 1,
        currentTermId: "t1",
        terms: [
          {
            id: "t1",
            number: 1,
            unit: "Adult Inpatient",
            site: "SCGH",
            startsOn: "2026-02-02",
            endsOn: "2026-08-02",
            supervisor: "Dr Example",
            milestones: {
              start: { dueOn: "2026-02-16", doneOn: null },
              mid: { dueOn: "2026-05-01", doneOn: null },
              end: { dueOn: "2026-07-25", doneOn: null },
            },
            goals: [],
            toRaise: [],
            meeting: null,
            unknownNestedField: "bypass",
          },
        ],
        epas: [],
        targets: null,
      }),
    ).rejects.toMatchObject({
      status: 400,
      details: { code: "invalid_work_backup" },
    });

    await expect(
      writeWorkSyncSection(client, OWNER_ID, "cpdApplications", {
        version: 1,
        dates: [
          {
            stage: "close",
            on: "2026-07-01",
            time: "",
            source: "Jobs WA",
            remind: true,
            addedOn: "2026-06-15",
            unexpectedNested: "value",
          },
        ],
        referees: [],
        statement: "",
        hiddenCvLines: [],
      }),
    ).rejects.toMatchObject({
      status: 400,
      details: { code: "invalid_work_backup" },
    });

    expect(upsert).not.toHaveBeenCalled();
  });
});

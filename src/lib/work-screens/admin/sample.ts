import { emptyPaperwork, type AdminPaperwork } from "@/lib/work-screens/admin/paperwork-model";
import type {
  WorkforceDoctor,
  WorkforceDoctorItem,
  WorkforceExtension,
  WorkforceStatus,
} from "@/lib/work-screens/admin/workforce-sample";

/**
 * Every sample record the Admin work screens show, in one file (wiring brief,
 * 03:45 UTC "example data rule"), so the lead can move them to the shared
 * example-data registry in one go. Every id starts "example:". People and
 * places are obviously invented: no real WA staff, hospital or ward.
 *
 * The samples are shown signed out and in the local demo build, and on the
 * Workforce page, always labelled. Nothing here is ever saved, exported,
 * copied or shared: `withoutExampleRecords` drops them from every list a pack,
 * file or copied text is built from.
 */

export const EXAMPLE_ID_PREFIX = "example:";

export function isExampleRecord(record: { readonly id: string }): boolean {
  return record.id.startsWith(EXAMPLE_ID_PREFIX);
}

/** Drops sample records before anything leaves the page. Swapped for the shared helper later. */
export function withoutExampleRecords<T extends { readonly id: string }>(records: readonly T[]): T[] {
  return records.filter((record) => !isExampleRecord(record));
}

/* ------------------------------------------------- the doctor's own pages */

export function requestsSample(): AdminPaperwork {
  return {
    ...emptyPaperwork(),
    requests: [
      {
        id: "example:req-1",
        kind: "more-time",
        title: "Basic life support",
        to: "Medical Workforce",
        message:
          "Could I please have more time for Basic life support, 23 Sep 2026 to 30 Oct 2026?\nReason: Course full.\nThank you.",
        dueOn: "2026-09-23",
        askedFor: "2026-10-30",
        status: "seen",
        createdOn: "2026-10-02",
        sentOn: "2026-10-02",
        seenOn: "2026-10-06",
        followUpOn: "2026-10-09",
      },
      {
        id: "example:req-2",
        kind: "document",
        title: "Indemnity certificate",
        to: "Medical Workforce",
        message: "Please find my Indemnity certificate, due 16 Oct 2026.\nThank you.",
        dueOn: "2026-10-16",
        status: "draft",
        createdOn: "2026-10-05",
      },
      {
        id: "example:req-3",
        kind: "leave",
        title: "Professional development leave, 9 to 13 Nov",
        to: "Medical Workforce",
        message: "I would like to ask about leave: Professional development leave, 9 to 13 Nov.\nThank you.",
        status: "decided",
        outcome: "agreed",
        createdOn: "2026-09-14",
        sentOn: "2026-09-14",
        decidedOn: "2026-09-21",
      },
    ],
  };
}

export function sharingSample(): AdminPaperwork {
  return {
    ...emptyPaperwork(),
    sharing: {
      groups: { registration: true, checks: true },
      recipient: "Medical Workforce",
      log: [
        {
          id: "example:share-1",
          on: "2026-10-02",
          to: "Medical Workforce",
          method: "email",
          groups: ["registration"],
          itemCount: 4,
        },
      ],
    },
  };
}

export function documentsSample(): AdminPaperwork {
  return {
    ...emptyPaperwork(),
    documents: [
      {
        id: "example:doc-1",
        title: "Employment contract",
        folder: "contracts",
        issuedOn: "2026-01-12",
        expiresOn: "2027-02-01",
        keptAt: "Email from Medical Workforce",
        addedOn: "2026-01-12",
      },
      {
        id: "example:doc-2",
        title: "Registration certificate",
        folder: "registration",
        issuedOn: "2026-09-30",
        expiresOn: "2027-09-30",
        keptAt: "Ahpra portal",
        addedOn: "2026-09-30",
      },
      {
        id: "example:doc-3",
        title: "Working with Children card",
        folder: "certificates",
        expiresOn: "2026-11-14",
        keptAt: "Wallet and phone photos",
        addedOn: "2026-01-10",
      },
      {
        id: "example:doc-4",
        title: "Basic life support certificate",
        folder: "training",
        issuedOn: "2025-09-23",
        keptAt: "MyLearning",
        addedOn: "2025-09-23",
      },
    ],
  };
}

export function paySample(): AdminPaperwork {
  return {
    ...emptyPaperwork(),
    payslips: [
      {
        id: "example:pay-1",
        periodStart: "2026-09-14",
        periodEnd: "2026-09-27",
        paidOn: "2026-10-01",
        payslipOrdinaryHours: 80,
        payslipExtraHours: 1.5,
        rosteredHours: 80,
        loggedExtraHours: 1.5,
        checkedOn: "2026-10-01",
      },
      {
        id: "example:pay-2",
        periodStart: "2026-08-31",
        periodEnd: "2026-09-13",
        paidOn: "2026-09-17",
        payslipOrdinaryHours: 72,
        rosteredHours: 80,
        loggedExtraHours: 0,
        checkedOn: "2026-09-17",
        resolved: true,
        note: "Payroll fixed it on the next pay",
      },
    ],
  };
}

export function taxSample(): AdminPaperwork {
  return {
    ...emptyPaperwork(),
    tax: {
      "2026": {
        ticks: { "income-statement": true, receipts: true },
        expenses: [
          {
            id: "example:tax-1",
            on: "2026-09-30",
            kind: "registration",
            title: "Medical registration",
            cents: 10000,
            receiptKept: true,
          },
          {
            id: "example:tax-2",
            on: "2026-10-02",
            kind: "courses",
            title: "College course fee",
            cents: 5000,
            receiptKept: true,
          },
          { id: "example:tax-3", on: "2026-08-12", kind: "books", title: "Textbook", cents: 2500, receiptKept: false },
        ],
      },
    },
  };
}

/* ------------------------------------------- Workforce, the hospital side */

function item(
  title: string,
  status: WorkforceStatus,
  date: string | null,
  source: WorkforceDoctorItem["source"] = "Shared by the doctor",
): WorkforceDoctorItem {
  return { title, status, date, source };
}

export const WORKFORCE_SAMPLE_DOCTORS: readonly WorkforceDoctor[] = [
  {
    id: "example:doctor-ada",
    initials: "AE",
    name: "Dr Ada Example",
    role: "Consultant",
    team: "Community team",
    cleared: true,
    total: 16,
    items: [
      item("Manual handling", "date-passed", "2026-09-30", "From MyLearning"),
      item("Basic life support", "date-passed", "2026-09-28"),
      item("Medical registration", "recorded", "2027-09-30"),
    ],
  },
  {
    id: "example:doctor-ben",
    initials: "BS",
    name: "Dr Ben Sample",
    role: "Consultant",
    team: "Ward A",
    cleared: true,
    total: 16,
    items: [
      item("Basic life support", "extension", "2026-09-23"),
      item("Respirator fit test", "start-renewing", "2026-10-14"),
      item("Manual handling", "start-renewing", "2026-10-18", "From MyLearning"),
      item("Family and domestic violence", "requested", "2026-10-31"),
      item("Working with Children Check", "start-renewing", "2026-11-14"),
    ],
  },
  {
    id: "example:doctor-cleo",
    initials: "CP",
    name: "Dr Cleo Placeholder",
    role: "Registrar",
    team: "Ward A",
    cleared: false,
    total: 16,
    items: [
      item("Respirator fit test", "extension", "2026-10-09"),
      item("Working with Children Check", "not-shared", null, "Not shared"),
    ],
  },
  {
    id: "example:doctor-dev",
    initials: "DT",
    name: "Dr Dev Testcase",
    role: "Registrar",
    team: "Ward A",
    cleared: true,
    total: 16,
    items: [item("Fire and evacuation", "date-passed", "2026-10-01", "From MyLearning")],
  },
  {
    id: "example:doctor-eli",
    initials: "ED",
    name: "Dr Eli Demo",
    role: "Registrar",
    team: "Clinic B",
    cleared: true,
    total: 16,
    items: [item("Hand hygiene", "start-renewing", "2026-11-25", "From MyLearning")],
  },
  {
    id: "example:doctor-fay",
    initials: "FM",
    name: "Dr Fay Mock",
    role: "Consultant",
    team: "Older adult team",
    cleared: true,
    total: 16,
    items: [],
  },
];

export const WORKFORCE_SAMPLE_EXTENSIONS: readonly WorkforceExtension[] = [
  {
    id: "example:ext-ben",
    doctorId: "example:doctor-ben",
    item: "Basic life support",
    dueOn: "2026-09-23",
    askedFor: "2026-10-30",
    reason: "Next course date",
    decision: "waiting",
  },
  {
    id: "example:ext-ada",
    doctorId: "example:doctor-ada",
    item: "Manual handling",
    dueOn: "2026-09-30",
    askedFor: "2026-10-23",
    reason: "Course full",
    decision: "waiting",
  },
  {
    id: "example:ext-cleo",
    doctorId: "example:doctor-cleo",
    item: "Respirator fit test",
    dueOn: "2026-10-09",
    askedFor: "2026-10-23",
    reason: "On nights until 18 Oct",
    decision: "waiting",
  },
];

export const WORKFORCE_SAMPLE_STARTERS = [
  {
    id: "example:starter-gus",
    name: "Dr Gus Sample",
    role: "Registrar",
    team: "Ward A",
    startsOn: "2026-11-02",
    ready: 11,
    total: 16,
  },
  {
    id: "example:starter-hana",
    name: "Dr Hana Example",
    role: "Resident",
    team: "Clinic B",
    startsOn: "2026-11-02",
    ready: 6,
    total: 16,
  },
] as const;

export const WORKFORCE_SAMPLE_CONTRACT_ENDS = [
  { id: "example:end-cleo", name: "Dr Cleo Placeholder", team: "Ward A", endsOn: "2027-02-01" },
  { id: "example:end-eli", name: "Dr Eli Demo", team: "Clinic B", endsOn: "2027-02-01" },
] as const;

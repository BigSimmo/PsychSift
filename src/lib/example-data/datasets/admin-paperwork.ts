import { emptyPaperwork, type AdminPaperwork } from "@/lib/work-screens/admin/paperwork-model";

/*
 * Example records for Admin's own-paperwork screens (Requests, Sharing, Documents, Pay, Tax). They
 * show only while Admin's example data is on (or in the local demo build), are kept in page memory,
 * and are never saved, copied, exported or shared: every id starts "example:", and the paperwork
 * store strips such records before it writes. Read through the registry,
 * `loadExampleDataset("admin.requests")` and its siblings. No people's names: the only recipient is a
 * role, Medical Workforce.
 */

export function exampleRequests(): AdminPaperwork {
  return {
    ...emptyPaperwork(),
    requests: [
      {
        id: "example:req-1",
        kind: "more-time",
        title: "Basic life support",
        to: "Medical Workforce",
        message:
          "Could I please have more time for Basic life support, 23 Sep to 30 Oct?\nReason: Course full.\nThank you.",
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
        message: "Please find my Indemnity certificate, due 16 Oct.\nThank you.",
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

export function exampleSharing(): AdminPaperwork {
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

export function exampleDocuments(): AdminPaperwork {
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

export function examplePayslips(): AdminPaperwork {
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

export function exampleTax(): AdminPaperwork {
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

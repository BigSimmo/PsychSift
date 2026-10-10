import { ArrowLeft } from "lucide-react";

import { ContextualBackLink } from "@/components/contextual-back-link";
import { PrintedLine } from "@/components/first-nations/printed-line";
import { BrowserPrintButton, PrintOutput } from "@/components/ui/print-output";
import { WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";
import { loadModelInputs } from "@/lib/first-nations/content";
import { hospitalViews, type HospitalView } from "@/lib/first-nations/view-model";

const CRISIS = [
  { id: "SYN-CRISIS-CONTACT-007", label: "13YARN" },
  { id: "SYN-CRISIS-CONTACT-001", label: "Emergency" },
] as const;

type Row = { key: string; label: string; number: string; checkedAt: string };

function cardRows(hospitals: readonly HospitalView[]): Row[] {
  return [
    // Empty while the service layer is off, so no service name or number is printed.
    ...hospitals.flatMap((h) => [
      {
        key: `${h.id}-liaison`,
        label: `${h.name}: Aboriginal liaison`,
        number: h.liaison.number,
        checkedAt: h.liaison.checkedAt,
      },
      {
        key: `${h.id}-switchboard`,
        label: `${h.name}: after hours, switchboard`,
        number: h.switchboard.number,
        checkedAt: h.switchboard.checkedAt,
      },
    ]),
    ...CRISIS.flatMap(({ id, label }) => {
      const c = WA_CRISIS_CONTACTS.find((x) => x.id === id);
      return c ? [{ key: id, label, number: c.telephoneDisplay, checkedAt: c.verifiedOn }] : [];
    }),
  ];
}

/** `printedOn` is fixed in tests; on the page the phone's own clock stamps the day it is printed. */
export function PocketCardView({ hospitals, printedOn }: { hospitals: readonly HospitalView[]; printedOn?: string }) {
  const rows = cardRows(hospitals);
  const checkedAt = rows.map((r) => r.checkedAt).sort()[0];
  return (
    <div className="mx-auto grid w-full max-w-[40rem] content-start gap-3 px-3 pb-6 pt-3">
      <p className="px-1 text-sm-minus text-[color:var(--text-muted)] print:hidden">
        The numbers to keep on you. Confirm against this page before relying on a printed copy.
      </p>
      <div className="flex items-center justify-between gap-3 px-1 print:hidden">
        <ContextualBackLink
          fallbackHref="/first-nations"
          className="inline-flex min-h-tap items-center gap-1.5 text-sm-minus font-medium text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
        >
          <ArrowLeft className="size-icon-sm" aria-hidden="true" />
          <span>Back to First Nations</span>
        </ContextualBackLink>
        <BrowserPrintButton label="Print card" />
      </div>
      <PrintOutput
        monochrome
        provenance="PsychSift First Nations pocket card. Paper cannot show its own age; confirm against the live app."
      >
        <article className="mx-auto grid w-[86mm] max-w-full gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 print:shadow-none">
          <header className="flex items-baseline justify-between gap-2 border-b border-[color:var(--border)] pb-1.5">
            <h1 className="text-sm-minus font-semibold text-[color:var(--text-heading)]">First Nations</h1>
            <span className="text-2xs text-[color:var(--text-muted)]">
              {hospitals.length > 1 ? "Hospital contacts" : (hospitals[0]?.name ?? "WA statewide")}
            </span>
          </header>
          <dl className="grid">
            {rows.map((r) => (
              <div key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
                <dt className="text-sm-minus text-[color:var(--text)]">{r.label}</dt>
                <dd className="nums text-sm-minus font-normal text-[color:var(--text-heading)]">{r.number}</dd>
              </div>
            ))}
          </dl>
          <PrintedLine
            printedOn={printedOn}
            checkedAt={checkedAt}
            className="text-2xs text-[color:var(--text-muted)]"
          />
        </article>
      </PrintOutput>
    </div>
  );
}

export function FirstNationsPocketCard() {
  return <PocketCardView hospitals={hospitalViews(loadModelInputs())} />;
}

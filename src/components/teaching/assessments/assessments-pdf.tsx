"use client";

import { Check, Clock, Download, Info, Minus, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Inset, ScreenHeader, viewHref } from "@/components/teaching/assessments/assessments-parts";
import { AssessButton } from "@/components/teaching/assessments/assess-kit";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { cn } from "@/components/ui-primitives";
import {
  DOMAINS,
  EVIDENCE_SOURCES,
  GLOBAL_RATINGS,
  RATING_LABELS,
  type Domain,
} from "@/lib/teaching/assessments/content";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";
import { samSignOff } from "@/lib/teaching/assessments/dct";
import { blankForm, meetingDate, type AssessmentForm, type Signature } from "@/lib/teaching/assessments/model";
import {
  CURRENT_TERM,
  SAMPLE_DOCTOR,
  SAMPLE_MIDTERM,
  SAMPLE_PAST_FORMS,
  delegatedEndOfTermLine,
  registrarMidTermLine,
  sampleTerm,
  type PastForm,
  type SampleTerm,
} from "@/lib/teaching/assessments/sample";

/*
 * A printable copy only: an example health service's form, laid out on the AMC term
 * assessment form (paper version), three A4 pages, filled from the record it belongs
 * to. In CLA the supervisor submits the form, the doctor acknowledges it and the DCT
 * completes DCT sign-off there (CLA Training Guide for Prevocational Doctors, p.12;
 * supervisors' guide, p.39), so nothing here is emailed. Loaded only when opened.
 * "Save a copy" uses the browser's own print, so nothing is uploaded.
 */

type Filled = Pick<
  AssessmentForm,
  "sources" | "other" | "ticks" | "ratings" | "feedback" | "global" | "strengths" | "areas"
>;

function fromPast(p: PastForm): Filled {
  const blank = blankForm();
  return {
    ...blank,
    sources: p.sources,
    ticks: p.ticks,
    ratings: p.ratings,
    feedback: { ...blank.feedback, ...p.feedback },
    global: p.global,
    strengths: p.strengths,
    areas: p.areas,
  };
}

function Box({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid size-3 shrink-0 place-items-center border border-[color:var(--text-heading)] align-middle text-2xs leading-none"
    >
      {on ? "✓" : ""}
    </span>
  );
}

function Field({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-6 items-end gap-1 border-b border-[color:var(--border-strong)] pb-0.5">
      <span className="shrink-0 text-[color:var(--text-muted)]">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function DomainBlock({ d, f }: { d: Domain; f: Filled }) {
  return (
    <div className="grid gap-1">
      <div className="bg-[color:var(--surface-subtle)] px-1.5 py-1 font-semibold">
        Domain {d.n}: {d.title} | {d.subtitle}
      </div>
      <div className="grid gap-0.5">
        {d.outcomes.map((o) => (
          <div key={o.id} className="flex items-start gap-1.5">
            <Box on={f.ticks[d.n].includes(o.id)} />
            <b className="font-semibold">
              {o.id} {o.name}
            </b>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5 border border-[color:var(--border-strong)]">
        {RATING_LABELS.map((label, i) => (
          <span
            key={label}
            className={cn(
              "border-l border-[color:var(--border-strong)] px-1 py-0.5 text-center first:border-l-0",
              f.ratings[d.n] === i + 1 &&
                "bg-[color:var(--text-heading)] font-semibold text-[color:var(--surface-raised)]",
            )}
          >
            {i + 1} {label}
          </span>
        ))}
      </div>
      <div className="min-h-8 border border-[color:var(--border-strong)] px-1.5 py-1">{f.feedback[d.n]}</div>
    </div>
  );
}

function Paper({ page, children }: { page: number; children: ReactNode }) {
  return (
    <section
      aria-label={`Page ${page} of 3`}
      className="relative grid gap-2.5 border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 pb-7 text-[color:var(--text-heading)] shadow-[var(--e1)]"
    >
      {children}
      <span className="absolute right-3 bottom-2 text-[color:var(--text-muted)]">Page {page} of 3</span>
    </section>
  );
}

const sig = (text: string | null | undefined) => (text ? <span className="text-sm italic">{text}</span> : null);

/** A drawn signature prints as drawn; a typed one prints as the typed name. */
const signed = (s: Signature) =>
  s.image ? (
    <svg
      role="img"
      aria-label={`Signature: ${s.typed}`}
      viewBox={`0 0 ${s.image.width} ${s.image.height}`}
      className="h-6 w-auto"
    >
      <path d={s.image.path} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  ) : (
    sig(s.typed)
  );

export function FormPdf({ s, params, role, dct }: ScreenProps) {
  const [zoom, setZoom] = useState(false);
  const example = useExampleData("assess").active;
  // A past term with no saved form, or an unknown form, opens the blank form rather than a filled-looking one.
  const asked = params.get("of");
  const pastTerm = asked === "past" ? sampleTerm(params.get("term")) : null;
  const hasPast = !!pastTerm && !!SAMPLE_PAST_FORMS[pastTerm.id as "t1" | "t2" | "t3"];
  const of = (asked === "past" && hasPast) || asked === "mid" || asked === "eot" ? asked : "blank";
  const blank = of === "blank";
  const past = of === "past";
  let f: Filled = blankForm();
  let term: SampleTerm | null = null;
  let kind: "mid" | "eot" | null = null;
  let supSig: ReactNode = null;
  let docSig: ReactNode = null;
  let supDate = "";
  let docDate = "";
  if (past) {
    term = pastTerm!;
    kind = params.get("kind") === "mid" ? "mid" : "eot";
    f = fromPast(SAMPLE_PAST_FORMS[term.id as "t1" | "t2" | "t3"]![kind]);
    supSig = sig(term.supervisor.replace("Dr ", ""));
    docSig = sig("Sam Karri");
    supDate = docDate = (kind === "eot" ? term.signed : term.midSigned) ?? "";
  } else if (of === "mid") {
    term = CURRENT_TERM;
    kind = "mid";
    f = fromPast(SAMPLE_MIDTERM.sup);
    supSig = sig("Robin Wattle");
    docSig = sig("Sam Karri");
    supDate = docDate = SAMPLE_MIDTERM.date;
  } else if (of === "eot") {
    term = CURRENT_TERM;
    kind = "eot";
    f = s.sup;
    supSig = s.sigs.sup ? signed(s.sigs.sup) : null;
    docSig = s.sigs.doc ? signed(s.sigs.doc) : null;
    supDate = s.sigs.sup ? (meetingDate(s) ?? s.sigs.sup.date) : "";
    docDate = s.sigs.doc?.date ?? "";
  }
  // This term's end-of-term carries the DCT's sign-off once the DCT side has given it.
  const signOff = of === "eot" && s.sigs.doc ? samSignOff(dct) : null;
  const dctSigned = past && kind === "eot";
  const dctBox = dctSigned
    ? { name: "Dr M. Grant", position: "DCT", sign: sig("M Grant"), date: term?.signed ?? "", feedback: "" }
    : signOff
      ? { name: "DCT", position: "Director of Clinical Training", sign: sig("DCT"), ...signOff }
      : null;
  const fill = (text: ReactNode) => (blank ? null : text);
  const label = blank ? "Blank · example form" : `${kind === "mid" ? "Mid-term" : "End-of-term"} · ${term?.name ?? ""}`;
  const back =
    role === "supervisor"
      ? viewHref("side", { as: "supervisor" })
      : blank
        ? viewHref("home")
        : past
          ? viewHref("term", { term: term?.id ?? "t4" })
          : of === "mid"
            ? viewHref("report", { of: "mid" })
            : viewHref("hub");
  let status: ReactNode;
  if (blank)
    status = (
      <Inset tone="plain" icon={Info} title="Example form">
        Layout based on the AMC template. Your hospital&apos;s may differ.
      </Inset>
    );
  else if (past || of === "mid") {
    // AMC Section 3A: a delegated end-of-term, countersigned by the term supervisor, or a registrar's mid-term.
    const who = past && term ? (kind === "eot" ? delegatedEndOfTermLine(term) : registrarMidTermLine(term)) : null;
    status = (
      <Inset tone="ok" icon={Check} title="Signed copy">
        {[dctSigned ? "DCT sign-off done." : "Kept here for your records.", who].filter(Boolean).join(" ")}
      </Inset>
    );
  } else if (signOff)
    status = (
      <Inset tone="ok" icon={Check} title={`DCT sign-off done ${signOff.date}`}>
        A printable copy only. The form itself is in CLA.
      </Inset>
    );
  else if (s.sigs.doc)
    status = (
      <Inset tone="plain" icon={Check} title="Signed by you both · printable copy">
        In CLA the supervisor submits the form and the doctor acknowledges it there. The DCT then completes DCT sign-off
        in CLA. Nothing here is emailed.
      </Inset>
    );
  else
    status = (
      <Inset tone="warm" icon={Clock} title="Draft">
        Not signed yet. This updates as people sign.
      </Inset>
    );

  return (
    <>
      <ScreenHeader back={back} backLabel="the previous screen" title="Form PDF" subtitle={label} />
      {status}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[color:var(--text-muted)]">3 pages · A4</span>
        <AssessButton variant="secondary" icon={zoom ? Minus : Plus} onClick={() => setZoom((z) => !z)}>
          {zoom ? "Fit to screen" : "Zoom to full size"}
        </AssessButton>
      </div>
      <div
        className={cn("grid gap-3", zoom ? "overflow-x-auto" : "")}
        data-testid="teaching-assessments-paper"
        {...(zoom ? { tabIndex: 0, role: "region", "aria-label": "Form page, scroll sideways to read" } : {})}
      >
        <div className={cn("grid gap-3", zoom ? "w-[600px] text-xs" : "text-2xs")}>
          <Paper page={1}>
            <div className="flex items-baseline justify-between gap-2 border-b-2 border-[color:var(--text-heading)] pb-1">
              <b className="text-sm">Prevocational Training Term Assessment Form</b>
              <span>Example health service</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <Field label="Name">{fill(SAMPLE_DOCTOR.name)}</Field>
              <Field label="Term name">{fill(term?.name)}</Field>
              <div className="flex flex-wrap items-center gap-2">
                <Box on={kind === "mid"} /> Mid-term <Box on={kind === "eot"} /> End-of-term <Box on={false} />{" "}
                Self-assessment
              </div>
              <Field label="PGY level">{fill("1")}</Field>
              <Field label="Term dates">{fill(term ? `${term.from} to ${term.to}` : "")}</Field>
              <Field label="Term supervisor">{fill(term?.supervisor)}</Field>
            </div>
            <div className="grid gap-1">
              <b>Sources of information</b>
              <div className="grid grid-cols-2 gap-0.5">
                {EVIDENCE_SOURCES.map((source) => (
                  <span key={source} className="flex items-center gap-1.5">
                    <Box on={f.sources.includes(source)} />
                    {source}
                  </span>
                ))}
                <span className="col-span-2 flex items-center gap-1.5">
                  <Box on={!!f.other} />
                  Other (please specify): {f.other}
                </span>
              </div>
            </div>
            <p className="italic">
              If any outcomes were not observed, say which, and whether other evidence was provided in the record of
              learning.
            </p>
            <DomainBlock d={DOMAINS[0]!} f={f} />
          </Paper>
          <Paper page={2}>
            <DomainBlock d={DOMAINS[1]!} f={f} />
            <DomainBlock d={DOMAINS[2]!} f={f} />
          </Paper>
          <Paper page={3}>
            <DomainBlock d={DOMAINS[3]!} f={f} />
            <div className="bg-[color:var(--surface-subtle)] px-1.5 py-1 font-semibold">
              Global rating (end-of-term only)
            </div>
            <div className="grid gap-0.5">
              {GLOBAL_RATINGS.map((g) => (
                <span key={g.id} className="flex items-start gap-1.5">
                  <Box on={f.global === g.id} />
                  <span>
                    <b>{g.title}</b>: {g.detail}
                  </span>
                </span>
              ))}
            </div>
            <p className="italic">
              If a rating of 1 or 2 is given in any domain, liaise with the MEU or DCT to complete an Improving
              Performance Action Plan (IPAP).
            </p>
            <div className="grid gap-0.5">
              <b>Strengths</b>
              <div className="min-h-8 border border-[color:var(--border-strong)] px-1.5 py-1">{f.strengths}</div>
            </div>
            <div className="grid gap-0.5">
              <b>Areas for improvement</b>
              <div className="min-h-8 border border-[color:var(--border-strong)] px-1.5 py-1">{f.areas}</div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <Field label="Term supervisor">{fill(term?.supervisor)}</Field>
              <Field label="Position">{fill("Consultant")}</Field>
              <Field label="Signature">{supSig}</Field>
              <Field label="Date">{supDate}</Field>
            </div>
            <p>
              I (the prevocational doctor) confirm that I have discussed the above report with my term supervisor or
              delegate and know that if I disagree with any points I may respond in writing to the Director of Clinical
              Training within 14 days.
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <Field label="Signature">{docSig}</Field>
              <Field label="Date">{docDate}</Field>
              <Field label="DCT name">{dctBox?.name ?? ""}</Field>
              <Field label="Position">{dctBox?.position ?? ""}</Field>
              <Field label="Signature">{dctBox?.sign ?? null}</Field>
              <Field label="Date">{dctBox?.date ?? ""}</Field>
            </div>
            <div className="grid gap-0.5">
              <b>Director of Clinical Training feedback</b>
              <div className="min-h-8 border border-[color:var(--border-strong)] px-1.5 py-1">{dctBox?.feedback}</div>
            </div>
          </Paper>
        </div>
      </div>
      <AssessButton
        icon={Download}
        variant="secondary"
        block
        onClick={() => {
          // Example records never leave the app, and printing to PDF is how this one would.
          if (guardExampleAction(example, "export")) window.print();
        }}
      >
        Save a copy
      </AssessButton>
    </>
  );
}

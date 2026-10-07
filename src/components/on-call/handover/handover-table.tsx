"use client";

import { Brain, Building2, ChevronRight, Copy, Printer, Share } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import {
  OnCallHandoverBeforeItLeaves,
  type OnCallHandoverDestination,
} from "@/components/on-call/handover/before-it-leaves";
import { OnCallTrackBar } from "@/components/on-call/kit/track-bar";
import { onCallActionLink, onCallFilledButton } from "@/components/on-call/kit/calm";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { announce } from "@/components/ui/live-announcer";
import { PrintOutput } from "@/components/ui/print-output";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { ON_CALL_HANDOVER_SHARE_ENABLED } from "@/lib/on-call/feature-flags";
import {
  onCallHandoverCell,
  onCallHandoverExportSummary,
  onCallHandoverHtmlTable,
  onCallHandoverLegalIsForm,
  onCallHandoverPatientLabel,
  onCallHandoverPlainText,
  onCallHandoverReviewCount,
  onCallHandoverWards,
  type OnCallHandoverHeading,
  type OnCallHandoverPatient,
} from "@/lib/on-call/handover";
import { guardExampleAction, isExampleRecord } from "@/lib/example-data/guards";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/*
 * THE TABLE: a shift header, one table with the patient column frozen, what
 * lands when it is pasted, and the three exports, each through "Before it
 * leaves". The handover has no name or record-number field, and the check asks
 * the reader to look over the free text for any.
 */

/** A two-way switch (Table / Cards, Word or email / Plain text): a grey track with a raised tile on the choice. */
export function OnCallHandoverSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly testId: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 gap-1 rounded-lg bg-[color:var(--surface-wash)] p-1"
      data-testid={testId}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              focusRing,
              "min-h-12 flex-1 rounded-md text-sm forced-colors:border",
              pressed
                ? "bg-[color:var(--surface-raised)] font-semibold text-[color:var(--text-heading)] shadow-[var(--shadow-inset)]"
                : "text-[color:var(--text-muted)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Copies the table as a table where the browser allows it, and as plain text everywhere. */
async function copyHandover(html: string, plain: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Fall through to plain text.
    }
  }
  await copyTextToClipboard(plain);
}

function subscribeNothing(): () => void {
  return () => {};
}

/** True only where this browser can hand text to another app. */
function useCanShare(): boolean {
  // Off until the owner decides on sharing a handover (feature-flags.ts).
  const supported = useSyncExternalStore(
    subscribeNothing,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );
  return ON_CALL_HANDOVER_SHARE_ENABLED && supported;
}

const legalBadge =
  "inline-flex min-h-6 items-center rounded-sm border border-[color:var(--border-strong)] px-1.5 text-xs font-semibold text-[color:var(--text-heading)] forced-colors:border";

function ReviewDot({ on }: { readonly on: boolean }) {
  if (!on) return null;
  return (
    <span
      aria-hidden="true"
      className="mr-1 inline-block size-1.5 shrink-0 rounded-full bg-[color:var(--text-heading)] align-middle forced-colors:bg-[CanvasText]"
    />
  );
}

/** "2 of 4 need review": one segment per patient, filled for each flagged one. */
function ReviewBar({ patients }: { readonly patients: readonly OnCallHandoverPatient[] }) {
  const review = onCallHandoverReviewCount(patients);
  const total = patients.length;
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="on-call-handover-review-bar">
      <span aria-hidden="true" className="flex min-w-0 flex-1 gap-1.5">
        {total <= 12 ? (
          patients.map((patient) => (
            <span
              key={patient.id}
              className={cn(
                "h-1 flex-1 rounded-full",
                patient.review === "yes" ? "bg-[color:var(--text-heading)]" : "bg-[color:var(--surface-wash)]",
              )}
            />
          ))
        ) : (
          <OnCallTrackBar
            percent={Math.round((review / total) * 100)}
            className="flex-1"
            fillClassName="bg-[color:var(--text-heading)]"
          />
        )}
      </span>
      <p className="nums shrink-0 text-sm font-semibold text-[color:var(--text-heading)]">
        {review} of {total} need review
      </p>
    </div>
  );
}

function LegalCell({ value }: { readonly value: string }) {
  if (!value) return null;
  return onCallHandoverLegalIsForm(value) ? <span className={legalBadge}>{value}</span> : <span>{value}</span>;
}

function Table({
  patients,
  onEdit,
}: {
  readonly patients: readonly OnCallHandoverPatient[];
  readonly onEdit: (patient: OnCallHandoverPatient) => void;
}) {
  const cellBase = "border-b border-[color:var(--border)] px-3 py-3 align-top text-sm text-[color:var(--text)]";
  return (
    <div
      data-no-tab-swipe
      className="max-w-full overflow-x-auto rounded-md print:overflow-visible"
      tabIndex={0}
      aria-label="Handover table, scrolls sideways"
    >
      <table className="w-max min-w-full border-collapse text-left print:w-full print:text-xs">
        <caption className="sr-only">
          {patients.length === 1 ? "One patient" : `${patients.length} patients`}, in the order entered
        </caption>
        <thead>
          <tr className="bg-[color:var(--surface-wash)]">
            {(["Patient", "Legal", "Impression", "Review", "Referral", "Story", "Plan"] as const).map((label) => (
              <th
                key={label}
                scope="col"
                className={cn(
                  eyebrowText,
                  "border-b border-[color:var(--border)] px-3 py-2.5",
                  label === "Patient" && "sticky left-0 z-[5] bg-[color:var(--surface-wash)] print:static",
                )}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {patients.map((patient, index) => {
            const flagged = patient.review === "yes";
            const label = onCallHandoverPatientLabel(patient.bed, index);
            return (
              <tr key={patient.id} data-testid="on-call-handover-table-row" data-review={flagged ? "yes" : undefined}>
                <th
                  scope="row"
                  className={cn(
                    cellBase,
                    "sticky left-0 z-[5] min-w-28 max-w-36 bg-[color:var(--surface-raised)] font-normal print:static",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onEdit(patient)}
                    aria-label={`Edit ${label}${flagged ? ", flagged for review" : ""}`}
                    className={cn(focusRing, "grid min-h-12 w-full content-start rounded-sm text-left")}
                  >
                    <span className="break-words text-sm font-semibold text-[color:var(--text-heading)]">
                      <ReviewDot on={flagged} />
                      {label}
                    </span>
                    {patient.ward ? (
                      <span className="break-words text-xs text-[color:var(--text-muted)]">{patient.ward}</span>
                    ) : null}
                  </button>
                </th>
                <td className={cellBase}>
                  <LegalCell value={patient.legal} />
                </td>
                <td className={cn(cellBase, "min-w-36 max-w-48 break-words")}>{patient.impression}</td>
                <td className={cn(cellBase, flagged && "font-semibold text-[color:var(--text-heading)]")}>
                  {onCallHandoverCell(patient, "review")}
                </td>
                <td className={cn(cellBase, "min-w-28 max-w-40 break-words")}>{patient.referrals}</td>
                <td className={cn(cellBase, "min-w-56 max-w-72 whitespace-pre-wrap break-words")}>{patient.story}</td>
                <td className={cn(cellBase, "min-w-56 max-w-72 whitespace-pre-wrap break-words")}>{patient.plan}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cards({
  patients,
  onEdit,
}: {
  readonly patients: readonly OnCallHandoverPatient[];
  readonly onEdit: (patient: OnCallHandoverPatient) => void;
}) {
  return (
    <ol role="list" className="grid min-w-0 gap-3" data-testid="on-call-handover-cards">
      {patients.map((patient, index) => {
        const flagged = patient.review === "yes";
        const label = onCallHandoverPatientLabel(patient.bed, index);
        const rows = [
          ["Legal", patient.legal],
          ["Impression", patient.impression],
          ["Review", onCallHandoverCell(patient, "review")],
          ["Referral", patient.referrals],
          ["Story", patient.story],
          ["Plan", patient.plan],
        ].filter(([, value]) => value);
        return (
          <li
            key={patient.id}
            className="grid min-w-0 gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 forced-colors:border"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <p className="min-w-0 break-words text-base-minus font-semibold text-[color:var(--text-heading)]">
                <ReviewDot on={flagged} />
                {label}
                {patient.ward ? (
                  <span className="font-normal text-[color:var(--text-muted)]"> · {patient.ward}</span>
                ) : null}
              </p>
              <button
                type="button"
                onClick={() => onEdit(patient)}
                aria-label={`Edit ${label}`}
                className={cn(onCallActionLink, focusRing, "-my-3")}
              >
                Edit
              </button>
            </div>
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {rows.map(([term, value]) => (
                <div key={term} className="contents">
                  <dt className="text-[color:var(--text-muted)]">{term}</dt>
                  <dd className="whitespace-pre-wrap break-words text-[color:var(--text)]">{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

/** What lands at the other end: a schematic of the A4 table, or the exact plain text. */
function PastePreview({
  patients,
  plain,
  title,
  view,
  onView,
}: {
  readonly patients: readonly OnCallHandoverPatient[];
  readonly plain: string;
  readonly title: string;
  readonly view: "word" | "text";
  readonly onView: (view: "word" | "text") => void;
}) {
  const widths = ["w-[16%]", "w-[7%]", "w-[19%]", "w-[10%]", "w-[11%]", "w-[18%]", "w-[19%]"];
  const shown = patients.slice(0, 8);
  return (
    <section aria-labelledby="on-call-handover-paste-heading" className="grid min-w-0 gap-3 print:hidden">
      <h2 id="on-call-handover-paste-heading" className={cn(eyebrowText, "px-1")}>
        When you paste it
      </h2>
      <OnCallHandoverSwitch
        label="Where you paste it"
        value={view}
        onChange={onView}
        options={[
          { value: "word", label: "Word or email" },
          { value: "text", label: "Plain text" },
        ]}
        testId="on-call-handover-paste-switch"
      />
      {view === "word" ? (
        <figure
          className="grid min-w-0 gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 forced-colors:border"
          data-testid="on-call-handover-paste-word"
        >
          <figcaption className="flex min-w-0 items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-xs font-semibold text-[color:var(--text-heading)]">{title}</span>
            <span className="shrink-0 text-xs text-[color:var(--text-muted)]">A4 landscape</span>
          </figcaption>
          <p className="sr-only">
            A table with seven columns and {patients.length === 1 ? "one row" : `${patients.length} rows`}; rows for
            review are shaded.
          </p>
          <div aria-hidden="true" className="grid gap-1">
            {[null, ...shown].map((patient, row) => (
              <div key={patient?.id ?? "head"} className="flex gap-1">
                {widths.map((width, column) => (
                  <span
                    key={column}
                    className={cn(
                      width,
                      "rounded-xs border border-[color:var(--border)]",
                      row === 0 ? "h-2.5 bg-[color:var(--surface-wash)]" : "h-4",
                      patient?.review === "yes" && "bg-[color:var(--border)]",
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </figure>
      ) : (
        <pre
          data-no-tab-swipe
          className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-wash)] p-3 font-mono text-xs leading-5 text-[color:var(--text-heading)] forced-colors:border"
          data-testid="on-call-handover-paste-text"
          tabIndex={0}
        >
          {plain}
        </pre>
      )}
    </section>
  );
}

export function OnCallHandoverTable({
  patients,
  heading,
  clearsAt,
  toTeam,
  onEdit,
}: {
  readonly patients: readonly OnCallHandoverPatient[];
  /** The date line and the shift ("Night to day") when known. */
  readonly heading: OnCallHandoverHeading;
  readonly clearsAt: string | null;
  /** "Day team", only when the shift is known to be a night. */
  readonly toTeam: string | null;
  readonly onEdit: (patient: OnCallHandoverPatient) => void;
}) {
  const { zone } = useWorkTimeZone();
  const [view, setView] = useState<"table" | "cards">("table");
  const [paste, setPaste] = useState<"word" | "text">("word");
  const [destination, setDestination] = useState<OnCallHandoverDestination>("copy");
  const [checking, setChecking] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const canShare = useCanShare();
  const resetTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const plain = useMemo(() => onCallHandoverPlainText(patients, new Date(), heading), [patients, heading]);
  const wards = onCallHandoverWards(patients);
  const summary = onCallHandoverExportSummary(patients);
  const dates = heading.dates ?? null;
  const shiftWords = heading.shift ? heading.shift.toLowerCase() : null;
  const titleLine = [dates, shiftWords].filter(Boolean).join(" · ");
  const pasteTitle = ["Psychiatry handover", dates].filter(Boolean).join(" · ");

  const ask = (next: OnCallHandoverDestination) => {
    setDestination(next);
    setChecking(true);
  };

  const send = useCallback(async () => {
    setChecking(false);
    // Example records never leave the app. A doctor's own handover is never
    // blocked: only a list holding example records is.
    if (
      !guardExampleAction(
        patients.some((patient) => isExampleRecord(patient)),
        "send",
      )
    )
      return;
    if (destination === "print") {
      window.requestAnimationFrame(() => window.print());
      return;
    }
    if (destination === "share") {
      try {
        await navigator.share({ title: pasteTitle, text: plain });
        announce("Handover shared.");
      } catch {
        announce("Not shared.");
      }
      return;
    }
    try {
      await copyHandover(onCallHandoverHtmlTable(patients, new Date(), heading), plain);
      setCopy("copied");
      announce("Handover copied.");
    } catch {
      setCopy("failed");
      setPaste("text");
      announce("Not copied. Select the text and copy it by hand.");
    }
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopy("idle"), 4000);
  }, [destination, heading, patients, pasteTitle, plain]);

  const tiles = [
    toTeam ? { label: "To", value: toTeam } : null,
    { label: "Clears", value: clearsAt ?? "Shift end" },
  ].filter((tile): tile is { label: string; value: string } => tile !== null);

  return (
    <section className="grid min-w-0 gap-4" aria-label="Handover table" data-testid="on-call-handover-table">
      <style>{"@media print { @page { size: A4 landscape; } }"}</style>
      <PrintOutput
        monochrome
        confidential
        printedAt={`Printed ${new Intl.DateTimeFormat("en-AU", {
          timeZone: zone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date())}`}
        provenance="PsychSift On Call handover. Typed by the doctor on this phone; check it before relying on it."
        testId="on-call-handover-print"
        className="grid min-w-0 gap-4"
      >
        <header className="grid min-w-0 gap-3" data-testid="on-call-handover-shift">
          <div className="flex min-w-0 items-start gap-3 px-1">
            <Brain aria-hidden="true" className="mt-4 size-icon-md shrink-0 text-[color:var(--text-muted)]" />
            <div className="min-w-0">
              <p className={eyebrowText}>Psychiatry handover</p>
              {titleLine ? (
                <h2 className="text-lg-minus font-semibold text-[color:var(--text-heading)]">{titleLine}</h2>
              ) : null}
            </div>
          </div>
          <dl
            className={cn(
              "grid min-w-0 divide-x divide-[color:var(--border)] rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-center forced-colors:border",
              tiles.length === 1 ? "grid-cols-1" : "grid-cols-2",
            )}
          >
            {tiles.map((tile) => (
              <div key={tile.label} className="grid gap-0.5 px-2 py-2.5">
                <dt className="text-xs font-semibold text-[color:var(--text-muted)]">{tile.label}</dt>
                <dd className="nums text-sm font-semibold text-[color:var(--text-heading)]">{tile.value}</dd>
              </div>
            ))}
          </dl>
          {wards.length > 0 ? (
            <p className="flex min-w-0 items-center gap-2 px-1 text-sm font-semibold text-[color:var(--text-heading)]">
              <Building2 aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
              <span className="min-w-0 break-words">{wards.join(" · ")}</span>
            </p>
          ) : null}
          <ReviewBar patients={patients} />
        </header>

        <div className="print:hidden">
          <OnCallHandoverSwitch
            label="Show as"
            value={view}
            onChange={setView}
            options={[
              { value: "table", label: "Table" },
              { value: "cards", label: "Cards" },
            ]}
            testId="on-call-handover-view-switch"
          />
        </div>

        <div className={cn("min-w-0", view === "cards" && "hidden print:block")}>
          <Table patients={patients} onEdit={onEdit} />
          <p className="mt-3 flex items-center justify-center gap-1 text-sm font-semibold text-[color:var(--text-muted)] print:hidden">
            Swipe for review, referral, story and plan
            <ChevronRight aria-hidden="true" className="size-icon-xs" />
          </p>
        </div>
        {view === "cards" ? (
          <div className="min-w-0 print:hidden">
            <Cards patients={patients} onEdit={onEdit} />
          </div>
        ) : null}
      </PrintOutput>

      <PastePreview patients={patients} plain={plain} title={pasteTitle} view={paste} onView={setPaste} />

      <div className="grid min-w-0 gap-1 print:hidden">
        <button
          type="button"
          onClick={() => ask("copy")}
          className={cn(onCallFilledButton, focusRing, "w-full")}
          data-testid="on-call-handover-table-copy"
        >
          <Copy aria-hidden="true" className="size-icon-sm" />
          {copy === "copied" ? "Copied" : "Copy as table"}
        </button>
        <div className={cn("grid min-w-0 gap-2", canShare ? "grid-cols-2" : "grid-cols-1")}>
          <button
            type="button"
            onClick={() => ask("print")}
            className={cn(onCallActionLink, focusRing, "justify-center gap-2 text-base-minus")}
            data-testid="on-call-handover-table-print"
          >
            <Printer aria-hidden="true" className="size-icon-sm" />
            Print / PDF
          </button>
          {canShare ? (
            <button
              type="button"
              onClick={() => ask("share")}
              className={cn(onCallActionLink, focusRing, "justify-center gap-2 text-base-minus")}
              data-testid="on-call-handover-table-share"
            >
              <Share aria-hidden="true" className="size-icon-sm" />
              Share
            </button>
          ) : null}
        </div>
        {copy === "failed" ? (
          <p className={cn(modeSecondaryText, "text-center")} role="status" data-testid="on-call-handover-copy-failed">
            Not copied. Select the text and copy it by hand.
          </p>
        ) : null}
        <p className={cn(modeSecondaryText, "text-center")}>Each export checks where it is going first.</p>
      </div>

      <OnCallHandoverBeforeItLeaves
        open={checking}
        destination={destination}
        canShare={canShare}
        summary={summary}
        clearsAt={clearsAt}
        onChoose={setDestination}
        onCancel={() => setChecking(false)}
        onConfirm={() => void send()}
      />
    </section>
  );
}

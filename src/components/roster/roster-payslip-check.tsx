"use client";

import { Copy, Receipt } from "lucide-react";
import { useState } from "react";

import { WorkButton, WorkCard, WorkIconCircle, WorkSectionLabel } from "@/components/mode-kit/work";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";
import { WA_PUBLIC_HOLIDAYS } from "@/lib/on-call/wa-public-holidays";
import type { HoursSummary } from "@/lib/roster/hours";
import { formatSpanWords } from "@/lib/roster/shifts-overview";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";

import { formatHours, kindOf } from "./roster-format";
import { payslipFigures } from "./roster-month-model";

/**
 * Payslip check (owner idea 1, work-mode redesign, 6 Oct 2026). Pay errors
 * are common, and doctors are told to check each payslip against their
 * hours. The roster already knows them, so this card lays out what the
 * fortnight's payslip should reflect, counted from the roster only: hours,
 * recorded extra time, nights, on call, weekend and public holiday shifts.
 * No pay amounts and no claim status (PsychSift has neither). "Copy as text"
 * puts the same lines on the clipboard to paste beside the payslip.
 */
export function RosterPayslipCheck({
  shifts,
  summary,
  extraLoaded,
  partial,
  payAnchored,
}: {
  readonly shifts: readonly OnCallShift[];
  readonly summary: HoursSummary;
  /** False while saved extra time is loading or failed: the row then says so. */
  readonly extraLoaded: boolean;
  readonly partial: boolean;
  readonly payAnchored: boolean;
}) {
  // Example records never leave the app: Copy opens the "can't be exported" sheet instead.
  const { active: example } = useExampleData("rost");
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  const figures = payslipFigures(
    shifts.map((shift) => ({ id: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) })),
    { start: summary.start, end: summary.end },
    WA_PUBLIC_HOLIDAYS,
  );
  const atLeast = partial ? "at least " : "";
  const span = formatSpanWords(summary.start, summary.end);
  const rows: readonly [string, string][] = [
    ["Rostered hours", `${atLeast}${formatHours(summary.totalHours)}`],
    ["Extra time you recorded", extraLoaded ? formatHours(summary.extraHours) : "not loaded"],
    ["Shifts", `${atLeast}${figures.shifts}`],
    ["Nights", `${atLeast}${figures.nights}`],
    ["On call", `${atLeast}${figures.onCall}`],
    ["Weekend shifts", `${atLeast}${figures.weekend}`],
    ["Public holiday shifts", `${atLeast}${figures.holidays}`],
  ];

  async function copy() {
    if (!guardExampleAction(example, "copy")) return;
    const text = [
      `Roster check, ${payAnchored ? "pay fortnight" : "fortnight"} ${span}`,
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "From my roster in PsychSift. Rostered hours, not pay.",
    ].join("\n");
    try {
      await copyTextToClipboard(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <section className="grid gap-2" aria-labelledby="roster-payslip-heading" data-testid="roster-payslip-check">
      <WorkSectionLabel id="roster-payslip-heading" count={span}>
        {payAnchored ? "Payslip check · pay fortnight" : "Payslip check · fortnight"}
      </WorkSectionLabel>
      <WorkCard>
        <div className="work-row">
          <WorkIconCircle icon={Receipt} />
          <span className="work-row__text">
            <span className="work-row__title">What your payslip should reflect</span>
            <span className="work-row__sub">
              {payAnchored
                ? "Counted from your roster"
                : "Your team has no pay date set, so this is the last two weeks"}
            </span>
          </span>
        </div>
        <dl className="m-0 border-t border-[color:var(--border)] px-3 py-1">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 border-b py-2 border-[color:var(--border)] last:border-b-0"
            >
              <dt className="text-xs text-[color:var(--text)]">{label}</dt>
              <dd className="nums m-0 text-sm-minus font-bold text-[color:var(--text-heading)]">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-1.5 border-t border-[color:var(--border)] px-3 pb-3 pt-2.5">
          <p className="m-0 text-2xs text-[color:var(--text-muted)]">
            Your roster, not your pay. Compare it with your payslip.
            {partial ? " Part of your roster didn't load, so these are minimums." : ""}
          </p>
          <WorkButton variant="tinted" icon={Copy} onClick={() => void copy()} testId="roster-payslip-copy">
            Copy as text
          </WorkButton>
          <p role="status" className="m-0 min-h-4 text-2xs text-[color:var(--text-muted)]">
            {copied === "done"
              ? "Copied. Paste it beside your payslip."
              : copied === "failed"
                ? "Couldn't copy on this device."
                : ""}
          </p>
        </div>
      </WorkCard>
    </section>
  );
}

"use client";

import { BadgeCheck, Check, ChevronDown, ChevronRight, CircleDashed } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { modeInsetHairline, modeModuleSurface, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { buttonFaceClass } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { formatCalendarDateShort } from "@/lib/cme/cpd-year";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { buildCmeYearCheck, type CmeYearCheckRow } from "@/lib/cme/year-check";
import { cmePageTitle } from "@/components/cme/cme-page-frame";
import { CmeDomainsRing, isActivityCountRequirement } from "@/components/cme/cme-domains-ring";
import { CmeFractionBar } from "@/components/cme/cme-progress-visuals";

/** Where the renewal note's claim comes from: the Board's own "what do I need to do" CPD page. */
const MEDICAL_BOARD_CPD_URL =
  "https://www.medicalboard.gov.au/Professional-Performance-Framework/CPD/What--do-I-need-to-do.aspx";

/** How many proving activities a row names before "and N more". */
const PROOF_LIMIT = 4;

/** Targets list what proves them; records list what still needs attention. */
function proofFor(row: CmeYearCheckRow, byId: ReadonlyMap<string, CmeEntry>): CmeEntry[] {
  const proof = row.entryIds.map((id) => byId.get(id)).filter((entry): entry is CmeEntry => Boolean(entry));
  return proof.length > 0 && (row.group === "records" ? !row.ready : true) ? proof : [];
}

/**
 * YEAR CHECK — the year as an audit would read it.
 *
 * One progress bar, then what still needs the owner as compact rows, first,
 * then what is done folded under "Done (n)". Each row says in words whether
 * it is ready; tapping it opens a sheet naming the activities that prove it
 * ("What counts") and the one action that closes the gap. Targets come before
 * the three things asked of every activity (evidence, a reflection, copied to
 * the CPD home), in the order the check builds them.
 *
 * Ready and not-ready are carried by a tick or an open circle plus the words,
 * never by colour: this mode does not use red, amber or green for status.
 */
export function CmeYearCheckPage({ set, entries }: { set: CmeRequirementSet; entries: readonly CmeEntry[] }) {
  const check = buildCmeYearCheck(set, entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const needsYou = check.rows.filter((row) => !row.ready);
  const done = check.rows.filter((row) => row.ready);
  const [openId, setOpenId] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const openRow = openId ? (check.rows.find((row) => row.id === openId) ?? null) : null;
  const openProof = openRow ? proofFor(openRow, byId) : [];
  const share = check.rows.length > 0 ? check.readyCount / check.rows.length : 0;
  const domainRequirements = set.requirements.filter(isActivityCountRequirement);

  function open(row: CmeYearCheckRow, opener: HTMLButtonElement) {
    openerRef.current = opener;
    setOpenId(row.id);
  }

  return (
    <main data-testid="cme-year-check" className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <p className={eyebrowText}>{set.year} year check</p>
      <h1 className={cn(cmePageTitle, "mt-1")}>
        {check.readyCount} of {check.rows.length} done
      </h1>
      <CmeFractionBar testId="cme-check-progress" fraction={share} className="mt-3 h-2" />
      <p className={cn(textMuted, "mt-3 text-sm")}>
        Everything an audit of this year would ask for, and what each one rests on. Targets are the ones you confirmed
        for {set.year}
        {set.confirmedOn ? ` on ${formatCalendarDateShort(set.confirmedOn)}` : ""}. It records what you checked and is
        not certification.
      </p>

      {needsYou.length > 0 ? (
        <section className="mt-6 grid gap-2" aria-labelledby="cme-check-needs-you">
          <h2 id="cme-check-needs-you" className={cn(eyebrowText, "px-3")}>
            Needs you ({needsYou.length})
          </h2>
          <ul role="list" className={modeModuleSurface} data-testid="cme-check-needs-you">
            {needsYou.map((row) => (
              <CheckRow key={row.id} row={row} hasDetail={hasDetail(row, byId)} onOpen={open} />
            ))}
          </ul>
        </section>
      ) : null}

      {done.length > 0 ? (
        <details className="group mt-6" data-testid="cme-check-done">
          <summary
            className={cn(
              focusRing,
              "flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 [&::-webkit-details-marker]:hidden",
            )}
          >
            <span className={eyebrowText}>Done ({done.length})</span>
            <ChevronDown
              aria-hidden="true"
              className="size-icon-md shrink-0 text-[color:var(--text-muted)] transition-transform duration-[var(--duration-base)] group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ul role="list" className={cn(modeModuleSurface, "mt-2")}>
            {done.map((row) => (
              <CheckRow key={row.id} row={row} hasDetail={hasDetail(row, byId)} onOpen={open} />
            ))}
          </ul>
        </details>
      ) : null}

      {domainRequirements.length > 0 ? (
        <div className="mt-6 grid gap-3">
          {domainRequirements.map((requirement) => (
            <CmeDomainsRing key={requirement.id} requirement={requirement} entries={entries} year={set.year} />
          ))}
        </div>
      ) : null}

      <section
        className={cn(modeModuleSurface, "mt-6 flex items-start gap-3 p-4")}
        aria-labelledby="cme-check-renewal"
        data-testid="cme-check-renewal"
      >
        <BadgeCheck aria-hidden="true" className={cn("mt-0.5 size-icon-md shrink-0", textMuted)} />
        <div className="grid min-w-0 gap-1 text-sm">
          <h2 id="cme-check-renewal" className="font-semibold text-[color:var(--text)]">
            Your renewal asks for your {set.year} CPD home
          </h2>
          <p className={textMuted}>
            If you log CPD with a CPD home, your registration renewal asks which one you used.
          </p>
          <div className="flex flex-wrap gap-x-5">
            <Link
              href="/admin/renewals"
              className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)]"
            >
              Open Renewals in Admin
            </Link>
            <a
              href={MEDICAL_BOARD_CPD_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(textMuted, "inline-flex min-h-tap items-center text-xs underline underline-offset-2")}
            >
              Source: Medical Board, checked 5 Oct 2026
            </a>
          </div>
        </div>
      </section>

      <p className={cn(textMuted, "mt-6 text-sm")}>
        To hand it over, open your{" "}
        <Link
          href={`/cme/summary?year=${set.year}`}
          className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)]"
        >
          annual summary
        </Link>{" "}
        to save it as a PDF.
      </p>

      <Sheet
        open={openRow !== null}
        onClose={() => setOpenId(null)}
        title={openRow?.label ?? "Year check"}
        description={openRow?.summary}
        placement="responsive-right"
        mobilePlacement="bottom"
        returnFocusRef={openerRef}
        testId="cme-check-sheet"
        footer={
          openRow?.action ? (
            <Link
              href={openRow.action.href}
              data-testid="cme-check-sheet-action"
              className={buttonFaceClass({ variant: "primary", block: true })}
            >
              {openRow.action.label}
            </Link>
          ) : undefined
        }
      >
        {openRow && openProof.length > 0 ? (
          <section aria-labelledby="cme-check-sheet-proof" className="grid gap-1 text-sm">
            <h3 id="cme-check-sheet-proof" className={eyebrowText}>
              {openRow.group === "records" ? "Which activities" : `What counts (${openProof.length})`}
            </h3>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {openProof.slice(0, PROOF_LIMIT).map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/cme/log/${entry.id}`}
                    className="flex min-h-tap items-center justify-between gap-3 text-sm text-[color:var(--text)]"
                  >
                    <span className="truncate">{entry.title}</span>
                    <span className={cn(textMuted, "shrink-0 text-xs")}>{formatCalendarDateShort(entry.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {openProof.length > PROOF_LIMIT ? (
              <p className={cn(textMuted, "text-xs")}>and {openProof.length - PROOF_LIMIT} more in your log</p>
            ) : null}
          </section>
        ) : null}
      </Sheet>
    </main>
  );
}

function hasDetail(row: CmeYearCheckRow, byId: ReadonlyMap<string, CmeEntry>): boolean {
  return Boolean(row.action) || proofFor(row, byId).length > 0;
}

/**
 * One compact row: the status glyph, the name at 500 with its status for a
 * screen reader, and the one-line summary. A row with something behind it
 * (activities that prove it, or a fix) is a button that opens the sheet; a row
 * with nothing more to show — evidence that was not counted — is plain text.
 */
function CheckRow({
  row,
  hasDetail,
  onOpen,
}: {
  row: CmeYearCheckRow;
  hasDetail: boolean;
  onOpen: (row: CmeYearCheckRow, opener: HTMLButtonElement) => void;
}) {
  const StatusIcon = row.ready ? Check : CircleDashed;
  const body = (
    <>
      <StatusIcon
        aria-hidden="true"
        className={cn("size-icon-md shrink-0", row.ready ? "text-[color:var(--text)]" : textMuted)}
      />
      <span className="grid min-w-0 flex-1 gap-0.5 py-1 text-left">
        <span className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-heading)]")}>
          {row.label}
          <span className="sr-only">{row.notChecked ? " — not checked" : row.ready ? " — done" : " — to do"}</span>
        </span>
        <span className={cn(modeSecondaryText, "break-words leading-5")}>{row.summary}</span>
      </span>
    </>
  );
  return (
    <li
      className={modeInsetHairline}
      data-testid={`cme-check-row-${row.id}`}
      data-ready={row.ready ? "true" : "false"}
      data-not-checked={row.notChecked ? "true" : undefined}
    >
      {hasDetail ? (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={(event) => onOpen(row, event.currentTarget)}
          className={cn(modeRowHeight.double, modePressable, focusRing, "flex w-full items-center gap-3 pl-3 pr-2")}
        >
          {body}
          <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
        </button>
      ) : (
        <div className={cn(modeRowHeight.double, "flex items-center gap-3 pl-3 pr-2")}>{body}</div>
      )}
    </li>
  );
}

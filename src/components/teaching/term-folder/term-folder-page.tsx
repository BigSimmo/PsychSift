"use client";

import { CalendarDays, Check, Copy, Download, ExternalLink, Folder, Printer, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { WorkButton, WorkEmpty } from "@/components/mode-kit/work";
import { T5Link, T5List, T5Meta, T5Note, T5Page, T5Row, T5Section } from "@/components/teaching/t5-kit";
import { withUnit } from "@/components/teaching/teaching-number";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import {
  FOLDER_ICONS,
  FolderIconCircle,
  FolderMeter,
  FolderTag,
} from "@/components/teaching/term-folder/term-folder-parts";
import { TermFolderExportSheet } from "@/components/teaching/term-folder/term-folder-export-sheet";
import { useTermFolder, type TermFolderView } from "@/components/teaching/term-folder/use-term-folder";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";
import { buttonFaceClass } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { useOptionalToast } from "@/components/ui/toast";
import { cn } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { useAuthSession } from "@/lib/supabase/client";
import {
  FOLDER_CLA_URL,
  FOLDER_NOT_KEPT_LINE,
  FOLDER_PRIVACY_LINE,
  folderSectionLabels,
  folderSections,
  folderStatusWords,
  folderComingUp,
  folderExportBlocker,
  folderIsEarly,
  folderTermTitle,
  TERM_FOLDER_PATH,
  type TermFolder,
} from "@/lib/teaching/term-folder";
import { dayMonth, weekdayDayMonth } from "@/lib/teaching/term-tracker";
import { perthTime } from "@/lib/teaching/time";

/*
 * Term evidence folder, /teaching/term/folder (feature 12, mock-up nf_teach_acc). The doctor's own term
 * in one standing folder: a folder tab, a completeness meter with one segment per part, then the parts
 * that need action first. It fills itself from records PsychSift already holds and saves nothing new.
 * Download CSV and Print hand it to a supervisor or an accreditation visit; Copy summary is for an email.
 * Status and counts only: assessment content is never here.
 */

const secondaryButton = cn(buttonFaceClass({ variant: "secondary" }), "no-underline");
/** A control that cannot act yet looks it: dimmed, with the reason in the line beneath (aria-describedby). */
const unavailableFace = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

/**
 * A short plain-text summary for an email to a supervisor. It follows the export's privacy default (names
 * off): no supervisor's name and no session titles, only statuses, counts and dates.
 */
export function folderSummaryText(folder: TermFolder): string {
  return [
    `${folder.title} evidence folder`,
    folder.dates,
    `${folder.headline}. ${folder.meterLabel}`,
    "",
    ...folder.parts.map(
      (part) => `${part.label}: ${folderStatusWords[part.status]}. ${part.detailWithoutNames ?? part.detail}.`,
    ),
    "",
    FOLDER_PRIVACY_LINE,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function FolderActions({
  view,
  demoMode,
  onExported,
}: {
  view: Extract<TermFolderView, { kind: "ready" }>;
  demoMode: boolean;
  onExported: () => void;
}) {
  const { folder, today, term } = view;
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [exporting, setExporting] = useState(false);
  const blocker = folderExportBlocker(folder, term);
  return (
    <div className="grid gap-2" data-print-hide>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={cn(buttonFaceClass({ variant: "primary" }), unavailableFace)}
          aria-disabled={blocker ? true : undefined}
          aria-describedby={blocker ? "term-folder-export-why" : undefined}
          onClick={() => {
            if (!blocker) setExporting(true);
          }}
          data-testid="term-folder-export-open"
        >
          <Download aria-hidden="true" className="size-icon-sm" />
          Export
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            announce("Opening print");
            window.print();
          }}
        >
          <Printer aria-hidden="true" className="size-icon-sm" />
          Print
        </button>
      </div>
      {blocker ? (
        <p id="term-folder-export-why" className="text-center text-sm text-[color:var(--text-muted)]">
          {blocker}
        </p>
      ) : null}
      <button
        type="button"
        className={cn(
          "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-sm text-sm font-semibold text-[color:var(--mode-identity)]",
          focusRing,
          unavailableFace,
        )}
        aria-disabled={blocker ? true : undefined}
        aria-describedby={blocker ? "term-folder-export-why" : undefined}
        data-testid="term-folder-copy"
        onClick={async () => {
          if (blocker) return;
          try {
            await copyTextToClipboard(folderSummaryText(folder));
            setCopied("copied");
            announce("Summary copied");
          } catch {
            setCopied("failed");
            announce("Copy did not work. Use Export instead.");
          }
        }}
      >
        <Copy aria-hidden="true" className="size-icon-sm" />
        {copied === "copied" ? "Summary copied" : "Copy summary for an email"}
      </button>
      {copied === "failed" ? (
        <p role="status" className="text-center text-sm text-[color:var(--text-heading)]">
          Copy did not work on this browser. Use Export instead.
        </p>
      ) : null}
      <TermFolderExportSheet
        open={exporting}
        onClose={() => setExporting(false)}
        folder={folder}
        today={today}
        demoMode={demoMode}
        onExported={() => {
          setExporting(false);
          onExported();
        }}
      />
    </div>
  );
}

/** The signature: a folder with its tab, the term, the meter and the export controls. */
function FolderCard({ view, demoMode }: { view: Extract<TermFolderView, { kind: "ready" }>; demoMode: boolean }) {
  const { folder } = view;
  const tab = folder.phase === "during" ? "Now" : folder.phase === "ended" ? "Ended" : "Coming up";
  const toast = useOptionalToast();
  // When this visit exported the folder: the footer says so, as the mock-up's "Exported 15:10".
  const [exportedAt, setExportedAt] = useState<string | null>(null);
  return (
    <section aria-labelledby="term-folder-title" className="mt-3 grid" data-testid="term-folder-card">
      <span
        aria-hidden="true"
        className="ml-3 inline-flex w-fit items-center gap-1.5 rounded-t-md border border-b-0 border-[color:var(--border)] bg-[color:var(--mode-identity-soft)] px-3 py-1 text-2xs font-semibold text-[color:var(--mode-identity)]"
      >
        <Folder aria-hidden="true" className="size-icon-xs" />
        {`${folder.title} · ${tab}`}
      </span>
      <div className="grid gap-3.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5 forced-colors:border-[CanvasText]">
        <div className="grid gap-0.5">
          <h2 id="term-folder-title" className="text-base font-semibold text-[color:var(--text-heading)]">
            {folder.title}
          </h2>
          <p className="nums text-sm font-normal text-[color:var(--text-muted)]">{folder.dates}</p>
        </div>
        <div className="grid gap-1.5">
          <p className="text-sm font-medium text-[color:var(--text-heading)]">
            {folder.loading ? "Filling from your records" : folder.headline}
          </p>
          <FolderMeter parts={folder.parts} counts={folder.counts} label={folder.meterLabel} />
        </div>
        <FolderActions
          view={view}
          demoMode={demoMode}
          onExported={() => {
            const at = perthTime(new Date().toISOString());
            setExportedAt(at);
            // Said once: the toast speaks when there is one, otherwise the page announcer does.
            if (toast)
              toast.push({
                tone: "success",
                title: `${folder.title} folder exported`,
                body: "Gaps listed first in the file.",
              });
            else announce(`Folder exported at ${at}. The gaps are listed first in the file.`);
          }}
        />
        <p
          className="flex items-center gap-1.5 border-t border-[color:var(--border)] pt-2.5 text-xs text-[color:var(--text-muted)]"
          data-testid="term-folder-footer"
        >
          {exportedAt ? (
            <Check aria-hidden="true" className="size-icon-xs shrink-0 text-[color:var(--mode-identity)]" />
          ) : (
            <ShieldCheck aria-hidden="true" className="size-icon-xs shrink-0" />
          )}
          <span className="nums font-normal">
            {exportedAt
              ? `Exported ${exportedAt} · gaps listed in the file`
              : view.updatedAt
                ? `Fills itself · updated ${view.updatedAt}`
                : view.failed.length
                  ? "Not updated on this visit"
                  : "Fills itself from your records"}
          </span>
        </p>
      </div>
    </section>
  );
}

function FolderBody({ view, demoMode }: { view: Extract<TermFolderView, { kind: "ready" }>; demoMode: boolean }) {
  const { folder } = view;
  const sections = folderSections(folder);
  const early = folderIsEarly(view.term, view.today);
  const coming = folderComingUp(view.term, view.today);
  return (
    <>
      <p className="hidden text-sm print:block">{`${folder.title} evidence folder, printed ${dayMonth(view.today)}`}</p>
      {view.requestedMissing ? (
        <T5Note tone="warning" icon="alert" className="mt-3" testId="term-folder-missing-term">
          {`That term is no longer on this phone. Showing ${folder.title}.`}
        </T5Note>
      ) : null}
      {view.failed.length > 0 ? (
        <T5Note tone="warning" icon={view.offline ? "offline" : "alert"} className="mt-3" testId="term-folder-failed">
          {view.offline
            ? "No connection. The parts that need it show as not updating. "
            : `${view.failed.length === 2 ? "Check-ins and supervision logs" : view.failed[0] === "attendance" ? "Check-ins" : "Supervision logs"} did not load, so that part shows as not updating${folder.parts.some((p) => p.status === "not_updating" && p.detail.startsWith("As of ")) ? " and keeps its last good figures" : ""}. `}
          <T5Link onClick={view.retry}>Try again</T5Link>
        </T5Note>
      ) : null}
      <FolderCard view={view} demoMode={demoMode} />
      {early && folder.counts.to_fix === 0 ? (
        <T5Note icon="shield" className="mt-3" testId="term-folder-early">
          Nothing to fix yet. Each part fills itself from your records as the term runs. You do not upload anything.
        </T5Note>
      ) : null}
      {sections.map((section) => (
        <T5Section
          key={section.status}
          label={`${folderSectionLabels[section.status]} · ${section.parts.length}`}
          testId={`term-folder-${section.status}`}
        >
          <T5List ruled>
            {section.parts.map((part) => (
              <T5Row
                key={part.id}
                title={part.label}
                meta={part.detail}
                lead={<FolderIconCircle icon={FOLDER_ICONS[part.icon]} status={part.status} />}
                href={part.href}
                end={<FolderTag status={part.status} />}
              />
            ))}
          </T5List>
        </T5Section>
      ))}
      {coming.length > 0 ? (
        <T5Section label="Coming up" testId="term-folder-coming">
          <T5List ruled>
            {coming.map((item) => (
              <T5Row
                key={`${item.date}-${item.title}`}
                title={item.title}
                meta={`${weekdayDayMonth(item.date)} · ${item.detail}`}
                lead={<FolderIconCircle icon={CalendarDays} status="on_track" />}
              />
            ))}
          </T5List>
        </T5Section>
      ) : null}
      <T5Section label="Not kept here" testId="term-folder-not-kept">
        <T5List ruled>
          <T5Row
            title="Assessment forms"
            meta={FOLDER_NOT_KEPT_LINE}
            lead={<FolderIconCircle icon={ShieldCheck} status="not_started" />}
            href={FOLDER_CLA_URL}
            external
            end={<ExternalLink aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />}
          />
        </T5List>
      </T5Section>
      {view.earlier.length > 0 ? (
        <T5Section label="Other terms" testId="term-folder-earlier">
          <ul role="list" className="grid grid-cols-1 gap-2 min-[26rem]:grid-cols-2" data-print-hide>
            {view.earlier.map((term) => (
              <li key={term.id} className="min-w-0">
                <Link
                  href={`${TERM_FOLDER_PATH}?term=${encodeURIComponent(term.id)}`}
                  className={cn(
                    "flex min-h-12 items-center gap-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-2 no-underline",
                    focusRing,
                  )}
                >
                  <Folder aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--mode-identity)]" />
                  <span className="grid min-w-0">
                    <span className="truncate text-sm font-medium text-[color:var(--text-heading)]">
                      {folderTermTitle(term)}
                    </span>
                    <span className="nums truncate text-xs font-normal text-[color:var(--text-muted)]">
                      {`${dayMonth(term.startsOn)} to ${dayMonth(term.endsOn)} ${term.startsOn.slice(0, 4)}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </T5Section>
      ) : null}
      <T5Note icon="shield" className="mt-4">
        {`${FOLDER_PRIVACY_LINE} Built from your check-ins, supervision logs and the term you keep on this phone. Nothing new is saved.`}
      </T5Note>
      <T5Meta className="mt-1 text-xs">
        {`${withUnit(folder.sessions.length, folder.sessions.length === 1 ? "session" : "sessions")} and ${withUnit(folder.supervision.length, folder.supervision.length === 1 ? "supervision entry" : "supervision entries")} go into the CSV.`}
      </T5Meta>
    </>
  );
}

function NoTerm() {
  return (
    <div className="mt-3">
      <WorkEmpty
        icon={Folder}
        testId="term-folder-no-term"
        title={
          <span role="heading" aria-level={2}>
            Set up your term first
          </span>
        }
        body="The folder fills itself from your term dates, teaching check-ins and supervision logs. You do not upload anything."
        action={<WorkButton href="/teaching/term">Set up your term</WorkButton>}
      />
    </div>
  );
}

function TermFolderContent({ demoMode, termId }: { demoMode: boolean; termId: string | null }) {
  const view = useTermFolder(demoMode, termId);
  let body;
  if (view.kind === "signed-out") body = <TeachingSignInNotice />;
  else if (view.kind === "loading") body = <ModeModuleSkeleton rows={4} />;
  else if (view.kind === "no-term") body = <NoTerm />;
  else body = <FolderBody view={view} demoMode={demoMode} />;
  return (
    <InformationPageShell width="narrow" gap={false} testId="term-folder">
      <T5Page>
        <h1 className="sr-only">Term evidence folder</h1>
        {demoMode ? (
          <T5Note className="mt-0 mb-1">Made-up demo. Nothing here is your data, and nothing is saved.</T5Note>
        ) : null}
        {body}
      </T5Page>
    </InformationPageShell>
  );
}

/** Account changes reset the page, as every Teaching page does (TeachingAccountPage). */
export function TermFolderPage({ demoMode, termId }: { demoMode: boolean; termId: string | null }) {
  const auth = useAuthSession();
  const demo = useTeachingDemoMode(demoMode);
  return <TermFolderContent key={`${auth.authEpoch}:${demo}`} demoMode={demo} termId={termId} />;
}

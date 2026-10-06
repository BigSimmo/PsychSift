"use client";

import { Copy, Download, ExternalLink, Folder, Printer, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { csvHref } from "@/components/teaching/organise-model";
import { T5Link, T5List, T5Meta, T5Note, T5Page, T5Row, T5Section } from "@/components/teaching/t5-kit";
import { withUnit } from "@/components/teaching/teaching-number";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import {
  FOLDER_ICONS,
  FolderIconCircle,
  FolderMeter,
  FolderTag,
} from "@/components/teaching/term-folder/term-folder-parts";
import { useTermFolder, type TermFolderView } from "@/components/teaching/term-folder/use-term-folder";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";
import { buttonFaceClass } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
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
  folderTermTitle,
  TERM_FOLDER_PATH,
  termFolderCsv,
  termFolderFileName,
  type TermFolder,
} from "@/lib/teaching/term-folder";
import { dayMonth } from "@/lib/teaching/term-tracker";

/*
 * Term evidence folder, /teaching/term/folder (feature 12, mock-up nf_teach_acc). The doctor's own term
 * in one standing folder: a folder tab, a completeness meter with one segment per part, then the parts
 * that need action first. It fills itself from records PsychSift already holds and saves nothing new.
 * Download CSV and Print hand it to a supervisor or an accreditation visit; Copy summary is for an email.
 * Status and counts only: assessment content is never here.
 */

const secondaryButton = cn(buttonFaceClass({ variant: "secondary" }), "no-underline");

/** A short plain-text summary for an email to a supervisor. */
export function folderSummaryText(folder: TermFolder): string {
  return [
    `${folder.title} evidence folder`,
    folder.dates,
    folder.supervisor ? `Supervisor: ${folder.supervisor}` : null,
    `${folder.headline}. ${folder.meterLabel}`,
    "",
    ...folder.parts.map((part) => `${part.label}: ${folderStatusWords[part.status]}. ${part.detail}.`),
    "",
    FOLDER_PRIVACY_LINE,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function FolderActions({ folder, demoMode, today }: { folder: TermFolder; demoMode: boolean; today: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="grid gap-2" data-print-hide>
      <div className="grid grid-cols-2 gap-2">
        <a
          href={csvHref(termFolderCsv(folder, today))}
          download={termFolderFileName(folder, demoMode)}
          className={cn(buttonFaceClass({ variant: "primary" }), "no-underline")}
          data-testid="term-folder-csv"
        >
          <Download aria-hidden="true" className="size-icon-sm" />
          Download CSV
        </a>
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
      <button
        type="button"
        className={cn(
          "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-sm text-sm font-semibold text-[color:var(--mode-identity)]",
          focusRing,
        )}
        onClick={async () => {
          try {
            await copyTextToClipboard(folderSummaryText(folder));
            setCopied("copied");
            announce("Summary copied");
          } catch {
            setCopied("failed");
            announce("Copy did not work. Use Download CSV instead.");
          }
        }}
      >
        <Copy aria-hidden="true" className="size-icon-sm" />
        {copied === "copied" ? "Summary copied" : "Copy summary for an email"}
      </button>
      {copied === "failed" ? (
        <p role="status" className="text-center text-sm text-[color:var(--text-heading)]">
          Copy did not work on this browser. Use Download CSV instead.
        </p>
      ) : null}
    </div>
  );
}

/** The signature: a folder with its tab, the term, the meter and the export controls. */
function FolderCard({
  view,
  demoMode,
}: {
  view: Extract<TermFolderView, { kind: "ready" }>;
  demoMode: boolean;
}) {
  const { folder, today } = view;
  const tab = folder.phase === "during" ? "Now" : folder.phase === "ended" ? "Ended" : "Coming up";
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
        <FolderActions folder={folder} demoMode={demoMode} today={today} />
        <p className="flex items-center gap-1.5 border-t border-[color:var(--border)] pt-2.5 text-xs text-[color:var(--text-muted)]">
          <ShieldCheck aria-hidden="true" className="size-icon-xs shrink-0" />
          <span className="nums font-normal">
            {view.updatedAt ? `Fills itself · updated ${view.updatedAt}` : "Fills itself from your records"}
          </span>
        </p>
      </div>
    </section>
  );
}

function FolderBody({ view, demoMode }: { view: Extract<TermFolderView, { kind: "ready" }>; demoMode: boolean }) {
  const { folder } = view;
  const sections = folderSections(folder);
  return (
    <>
      <p className="hidden text-sm print:block">{`${folder.title} evidence folder, printed ${dayMonth(view.today)}`}</p>
      {view.failed.length > 0 ? (
        <T5Note tone="warning" icon={view.offline ? "offline" : "alert"} className="mt-3" testId="term-folder-failed">
          {view.offline
            ? "No connection. The parts that need it show as not updating. "
            : `${view.failed.length === 2 ? "Check-ins and supervision logs" : view.failed[0] === "attendance" ? "Check-ins" : "Supervision logs"} did not load, so that part shows as not updating. `}
          <T5Link onClick={view.retry}>Try again</T5Link>
        </T5Note>
      ) : null}
      <FolderCard view={view} demoMode={demoMode} />
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
    <section
      data-testid="term-folder-no-term"
      className="mt-3 grid justify-items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-4 py-6 text-center"
    >
      <span
        aria-hidden="true"
        className="grid size-11 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <Folder aria-hidden="true" className="size-icon-md" strokeWidth={1.75} />
      </span>
      <h2 className="text-base font-semibold text-[color:var(--text-heading)]">Set up your term first</h2>
      <p className="max-w-80 text-sm text-[color:var(--text-muted)]">
        The folder fills itself from your term dates, teaching check-ins and supervision logs. You do not upload
        anything.
      </p>
      <Link href="/teaching/term" className={cn(buttonFaceClass({ variant: "primary" }), "mt-1 no-underline")}>
        Set up your term
      </Link>
    </section>
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

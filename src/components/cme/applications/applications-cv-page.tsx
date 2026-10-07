"use client";

import {
  Award,
  BookOpen,
  Briefcase,
  ClipboardCheck,
  Copy,
  Eye,
  EyeOff,
  GraduationCap,
  PenLine,
  Plus,
  Printer,
  RefreshCw,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import {
  ActionDock,
  CpdFeaturePage,
  type CpdFeatureBack,
  flatCard,
  PatientDetailCatch,
  QuietNote,
  useUndoNotice,
} from "@/components/cme/cpd-feature-kit";
import { WorkButton } from "@/components/mode-kit/work";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Sheet } from "@/components/ui/sheet";
import { cn, fieldControlPlain } from "@/components/ui-primitives";
import { applicationTextProblem, sampleApplications, STATEMENT_LIMIT } from "@/lib/cme/applications";
import {
  buildCv,
  cvLineCount,
  cvPlainText,
  cvRangeLabels,
  cvSourceLabels,
  toggleHiddenLine,
  type CvAttended,
  type CvRange,
  type CvRegistration,
  type CvSource,
  type CvSupervising,
  type CvTalk,
  type CvTerm,
} from "@/lib/cme/applications-cv";
import { selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { ADMIN_REQUIREMENTS_CATALOGUE, requirementChecklistRows } from "@/lib/admin/requirements";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { useApplicationsStore } from "@/lib/cme/device-record";
import type { CmeEntry } from "@/lib/cme/types";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { demoTeachingLogbook } from "@/lib/teaching/demo-programme";
import { demoSupervision, demoTeach } from "@/lib/teaching/depth-demo";
import type { SupervisionPairingView, TeachRead } from "@/lib/teaching/depth-model";
import type { LogbookRow } from "@/lib/teaching/model";
import { sampleTermTracker } from "@/lib/teaching/term-tracker";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";
import { guardExampleAction } from "@/lib/example-data/guards";

/** The page's parent, where its link lives. */
const CV_BACK: CpdFeatureBack = { href: "/cme/applications", label: "Job applications" };

const SOURCE_ICON: Record<CvSource, typeof Award> = {
  admin: Briefcase,
  terms: GraduationCap,
  teaching: BookOpen,
  assessments: ClipboardCheck,
  cpd: Award,
  you: PenLine,
};

/** Where each source's line takes its tint from: the area it comes from. */
const SOURCE_MODE: Record<CvSource, string> = {
  admin: "my-work",
  terms: "teaching",
  teaching: "teaching",
  assessments: "teaching",
  cpd: "cme",
  you: "cme",
};

const REGISTRATION_ITEM_ID = "medical-registration-renewal";

function savePdf() {
  const previousTitle = document.title;
  document.title = "CV";
  const restore = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

function clock(now: Date): string {
  const perth = new Date(now.getTime() + 8 * 3_600_000);
  return `${String(perth.getUTCHours()).padStart(2, "0")}:${String(perth.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * THE CV THAT FILLS ITSELF (#22). Lines come only from records the doctor
 * already keeps here: terms (Teaching's term tracker, this device), teaching
 * they gave (Teaching), and CPD hours and outcome work (their CPD log). The
 * personal statement is only ever their own words. Any line can be hidden.
 */
export function ApplicationsCvPage({
  entries,
  cpdFailed,
  demoMode,
  now,
}: {
  readonly entries: readonly CmeEntry[];
  /** The CPD records did not load: say so, never show zero hours. */
  readonly cpdFailed: boolean;
  readonly demoMode: boolean;
  readonly now: Date;
}) {
  const router = useRouter();
  const today = perthCalendarDate(now);
  const notify = useUndoNotice();
  const applicationsSample = useMemo(() => (demoMode ? sampleApplications(today) : null), [demoMode, today]);
  const store = useApplicationsStore(applicationsSample);
  const termSample = useMemo(() => (demoMode ? sampleTermTracker(today) : null), [demoMode, today]);
  const { state: termState } = useTermTrackerStore(termSample);
  const teach = useTeachingResource<TeachRead>(demoMode ? null : "/api/teaching/depth?view=teach");
  const logbook = useTeachingResource<{ attendance: LogbookRow[] }>(demoMode ? null : "/api/teaching?view=logbook");
  const supervision = useTeachingResource<{ pairings: SupervisionPairingView[] }>(
    demoMode ? null : "/api/teaching/depth?view=supervision",
  );
  const onCall = useOnCallEntries();
  const talks: CvTalk[] = useMemo(() => {
    if (demoMode) return demoTeach(today, now).taught;
    return teach.data?.taught ?? [];
  }, [demoMode, now, teach.data, today]);
  const attended: CvAttended[] = useMemo(() => {
    if (demoMode) return demoTeachingLogbook(now);
    return logbook.data?.attendance ?? [];
  }, [demoMode, logbook.data, now]);
  const supervising: CvSupervising[] = useMemo(() => {
    const pairings = demoMode ? demoSupervision(today) : (supervision.data?.pairings ?? []);
    // The pairing's dates only: the registrar's name never reaches the CV.
    return pairings
      .filter((pairing) => pairing.access === "supervisor")
      .map(({ pairingId, startsOn, endsOn }) => ({ pairingId, startsOn, endsOn }));
  }, [demoMode, supervision.data, today]);
  const adminFailed = !onCall.loading && Boolean(onCall.loadError);
  const registration: CvRegistration | null = useMemo(() => {
    if (onCall.loading || onCall.loadError) return null;
    const row = requirementChecklistRows(ADMIN_REQUIREMENTS_CATALOGUE, selectAdminOwnEntries(onCall)).find(
      (candidate) => candidate.item.id === REGISTRATION_ITEM_ID,
    );
    return row?.expiresOn ? { expiresOn: row.expiresOn } : null;
  }, [onCall]);
  const terms: readonly CvTerm[] = useMemo(() => termState?.terms ?? [], [termState]);
  const [range, setRange] = useState<CvRange>("two");
  const [statementOpen, setStatementOpen] = useState(false);

  const statement = store.state?.statement ?? "";
  const hidden = useMemo(() => new Set(store.state?.hiddenCvLines ?? []), [store.state?.hiddenCvLines]);
  const sections = useMemo(
    () =>
      buildCv({
        entries: cpdFailed ? [] : entries,
        terms,
        talks,
        attended,
        supervising,
        registration,
        statement,
        range,
        today,
      }),
    [attended, cpdFailed, entries, range, registration, statement, supervising, talks, terms, today],
  );
  const lineCount = cvLineCount(sections);
  const plain = cvPlainText(sections, hidden);
  // Teaching is one source to the reader: any of its three reads failing says so once.
  const teachingReads = [teach, logbook, supervision];
  const teachingState = demoMode
    ? "ready"
    : teachingReads.some((read) => read.status === "loading" || read.status === "idle")
      ? "loading"
      : teachingReads.some((read) => read.status === "offline")
        ? "offline"
        : teachingReads.some((read) => read.status === "error" || read.status === "setup")
          ? "error"
          : "ready";
  const retryTeaching = () => {
    for (const read of teachingReads) if (read.status !== "ready") read.retry();
  };

  function toggle(id: string, title: string) {
    const wasHidden = hidden.has(id);
    store.update((current) => ({ ...current, hiddenCvLines: toggleHiddenLine(current.hiddenCvLines, id) }));
    notify(`${title.length > 40 ? `${title.slice(0, 40)}…` : title} ${wasHidden ? "shown" : "hidden"}`);
  }

  async function copyText() {
    if (!plain.shownCount) {
      notify("Nothing to copy. Every line is hidden.");
      return;
    }
    try {
      await copyTextToClipboard(`Curriculum vitae\n\n${plain.text}\n`);
      const hiddenWords = plain.hiddenCount
        ? `, ${plain.hiddenCount} ${plain.hiddenCount === 1 ? "line" : "lines"} hidden`
        : "";
      const heldWords = plain.heldBackCount
        ? `. ${plain.heldBackCount} left out, the title looks like a patient detail`
        : "";
      notify(`CV copied as plain text${hiddenWords}${heldWords}`);
    } catch {
      notify("Could not copy. Save it as a PDF instead.");
    }
  }

  return (
    <CpdFeaturePage
      back={CV_BACK}
      eyebrow={
        hidden.size
          ? `${plain.hiddenCount} ${plain.hiddenCount === 1 ? "line" : "lines"} hidden`
          : `Filled from your records · ${clock(now)}`
      }
      title="CV"
      testId="applications-cv-page"
    >
      <style>{`@media print {
        html:has(.cpd-cv-print), body:has(.cpd-cv-print), body:has(.cpd-cv-print) *:has(.cpd-cv-print) {
          display: block !important; position: static !important; overflow: visible !important; height: auto !important;
          max-height: none !important; transform: none !important; background: white !important; padding: 0 !important; margin: 0 !important;
        }
        body:has(.cpd-cv-print) *:not(.cpd-cv-print):not(.cpd-cv-print *):not(:has(.cpd-cv-print)) { display: none !important; }
        .cpd-cv-print, .cpd-cv-print * { color: black !important; box-shadow: none !important; }
        .cpd-cv-print [data-cv-hidden="true"], .cpd-cv-print .cpd-cv-screen-only { display: none !important; }
        .cpd-cv-print section { break-inside: avoid; }
      }`}</style>

      {store.mode === "sample" ? (
        <QuietNote icon={Shield}>Sample CV from made-up records. Nothing is kept.</QuietNote>
      ) : null}

      <div role="group" aria-label="Years to include" className="flex flex-wrap gap-2" data-no-tab-swipe>
        {(Object.keys(cvRangeLabels) as CvRange[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={range === value}
            onClick={() => setRange(value)}
            data-testid={`applications-cv-range-${value}`}
            className={cn(
              focusRing,
              "inline-flex min-h-12 items-center rounded-full border px-4 text-sm",
              range === value
                ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)] font-medium text-[color:var(--mode-identity)]"
                : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
            )}
          >
            {cvRangeLabels[value]}
          </button>
        ))}
      </div>

      <ul
        aria-label="Where each line comes from"
        className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-[color:var(--text-muted)]"
      >
        {(Object.keys(cvSourceLabels) as CvSource[]).map((source) => {
          const Icon = SOURCE_ICON[source];
          return (
            <li key={source} className="inline-flex items-center gap-1.5" data-mode-identity={SOURCE_MODE[source]}>
              <Icon aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-[color:var(--mode-identity)]" />
              {cvSourceLabels[source]}
            </li>
          );
        })}
      </ul>

      {cpdFailed ? (
        <LoadProblem
          testId="applications-cv-cpd-failed"
          text="Your CPD records did not load, so no CPD lines show. Nothing was changed."
          onRetry={() => router.refresh()}
        />
      ) : null}
      {teachingState === "error" || teachingState === "offline" ? (
        <LoadProblem
          testId="applications-cv-teaching-failed"
          text={
            teachingState === "offline"
              ? "You are offline, so teaching lines are not shown."
              : "Teaching did not load, so teaching lines are not shown."
          }
          onRetry={retryTeaching}
        />
      ) : null}
      {adminFailed ? (
        <LoadProblem
          testId="applications-cv-admin-failed"
          text={
            onCall.loadError === "offline"
              ? "You are offline, so your registration date from Admin is not shown."
              : "Admin did not load, so your registration date is not shown."
          }
          onRetry={onCall.retry}
        />
      ) : null}

      {/* A row control reached by Tab scrolls clear of the sticky Copy and Save as PDF dock, not under it. */}
      <article
        className={cn(
          flatCard,
          "cpd-cv-print overflow-hidden [--phone-focus-bottom-clearance:calc(5.5rem+max(0.875rem,var(--safe-area-bottom)))]",
        )}
        data-testid="applications-cv"
      >
        <header className="border-b border-[color:var(--border)] px-3 py-3">
          <h2 className="text-lg font-semibold text-[color:var(--text-heading)]">Curriculum vitae</h2>
          <p className="cpd-cv-screen-only text-sm text-[color:var(--text-muted)]">
            From your PsychSift records. Add your name and contact details in your own copy.
          </p>
        </header>
        {lineCount === 0 && teachingState !== "loading" ? (
          <div className="grid gap-3 px-3 py-6 text-center" data-testid="applications-cv-empty">
            <p className="text-base-minus font-medium text-[color:var(--text-heading)]">Nothing to fill it with yet</p>
            <p className="text-sm text-[color:var(--text-muted)]">
              Log CPD, set up your term in Teaching, or add a statement, and lines appear here.
            </p>
            <span className="flex flex-wrap justify-center gap-2">
              <Link
                href="/cme/new"
                className={cn(
                  focusRing,
                  "inline-flex min-h-12 items-center px-2 text-sm text-[color:var(--mode-identity)] underline underline-offset-4",
                )}
              >
                Log an activity
              </Link>
              <Link
                href="/teaching/term"
                className={cn(
                  focusRing,
                  "inline-flex min-h-12 items-center px-2 text-sm text-[color:var(--mode-identity)] underline underline-offset-4",
                )}
              >
                Set up your term
              </Link>
            </span>
          </div>
        ) : null}
        {sections.map((section) => (
          <section key={section.id} aria-label={section.title} className="pb-1">
            <h3 className="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-label text-[color:var(--mode-identity)]">
              {section.title}
            </h3>
            <ul role="list">
              {section.lines.map((line) => {
                const held = line.heldBack;
                const isHidden = hidden.has(line.id) || Boolean(held);
                const Icon = SOURCE_ICON[line.source];
                return (
                  <li
                    key={line.id}
                    data-cv-hidden={isHidden}
                    data-cv-held={held ? true : undefined}
                    data-testid="applications-cv-line"
                    className="flex min-h-12 min-w-0 items-center gap-2 px-3"
                  >
                    <span className="grid min-w-0 flex-1 py-1">
                      <span
                        className={cn(
                          "whitespace-pre-line break-words text-sm font-medium leading-5",
                          // Hidden lines keep full-strength text (4.5:1) and say "Hidden" in words.
                          isHidden ? "text-[color:var(--text-muted)] line-through" : "text-[color:var(--text-heading)]",
                        )}
                      >
                        {line.title}
                      </span>
                      {held ? (
                        <span
                          className="text-xs leading-4 text-[color:var(--warning)]"
                          data-testid="applications-cv-held"
                        >
                          Title looks like a patient detail, so it is left out of copies and print.{" "}
                          <Link
                            href={held.fixHref}
                            className={cn(focusRing, "inline-flex min-h-12 items-center underline underline-offset-4")}
                          >
                            Edit it in {held.fixIn}
                          </Link>
                        </span>
                      ) : isHidden ? (
                        <span className="text-xs leading-4 text-[color:var(--text-muted)]">
                          Hidden{line.sub ? ` · ${line.sub}` : ""}
                          <span className="sr-only">, left out of copies and print.</span>
                        </span>
                      ) : line.sub ? (
                        <span className="text-xs leading-4 text-[color:var(--text-muted)]">{line.sub}</span>
                      ) : null}
                    </span>
                    <span
                      role="img"
                      aria-label={`From ${cvSourceLabels[line.source]}`}
                      data-mode-identity={SOURCE_MODE[line.source]}
                      className="cpd-cv-screen-only grid size-6 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
                    >
                      <Icon aria-hidden="true" strokeWidth={1.75} className="size-3" />
                    </span>
                    {held ? null : (
                      <button
                        type="button"
                        aria-pressed={hidden.has(line.id)}
                        aria-label={`Hide ${line.title.slice(0, 60)}`}
                        onClick={() => toggle(line.id, line.title)}
                        data-testid="applications-cv-hide"
                        className={cn(
                          focusRing,
                          "cpd-cv-screen-only inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-md text-[color:var(--text-muted)]",
                        )}
                      >
                        {hidden.has(line.id) ? (
                          <EyeOff aria-hidden="true" strokeWidth={1.75} className="size-icon-sm" />
                        ) : (
                          <Eye aria-hidden="true" strokeWidth={1.75} className="size-icon-sm" />
                        )}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {teachingState === "loading" ? (
          <p role="status" className="cpd-cv-screen-only px-3 py-3 text-sm text-[color:var(--text-muted)]">
            Loading your teaching
          </p>
        ) : null}
        <div className="cpd-cv-screen-only px-3 pb-3 pt-1">
          <button
            type="button"
            onClick={() => setStatementOpen(true)}
            data-testid="applications-cv-statement"
            disabled={!store.state}
            className={cn(
              focusRing,
              "flex min-h-12 w-full items-center gap-3 rounded-lg border-2 border-dashed border-[color:var(--border-strong)] px-3 py-2 text-left",
            )}
          >
            <span className="grid min-w-0 flex-1">
              <span className="text-sm font-medium text-[color:var(--text-heading)]">
                {statement ? "Change your personal statement" : "Add a short personal statement"}
              </span>
              <span className="text-xs text-[color:var(--text-muted)]">Never filled in for you</span>
            </span>
            {statement ? (
              <PenLine aria-hidden="true" className="size-icon-sm text-[color:var(--mode-identity)]" />
            ) : (
              <Plus aria-hidden="true" className="size-icon-sm text-[color:var(--mode-identity)]" />
            )}
          </button>
        </div>
      </article>

      <QuietNote icon={Shield}>No patient details. Check it before you send.</QuietNote>

      <ActionDock testId="applications-cv-dock">
        <WorkButton variant="secondary" icon={Copy} onClick={copyText} testId="applications-cv-copy">
          Copy as text
        </WorkButton>
        <WorkButton
          icon={Printer}
          onClick={() => {
            // Example records never leave the app, printed included.
            if (!guardExampleAction(demoMode, "export")) return;
            if (plain.heldBackCount)
              notify(
                `${plain.heldBackCount} ${plain.heldBackCount === 1 ? "line" : "lines"} left out of the PDF, the title looks like a patient detail`,
              );
            savePdf();
          }}
          testId="applications-cv-pdf"
        >
          Save as PDF
        </WorkButton>
      </ActionDock>

      <StatementSheet
        open={statementOpen}
        initial={statement}
        onClose={() => setStatementOpen(false)}
        onSave={(text) => {
          const before = store.state;
          if (store.update((current) => ({ ...current, statement: text }))) {
            setStatementOpen(false);
            notify(
              text ? "Statement saved" : "Statement removed",
              // Undo puts back the statement only, so a line hidden since stays hidden.
              before ? () => store.update((current) => ({ ...current, statement: before.statement })) : undefined,
            );
          }
        }}
      />
    </CpdFeaturePage>
  );
}

function LoadProblem({
  text,
  onRetry,
  testId,
}: {
  readonly text: string;
  readonly onRetry: () => void;
  readonly testId: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(flatCard, "flex flex-wrap items-center gap-3 border-[color:var(--warning-border)] p-3")}
    >
      <span className="min-w-0 flex-1 basis-48 text-sm text-[color:var(--text)]">{text}</span>
      <Button size="sm" icon={RefreshCw} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function StatementSheet({
  open,
  initial,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  readonly initial: string;
  readonly onClose: () => void;
  readonly onSave: (text: string) => void;
}) {
  return open ? <StatementSheetBody initial={initial} onClose={onClose} onSave={onSave} /> : null;
}

function StatementSheetBody({
  initial,
  onClose,
  onSave,
}: {
  readonly initial: string;
  readonly onClose: () => void;
  readonly onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const problem = applicationTextProblem(text);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Personal statement"
      description="In your own words. PsychSift never writes it for you."
      testId="applications-statement-sheet"
      footer={
        <Button
          variant="primary"
          block
          disabled={Boolean(problem)}
          onClick={() => onSave(text.trim())}
          testId="applications-statement-save"
        >
          {text.trim() ? "Save statement" : initial ? "Remove statement" : "Save statement"}
        </Button>
      }
    >
      <div className="grid gap-3">
        <FormField label="Statement" hint={`Up to ${STATEMENT_LIMIT} characters. No patient details.`}>
          {(field) => (
            <textarea
              id={field.id}
              aria-describedby={field.describedBy}
              aria-invalid={problem ? true : undefined}
              value={text}
              maxLength={STATEMENT_LIMIT}
              rows={6}
              onChange={(event) => setText(event.target.value)}
              data-testid="applications-statement-text"
              className={cn(fieldControlPlain, "min-h-32 py-2")}
            />
          )}
        </FormField>
        <p className="text-right text-xs text-[color:var(--text-muted)]">
          <span className="nums">{text.length}</span> of <span className="nums">{STATEMENT_LIMIT}</span>
        </p>
        <PatientDetailCatch problem={problem} testId="applications-statement-problem" />
      </div>
    </Sheet>
  );
}

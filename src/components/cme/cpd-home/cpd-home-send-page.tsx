"use client";

import {
  Check,
  ChevronDown,
  Clock,
  Download,
  Eye,
  FileText,
  History,
  Lock,
  Share2,
  Shield,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import {
  ActionDock,
  CopyIconButton,
  CpdFeaturePage,
  type CpdFeatureBack,
  DateTile,
  flatCard,
  flatRow,
  FlatSwitch,
  IconCircle,
  PendingTag,
  QuietNote,
  SectionLabel,
  Tag,
  useUndoNotice,
} from "@/components/cme/cpd-feature-kit";
import { CpdHomeHandoffStrip } from "@/components/cme/cpd-home/cpd-home-handoff-strip";
import { WorkButton } from "@/components/mode-kit/work";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { formatCmeRowDate, perthCalendarDate } from "@/lib/cme/cpd-year";
import { useOnlineStatus } from "@/lib/use-online-status";
import {
  cpdHomeActivityText,
  cpdHomeAllText,
  cpdHomeFileName,
  cpdHomeFilesForYear,
  cpdHomeRowProblems,
  cpdHomeRows,
  CPD_HOME_CHECK_CHUNK,
  EMPTY_CPD_HOME_SEND,
  entriesNotYetAdded,
  formatCpdHomeCsv,
  formatCpdHomeTable,
  lastAddedFile,
  markCpdHomeFileAdded,
  recordCpdHomeFile,
  reflectionsToLeaveOut,
  removeCpdHomeFile,
  titlesToHoldBack,
  unmarkCpdHomeFileAdded,
  type CpdHomeFile,
  type CpdHomeScope,
} from "@/lib/cme/cpd-home-send";
import { activeCmeYearEntries } from "@/lib/cme/export";
import { useCpdHomeSendStore } from "@/lib/cme/device-record";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

/** The page's parent, where its link lives. */
const CPD_HOME_BACK: CpdFeatureBack = { href: "/cme/summary", label: "CPD summary" };

export type CpdHomeSendPageProps = {
  readonly set: CmeRequirementSet;
  readonly entries: readonly CmeEntry[];
  readonly availableYears: readonly number[];
  readonly demoMode: boolean;
  readonly now: Date;
};

const PREVIEW_ROWS = 4;
const LIST_COLLAPSED = 6;
/** Files of the year listed before "Show older". Every file stays reachable, so any can be marked added. */
const FILES_COLLAPSED = 5;
/** One small batch of rows is checked per tick, so the progress bar can be drawn between them. */
const CHECK_STEP_MS = 16;

/**
 * The file sheet: checking rows (with Cancel), then the file ready to download, then the saved
 * file and its next steps. The download itself always starts from a tap ("Download file"), never
 * from a timer, because a browser may quietly block a download that no tap started.
 */
type FileFlow =
  | { readonly phase: "making"; readonly done: number; readonly total: number; readonly name: string }
  | { readonly phase: "ready"; readonly file: CpdHomeFile; readonly text: string }
  | { readonly phase: "saved"; readonly file: CpdHomeFile; readonly text: string };

/** Why no file was made, in words, and whether trying again could help. */
type Failure = { readonly title: string; readonly body: string; readonly retry: boolean };

function hoursWords(value: number): string {
  return `${Math.round(value * 100) / 100} h`;
}

function activityWords(count: number): string {
  return `${count} ${count === 1 ? "activity" : "activities"}`;
}

function timeOf(iso: string): string {
  const perth = new Date(Date.parse(iso) + 8 * 3_600_000);
  return `${String(perth.getUTCHours()).padStart(2, "0")}:${String(perth.getUTCMinutes()).padStart(2, "0")}`;
}

function newFileId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `file-${Date.now().toString(36)}-${random}`;
}

/** Saves text as a file through the browser's own download. False when the browser refused. */
function saveTextFile(name: string, text: string): boolean {
  try {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return true;
  } catch {
    return false;
  }
}

function canShareFile(name: string, text: string): File | null {
  try {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function" || !navigator.canShare) return null;
    const file = new File([text], name, { type: "text/csv" });
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}

/**
 * SEND CPD TO AMA CPD HOME (#11).
 *
 * Makes a plain CSV of the year's activities on this device, with a preview,
 * a copy of each activity and of all of them, and a record of the files made.
 * It never sends anything and never claims CPD Home accepts the file: what
 * AMA CPD Home can import has not been checked, and the page says so first.
 */
export function CpdHomeSendPage({ set, entries, availableYears, demoMode, now }: CpdHomeSendPageProps) {
  const today = perthCalendarDate(now);
  const thisYear = Number(today.slice(0, 4));
  const sample = useMemo(() => (demoMode ? EMPTY_CPD_HOME_SEND : null), [demoMode]);
  const store = useCpdHomeSendStore(sample);
  const notify = useUndoNotice();
  const online = useOnlineStatus();
  const yearEntries = useMemo(() => activeCmeYearEntries(entries, set.year), [entries, set.year]);
  const history = store.state ? cpdHomeFilesForYear(store.state, set.year) : [];
  const lastAdded = store.state ? lastAddedFile(store.state, set.year) : null;
  const notYetAdded = useMemo(
    () => (store.state ? entriesNotYetAdded(entries, store.state, set.year) : []),
    [entries, set.year, store.state],
  );

  // New since the last file is the sensible default once a file has been marked added.
  const [scopeChoice, setScopeChoice] = useState<CpdHomeScope | null>(null);
  const scope: CpdHomeScope = scopeChoice ?? (lastAdded && notYetAdded.length ? "new" : "all");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [includeReflections, setIncludeReflections] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showOlderFiles, setShowOlderFiles] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [flow, setFlow] = useState<FileFlow | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const making = useRef<{ cancelled: boolean } | null>(null);
  const saved = flow?.phase === "saved" ? flow : null;
  const ready = flow?.phase === "ready" ? flow : null;

  // Leaving the page part-way stops the check: nothing is saved and no file is made.
  useEffect(
    () => () => {
      if (making.current) making.current.cancelled = true;
    },
    [],
  );

  const scopeEntries = useMemo(() => {
    if (scope === "new") return notYetAdded;
    if (scope === "chosen") return yearEntries.filter((entry) => chosen.has(entry.id));
    return yearEntries;
  }, [chosen, notYetAdded, scope, yearEntries]);
  const scopeIds = useMemo(() => new Set(scopeEntries.map((entry) => entry.id)), [scopeEntries]);
  const rows = useMemo(() => cpdHomeRows(entries, set.year, scopeIds), [entries, scopeIds, set.year]);
  const problems = useMemo(() => cpdHomeRowProblems(rows, thisYear), [rows, thisYear]);
  // Titles go in every row of every file and copy, so a patient-like one keeps the activity out of all of them.
  const heldTitles = useMemo(() => titlesToHoldBack(scopeEntries, thisYear), [scopeEntries, thisYear]);
  const withheld = useMemo(
    () => (includeReflections ? reflectionsToLeaveOut(rows, thisYear) : new Set<string>()),
    [includeReflections, rows, thisYear],
  );
  const options = { includeReflections, withheldReflections: withheld };
  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const listed = showAll ? scopeEntries : scopeEntries.slice(-LIST_COLLAPSED).reverse();
  const writesKept = store.mode === "device";

  if (yearEntries.length === 0) {
    return (
      <CpdFeaturePage
        back={CPD_HOME_BACK}
        eyebrow={`Export your CPD log · ${set.year}`}
        title="AMA CPD Home"
        testId="cpd-home-page"
      >
        <section
          className={cn(flatCard, "grid justify-items-center gap-3 px-4 py-8 text-center")}
          data-testid="cpd-home-empty"
        >
          <IconCircle icon={FileText} />
          <h2 className="text-base-minus font-semibold text-[color:var(--text-heading)]">Nothing to send yet</h2>
          <p className="max-w-80 text-sm text-[color:var(--text-muted)]">
            Log an activity in {set.year} and it can go into a CSV file for CPD Home.
          </p>
          <Link href="/cme/new" className={buttonFaceClass({ variant: "primary" })} data-testid="cpd-home-log-first">
            Log an activity
          </Link>
        </section>
        <YearSwitch years={availableYears} year={set.year} />
      </CpdFeaturePage>
    );
  }

  function makeFile() {
    if (flow?.phase === "making") return;
    setFailure(null);
    if (rows.length === 0) {
      setFailure({ title: "No file was made", body: "Choose at least one activity first.", retry: false });
      announce("Choose at least one activity first.");
      return;
    }
    if (problems.length) {
      announce("No file was made. Some activities need fixing first.");
      return;
    }
    // A snapshot: what is checked is exactly what goes in the file, even if the page changes meanwhile.
    const fileRows = rows;
    const fileOptions = options;
    const name = cpdHomeFileName(set.year, scope, today);
    const total = fileRows.length;
    const token = { cancelled: false };
    making.current = token;
    setFlow({ phase: "making", done: 0, total, name });
    announce(`Making your file, ${total} ${total === 1 ? "row" : "rows"}`);

    let done = 0;
    const step = () => {
      if (token.cancelled) return;
      const next = Math.min(done + CPD_HOME_CHECK_CHUNK, total);
      // Each row is checked again for a date, hours, a category and a safe title. One gap stops the whole file.
      if (cpdHomeRowProblems(fileRows.slice(done, next), thisYear).length) {
        making.current = null;
        setFlow(null);
        setFailure({
          title: "No file was made",
          body: "An activity is missing its date, hours or category, or its title looks like a patient detail. Nothing was changed.",
          retry: false,
        });
        announce("No file was made. Some activities need fixing first.", { priority: "assertive" });
        return;
      }
      done = next;
      setFlow({ phase: "making", done, total, name });
      if (done < total) {
        window.setTimeout(step, CHECK_STEP_MS);
        return;
      }
      making.current = null;
      const text = formatCpdHomeCsv(fileRows, fileOptions);
      const file: CpdHomeFile = {
        id: newFileId(),
        year: set.year,
        madeAt: new Date().toISOString(),
        name,
        rows: total,
        entryIds: fileRows.map((row) => row.entryId),
        includeReflections: fileOptions.includeReflections,
        addedAt: null,
      };
      setFlow({ phase: "ready", file, text });
      announce(`File made, ${total} ${total === 1 ? "row" : "rows"}. Tap Download file.`);
    };
    window.setTimeout(step, CHECK_STEP_MS);
  }

  /** Runs inside the tap, so the browser treats the download as one the doctor asked for. */
  function downloadReady(file: CpdHomeFile, text: string) {
    if (!saveTextFile(file.name, text)) {
      setFlow(null);
      setFailure({
        title: "No file was made",
        body: "This browser did not save the file. Nothing was changed.",
        retry: true,
      });
      announce("No file was made. Try again.", { priority: "assertive" });
      return;
    }
    store.update((current) => recordCpdHomeFile(current, file));
    setFlow({ phase: "saved", file, text });
    announce("Download started. Check your downloads.");
  }

  function downloadAgain(file: CpdHomeFile, text: string) {
    if (saveTextFile(file.name, text)) announce("Download started again. Check your downloads.");
    else notify("This browser did not save the file. Try Share, or copy the activities instead.");
  }

  function cancelMaking() {
    if (making.current) making.current.cancelled = true;
    making.current = null;
    setFlow(null);
    announce("Cancelled. No file was made.");
  }

  function markAdded(file: CpdHomeFile) {
    const at = new Date().toISOString();
    if (!store.update((current) => markCpdHomeFileAdded(current, file.id, at))) return;
    setFlow(null);
    notify(`${activityWords(file.rows)} marked added to CPD Home`, () =>
      store.update((current) => unmarkCpdHomeFileAdded(current, file.id)),
    );
  }

  function markNotAdded(file: CpdHomeFile) {
    const previous = file.addedAt;
    if (!store.update((current) => unmarkCpdHomeFileAdded(current, file.id))) return;
    notify(`${file.name} marked not added`, () =>
      store.update((current) => (previous ? markCpdHomeFileAdded(current, file.id, previous) : current)),
    );
  }

  function removeFile(file: CpdHomeFile) {
    if (!store.update((current) => removeCpdHomeFile(current, file.id))) return;
    notify(`${file.name} removed from this list`, () => store.update((current) => recordCpdHomeFile(current, file)));
  }

  async function copyAll() {
    const copied = scopeEntries.filter((entry) => !heldTitles.has(entry.id)).length;
    if (copied === 0) {
      notify("Nothing copied. Edit the titles that look like a patient detail first.");
      return;
    }
    const text = cpdHomeAllText(scopeEntries, set, includeReflections, withheld, heldTitles);
    try {
      await copyTextToClipboard(text);
      notify(
        heldTitles.size
          ? `${activityWords(copied)} copied. ${activityWords(heldTitles.size)} left out, the title looks like a patient detail`
          : `${activityWords(copied)} copied, one after another`,
      );
    } catch {
      notify("Could not copy. Try again, or copy each activity on its own.");
    }
  }

  async function copyTable() {
    if (heldTitles.size) {
      notify("Not copied. Edit the titles that look like a patient detail first.");
      return;
    }
    try {
      await copyTextToClipboard(formatCpdHomeTable(rows, options));
      notify(`${rows.length} ${rows.length === 1 ? "row" : "rows"} copied as a table`);
    } catch {
      notify("Could not copy. Download the CSV instead.");
    }
  }

  // Short labels with the count in the control's count column, so all three fit at 320 px. The
  // full wording ("since 2 Mar") stays in the accessible name and in the Last file line above.
  const scopeOptions = [
    {
      value: "all" as const,
      label: "All",
      hint: `${yearEntries.length} ${yearEntries.length === 1 ? "activity" : "activities"} in ${set.year}`,
      hintLabel: String(yearEntries.length),
    },
    ...(lastAdded
      ? [
          {
            value: "new" as const,
            label: "New",
            hint: `${notYetAdded.length} new since ${formatCmeRowDate(perthCalendarDate(new Date(lastAdded.addedAt!)), today).replace(/^\w+ /, "")}`,
            hintLabel: String(notYetAdded.length),
          },
        ]
      : []),
    { value: "chosen" as const, label: "Choose" },
  ];

  const downloadLabel =
    scope === "all" ? "Download CSV" : `Download ${rows.length} ${rows.length === 1 ? "row" : "rows"}`;

  return (
    <CpdFeaturePage
      back={CPD_HOME_BACK}
      eyebrow={
        lastAdded
          ? `Last file ${formatCmeRowDate(perthCalendarDate(new Date(lastAdded.addedAt!)), today)}`
          : `Export your CPD log · ${set.year}`
      }
      title="AMA CPD Home"
      testId="cpd-home-page"
    >
      <section className={cn(flatCard, "p-3")}>
        <CpdHomeHandoffStrip
          activities={yearEntries.length}
          file={flow?.phase === "making" ? "making" : history.length ? "saved" : "none"}
        />
      </section>

      <section
        className={cn(flatCard, "flex min-w-0 items-start gap-3 border-[color:var(--warning-border)] p-3")}
        data-testid="cpd-home-format"
      >
        <IconCircle icon={Clock} tone="amber" />
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
            Format to be confirmed with AMA CPD Home
          </h2>
          <p className="text-sm leading-5 text-[color:var(--text-muted)]">
            We have not checked what CPD Home can import. A plain CSV works now, and you can copy each activity to type
            it in.
          </p>
          <button
            type="button"
            aria-expanded={checkOpen}
            aria-controls="cpd-home-still-to-check"
            onClick={() => setCheckOpen((open) => !open)}
            className={cn(
              focusRing,
              "inline-flex min-h-12 items-center gap-1 justify-self-start text-sm font-medium text-[color:var(--warning)] underline underline-offset-4",
            )}
            data-testid="cpd-home-check-toggle"
          >
            What we still need to check
            <ChevronDown
              aria-hidden="true"
              className={cn("size-icon-sm motion-safe:transition-transform", checkOpen && "rotate-180")}
            />
          </button>
          {checkOpen ? (
            <ul
              id="cpd-home-still-to-check"
              className="grid list-disc gap-1 pl-5 text-sm leading-5 text-[color:var(--text)]"
            >
              <li>Whether CPD Home imports a file at all, or takes activities typed in one at a time</li>
              <li>Which columns it expects, and what it calls them</li>
              <li>How it wants dates written, and its names for the three categories</li>
              <li>Whether it takes reflections, and how long they can be</li>
            </ul>
          ) : null}
        </div>
      </section>

      {lastAdded && notYetAdded.length > 0 && scope === "new" ? (
        <section
          className={cn(
            flatCard,
            "flex items-center gap-3 border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] p-3",
          )}
        >
          <IconCircle icon={History} />
          <div className="grid min-w-0">
            <p className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
              <span className="font-normal nums">{notYetAdded.length}</span> new since your last file
            </p>
            <p className="text-sm leading-5 text-[color:var(--text-muted)]">Chosen for you below</p>
          </div>
        </section>
      ) : null}

      <YearSwitch years={availableYears} year={set.year} />

      <section aria-labelledby="cpd-home-which" className="grid gap-2">
        <SectionLabel id="cpd-home-which">Which activities</SectionLabel>
        <SegmentedControl
          ariaLabelledBy="cpd-home-which"
          value={scope}
          onChange={(value) => {
            setScopeChoice(value);
            setFailure(null);
            setShowAll(false);
          }}
          options={scopeOptions}
          layout="equal"
        />
        {scope === "new" && notYetAdded.length === 0 ? (
          <p className="px-1 text-sm text-[color:var(--text-muted)]" data-testid="cpd-home-nothing-new">
            Nothing new since your last file. Every activity this year is in a file you marked added.
          </p>
        ) : null}
        {scope === "chosen" ? (
          <ChooseList
            entries={yearEntries}
            chosen={chosen}
            today={today}
            onToggle={(id) =>
              setChosen((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onAll={() => setChosen(new Set(yearEntries.map((entry) => entry.id)))}
            onNone={() => setChosen(new Set())}
          />
        ) : null}
      </section>

      {scope !== "chosen" && scopeEntries.length > 0 ? (
        <section aria-labelledby="cpd-home-activities" className="grid min-w-0 gap-2 [&>.work-label]:flex-wrap">
          <SectionLabel
            id="cpd-home-activities"
            count={`${scopeEntries.length} · ${hoursWords(totalHours)}`}
            action={{ label: "Copy all", onClick: copyAll }}
          >
            In the file
          </SectionLabel>
          <ul role="list" className={flatCard} data-testid="cpd-home-activity-list">
            {listed.map((entry) => {
              const row = rows.find((candidate) => candidate.entryId === entry.id);
              return (
                <li key={entry.id} className={flatRow} data-testid="cpd-home-activity">
                  <DateTile on={entry.date} label={formatCmeRowDate(entry.date, today)} />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                      {entry.title}
                    </span>
                    <span className="text-sm leading-5 text-[color:var(--text-muted)]">
                      {row?.category || "No category"} · <span className="nums">{hoursWords(row?.hours ?? 0)}</span>
                    </span>
                  </span>
                  {heldTitles.has(entry.id) ? (
                    <Link
                      href={`/cme/log/${entry.id}?edit=1`}
                      className={cn(
                        focusRing,
                        "inline-flex min-h-12 shrink-0 items-center text-sm text-[color:var(--warning)] underline underline-offset-4",
                      )}
                      data-testid="cpd-home-held-title"
                    >
                      Edit title
                    </Link>
                  ) : (
                    <CopyIconButton
                      label={`Copy ${entry.title}`}
                      text={() => cpdHomeActivityText(entry, set, includeReflections && !withheld.has(entry.id))}
                      testId="cpd-home-copy-one"
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {scopeEntries.length > LIST_COLLAPSED ? (
            <Button
              variant="ghost"
              onClick={() => setShowAll((value) => !value)}
              aria-expanded={showAll}
              testId="cpd-home-show-all"
            >
              {showAll ? "Show the latest 6" : `Show all ${scopeEntries.length}`}
            </Button>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="cpd-home-columns" className="grid gap-2">
        <SectionLabel id="cpd-home-columns">Columns</SectionLabel>
        <ul role="list" className={flatCard}>
          <li className={flatRow}>
            <span className="grid min-w-0 flex-1 py-1">
              <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                Date, activity, hours, category
              </span>
              <span className="text-sm leading-5 text-[color:var(--text-muted)]">Always in the file</span>
            </span>
            <Tag tone="green">In the file</Tag>
          </li>
          <li className={flatRow}>
            <span className="grid min-w-0 flex-1 py-1" id="cpd-home-reflections-label">
              <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                Reflections
              </span>
              <span className="text-sm leading-5 text-[color:var(--text-muted)]">
                {includeReflections
                  ? "In the file. Check them for patient details first."
                  : "Left out. Turn on to include them."}
              </span>
            </span>
            <FlatSwitch
              on={includeReflections}
              onChange={setIncludeReflections}
              labelledBy="cpd-home-reflections-label"
              testId="cpd-home-reflections"
            />
          </li>
          <li className={flatRow}>
            <span className="grid min-w-0 flex-1 py-1">
              <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                Evidence files
              </span>
              <span className="text-sm leading-5 text-[color:var(--text-muted)]">
                Not in a CSV. Upload them in CPD Home.
              </span>
            </span>
            <Tag>Not sent</Tag>
          </li>
        </ul>
        {withheld.size ? (
          <div
            role="status"
            data-testid="cpd-home-withheld"
            className={cn(flatCard, "flex items-start gap-2.5 border-[color:var(--warning-border)] p-3")}
          >
            <TriangleAlert
              aria-hidden="true"
              strokeWidth={1.5}
              className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--warning)]"
            />
            <span className="grid gap-1 text-sm leading-5">
              <span className="font-medium text-[color:var(--text-heading)]">
                {withheld.size === 1 ? "1 reflection left out" : `${withheld.size} reflections left out`}
              </span>
              <span className="text-[color:var(--text)]">
                They look like they hold a patient detail, so they stay out of the file and the copies. Edit them in Log
                to include them.
              </span>
              <span className="flex flex-wrap gap-x-3">
                {rows
                  .filter((row) => withheld.has(row.entryId))
                  .map((row) => (
                    <Link
                      key={row.entryId}
                      href={`/cme/log/${row.entryId}?edit=1`}
                      className={cn(focusRing, "inline-flex min-h-12 items-center underline underline-offset-4")}
                    >
                      {row.activity}
                    </Link>
                  ))}
              </span>
            </span>
          </div>
        ) : null}
      </section>

      {problems.length ? (
        <section
          role="alert"
          data-testid="cpd-home-problems"
          className={cn(flatCard, "grid gap-2 border-[color:var(--warning-border)] p-3")}
        >
          <p className="flex items-center gap-2 text-base-minus font-medium text-[color:var(--text-heading)]">
            <TriangleAlert aria-hidden="true" strokeWidth={1.5} className="size-icon-sm text-[color:var(--warning)]" />
            No file is made until these are fixed
          </p>
          <p className="text-sm text-[color:var(--text-muted)]">
            A file with gaps could leave activities out without you knowing, and a title is in every row and copy, so it
            cannot hold a patient detail. Nothing was changed.
          </p>
          <ul role="list" className="grid">
            {problems.map((problem) => (
              <li key={problem.entryId}>
                <Link
                  href={`/cme/log/${problem.entryId}?edit=1`}
                  className={cn(
                    focusRing,
                    "flex min-h-12 items-center justify-between gap-3 text-sm underline-offset-4 hover:underline",
                  )}
                >
                  <span className="min-w-0 truncate text-[color:var(--text-heading)]">{problem.activity}</span>
                  <span className="shrink-0 text-[color:var(--warning)]">{problem.problem}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {failure ? (
        <section
          role="alert"
          data-testid="cpd-home-failure"
          className={cn(flatCard, "flex items-start gap-3 border-[color:var(--warning-border)] p-3")}
        >
          <IconCircle icon={TriangleAlert} tone="amber" />
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
              {failure.title}
            </span>
            <span className="text-sm leading-5 text-[color:var(--text-muted)]">{failure.body}</span>
            {failure.retry ? (
              <span className="pt-1">
                <WorkButton variant="amber" onClick={makeFile} testId="cpd-home-try-again">
                  Try again
                </WorkButton>
              </span>
            ) : null}
          </span>
        </section>
      ) : null}

      <section aria-labelledby="cpd-home-files" className="grid gap-2">
        <SectionLabel id="cpd-home-files" count={history.length ? history.length : undefined}>
          {history.length ? "Files made" : "Last file"}
        </SectionLabel>
        {store.state === null ? (
          <div aria-hidden="true" className={cn(flatCard, "h-14 motion-safe:animate-pulse")} />
        ) : history.length === 0 ? (
          <div className={cn(flatCard, "flex items-center gap-3 p-3")} data-testid="cpd-home-no-files">
            <IconCircle icon={History} tone="neutral" />
            <span className="grid">
              <span className="text-base-minus font-medium text-[color:var(--text-heading)]">None yet</span>
              <span className="text-sm text-[color:var(--text-muted)]">Each file you make is listed here</span>
            </span>
          </div>
        ) : (
          <ul role="list" className={flatCard} data-testid="cpd-home-history">
            {(showOlderFiles ? history : history.slice(0, FILES_COLLAPSED)).map((file) => (
              <li key={file.id} className={cn(flatRow, "flex-wrap")} data-testid="cpd-home-file">
                <CsvBadge />
                <span className="grid min-w-0 flex-1 basis-40 py-1">
                  <span className="truncate text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                    {file.name}
                  </span>
                  <span className="text-sm leading-5 text-[color:var(--text-muted)]">
                    {formatCmeRowDate(perthCalendarDate(new Date(file.madeAt)), today)}, {timeOf(file.madeAt)} ·{" "}
                    <span className="nums">{file.rows}</span> {file.rows === 1 ? "row" : "rows"}
                  </span>
                </span>
                {file.addedAt ? (
                  <>
                    <Tag tone="green">Added</Tag>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markNotAdded(file)}
                      aria-label={`Mark ${file.name} not added`}
                    >
                      Not added
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      onClick={() => markAdded(file)}
                      testId="cpd-home-mark-added"
                      aria-label={`Mark ${file.name} added to CPD Home`}
                    >
                      Mark added
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeFile(file)}
                      aria-label={`Remove ${file.name} from this list`}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {history.length > FILES_COLLAPSED ? (
          <Button
            variant="ghost"
            onClick={() => setShowOlderFiles((value) => !value)}
            aria-expanded={showOlderFiles}
            testId="cpd-home-show-older-files"
          >
            {showOlderFiles ? `Show the latest ${FILES_COLLAPSED}` : `Show older · ${history.length - FILES_COLLAPSED}`}
          </Button>
        ) : null}
      </section>

      <section aria-labelledby="cpd-home-import-format" className="grid gap-2">
        <SectionLabel id="cpd-home-import-format">Import format</SectionLabel>
        <div className={cn(flatCard, "flex flex-wrap items-center gap-3 p-3")} data-testid="cpd-home-import-format">
          <IconCircle icon={Clock} tone="amber" />
          <span className="grid min-w-0 flex-1 basis-40">
            <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">AMA CPD Home</span>
            <span className="text-sm leading-5 text-[color:var(--text-muted)]">Not confirmed yet</span>
          </span>
          <PendingTag>Source pending</PendingTag>
        </div>
      </section>

      <section className="grid gap-2">
        <ul role="list" className={flatCard}>
          <li className={flatRow}>
            <IconCircle icon={FileText} tone="neutral" />
            <span className="grid min-w-0 flex-1 py-1">
              <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                Full CPD export
              </span>
              <span
                className="text-sm leading-5 text-[color:var(--text-muted)]"
                data-testid="cpd-home-full-export-note"
              >
                {online ? "Every column, for your own records" : "Needs a connection. The file above works offline."}
              </span>
            </span>
            {/* This file comes from the server, so it waits for a connection. The browser reporting offline is
                reliable in that direction; it never blocks the CSV above, which is made on the phone. */}
            {online ? (
              <a
                href={`/api/cme/export?year=${set.year}`}
                download
                data-testid="cpd-home-full-export"
                className={buttonFaceClass({ variant: "secondary", size: "sm" })}
              >
                CSV
              </a>
            ) : (
              <button
                type="button"
                disabled
                data-testid="cpd-home-full-export"
                className={buttonFaceClass({ variant: "secondary", size: "sm" })}
              >
                CSV
              </button>
            )}
          </li>
        </ul>
      </section>

      <QuietNote icon={Shield} testId="cpd-home-privacy">
        {writesKept
          ? "Made on this phone. Nothing is sent for you. The list of files keeps dates and counts, never your words."
          : store.mode === "shared"
            ? "This is marked as a shared device, so the list of files is not kept. Nothing is sent for you."
            : store.mode === "memory"
              ? "This browser is not keeping changes. They last until you leave the page. Nothing is sent for you."
              : "Sample record. Files made here are not kept, and nothing is sent."}
      </QuietNote>

      <ActionDock testId="cpd-home-dock">
        <WorkButton
          variant="secondary"
          icon={Eye}
          onClick={() => setPreviewOpen(true)}
          disabled={rows.length === 0}
          testId="cpd-home-preview"
        >
          Preview
        </WorkButton>
        <WorkButton
          icon={Download}
          onClick={makeFile}
          disabled={rows.length === 0 || flow?.phase === "making"}
          testId="cpd-home-download"
        >
          {downloadLabel}
        </WorkButton>
      </ActionDock>

      <Sheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview"
        description={`First ${Math.min(PREVIEW_ROWS, rows.length)} of ${rows.length} rows`}
        testId="cpd-home-preview-sheet"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={copyTable} testId="cpd-home-copy-table">
              Copy as table
            </Button>
            <Button
              variant="primary"
              icon={Download}
              onClick={() => {
                setPreviewOpen(false);
                makeFile();
              }}
            >
              Download CSV
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <div
            role="table"
            aria-label={`First ${Math.min(PREVIEW_ROWS, rows.length)} of ${rows.length} rows`}
            className={cn(flatCard, "overflow-hidden text-xs")}
          >
            <div
              role="row"
              className="grid grid-cols-[5.5rem_1fr_3rem] gap-2 bg-[color:var(--surface-subtle)] px-3 py-2 text-[color:var(--text-muted)]"
            >
              <span role="columnheader">Date</span>
              <span role="columnheader">Activity</span>
              <span role="columnheader" className="text-right">
                Hours
              </span>
            </div>
            {rows.slice(0, PREVIEW_ROWS).map((row) => (
              <div
                role="row"
                key={row.entryId}
                className="grid grid-cols-[5.5rem_1fr_3rem] gap-2 border-t border-[color:var(--border)] px-3 py-2"
              >
                <span role="cell" className="nums text-[color:var(--text-muted)]">
                  {/* Shown the Australian way without the year, which the page already names. The file keeps the ISO date. */}
                  {/^\d{4}-\d{2}-\d{2}$/.test(row.date) ? formatCmeRowDate(row.date, row.date) : row.date}
                </span>
                <span role="cell" className="grid min-w-0 text-[color:var(--text-heading)]">
                  <span className="font-medium">{row.activity}</span>
                  <span className="text-[color:var(--text-muted)]">{row.category}</span>
                </span>
                <span role="cell" className="nums text-right">
                  {row.hours}
                </span>
              </div>
            ))}
          </div>
          <p className="text-sm text-[color:var(--text-muted)]">
            {rows.length > PREVIEW_ROWS ? `${rows.length - PREVIEW_ROWS} more rows · ` : ""}
            {hoursWords(totalHours)} in total · {includeReflections ? "reflections included" : "reflections left out"}
          </p>
          <QuietNote icon={Clock}>Column names may need changing once CPD Home&apos;s format is checked.</QuietNote>
        </div>
      </Sheet>

      <Sheet
        open={flow !== null}
        onClose={() => (flow?.phase === "making" ? cancelMaking() : setFlow(null))}
        title={flow?.phase === "making" ? "Making your file" : ready ? "Your file" : "Download started"}
        description={
          flow?.phase === "making"
            ? flow.name
            : ready
              ? `${ready.file.name}, every row checked`
              : "Your browser should have saved it to your downloads"
        }
        testId="cpd-home-saved-sheet"
        footer={
          flow?.phase === "making" ? (
            <Button block onClick={cancelMaking} testId="cpd-home-cancel">
              Cancel
            </Button>
          ) : ready ? (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setFlow(null)} testId="cpd-home-ready-cancel">
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={Download}
                onClick={() => downloadReady(ready.file, ready.text)}
                testId="cpd-home-download-ready"
              >
                Download file
              </Button>
            </div>
          ) : saved ? (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setFlow(null)} testId="cpd-home-not-yet">
                Not yet
              </Button>
              <Button
                variant="primary"
                onClick={() => markAdded(saved.file)}
                disabled={!store.state?.files.some((file) => file.id === saved.file.id)}
                testId="cpd-home-added"
              >
                I added them
              </Button>
            </div>
          ) : null
        }
      >
        {flow?.phase === "making" ? (
          <div className="grid gap-4" data-testid="cpd-home-making">
            <div className={cn(flatCard, "p-3")}>
              <CpdHomeHandoffStrip activities={yearEntries.length} file="making" />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-3">
                <progress
                  max={flow.total}
                  value={flow.done}
                  aria-label={`${flow.done} of ${flow.total} rows checked`}
                  data-testid="cpd-home-progress"
                  className="h-2 min-w-0 flex-1 appearance-none overflow-hidden rounded-full bg-[color:var(--surface-subtle)] [&::-moz-progress-bar]:bg-[color:var(--mode-identity)] [&::-webkit-progress-bar]:bg-[color:var(--surface-subtle)] [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[color:var(--mode-identity)]"
                />
                <span className="shrink-0 text-sm font-medium nums text-[color:var(--text-heading)]">
                  {flow.done} of {flow.total} rows
                </span>
              </div>
              <p className="text-sm text-[color:var(--text-muted)]">
                Checking each row has a date, hours, a category and a safe title
              </p>
            </div>
          </div>
        ) : ready ? (
          <div className="grid gap-3" data-testid="cpd-home-ready">
            <div className={cn(flatCard, "flex flex-wrap items-center gap-3 p-3")}>
              <CsvBadge />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-base-minus font-medium text-[color:var(--text-heading)]">
                  {ready.file.name}
                </span>
                <span className="text-sm text-[color:var(--text-muted)]">
                  <span className="nums">{ready.file.rows}</span> {ready.file.rows === 1 ? "row" : "rows"}, every one
                  checked
                </span>
              </span>
            </div>
            <p className="text-sm text-[color:var(--text-muted)]">Tap Download file to save it on this device.</p>
          </div>
        ) : saved ? (
          <div className="grid gap-4">
            <div className={cn(flatCard, "p-3")}>
              <CpdHomeHandoffStrip activities={yearEntries.length} file="saved" />
            </div>
            <div className={cn(flatCard, "flex flex-wrap items-center gap-3 p-3")}>
              <CsvBadge />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-base-minus font-medium text-[color:var(--text-heading)]">
                  {saved.file.name}
                </span>
                <span className="text-sm text-[color:var(--text-muted)]">
                  <span className="nums">{saved.file.rows}</span> {saved.file.rows === 1 ? "row" : "rows"} ·{" "}
                  <span className="nums">{timeOf(saved.file.madeAt)}</span>
                </span>
              </span>
              <ShareButton name={saved.file.name} text={saved.text} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1" data-testid="cpd-home-not-there">
              <span className="text-sm text-[color:var(--text-muted)]">Not in your downloads?</span>
              <Button
                size="sm"
                variant="ghost"
                icon={Download}
                onClick={() => downloadAgain(saved.file, saved.text)}
                testId="cpd-home-download-again"
              >
                Download again
              </Button>
            </div>
            <div className="grid gap-1">
              <SectionLabel>Next, in CPD Home</SectionLabel>
              <ol className={flatCard}>
                <li className={flatRow}>
                  <StepNumber n={1} />
                  <span className="grid py-1">
                    <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
                      Open AMA CPD Home
                    </span>
                    <span className="text-sm text-[color:var(--text-muted)]">
                      Try importing the file there, or type each activity in
                    </span>
                  </span>
                </li>
                <li className={flatRow}>
                  <StepNumber n={2} />
                  <span className="grid py-1">
                    <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
                      Come back and mark them added
                    </span>
                    <span className="text-sm text-[color:var(--text-muted)]">Only you can tell if it worked</span>
                  </span>
                </li>
              </ol>
            </div>
            {!writesKept ? (
              <QuietNote icon={Lock}>
                {store.mode === "shared"
                  ? "Shared device: marking added lasts for this page only."
                  : store.mode === "memory"
                    ? "This browser is not keeping changes. Marking added lasts until you leave the page."
                    : "Sample record: marking added is not kept."}
              </QuietNote>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </CpdFeaturePage>
  );
}

function CsvBadge() {
  return (
    <span
      aria-hidden="true"
      className="inline-grid h-6 shrink-0 place-items-center rounded-md bg-[color:var(--success-soft)] px-1.5 text-2xs font-semibold tracking-label text-[color:var(--success)]"
    >
      CSV
    </span>
  );
}

function StepNumber({ n }: { readonly n: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-xs font-normal nums text-[color:var(--mode-identity)]"
    >
      {n}
    </span>
  );
}

function ShareButton({ name, text }: { readonly name: string; readonly text: string }) {
  const file = useMemo(() => canShareFile(name, text), [name, text]);
  if (!file) return null;
  return (
    <Button
      size="sm"
      icon={Share2}
      onClick={async () => {
        try {
          await navigator.share({ files: [file], title: name });
        } catch {
          // The share sheet was closed or refused: the file is still in downloads.
        }
      }}
    >
      Share
    </Button>
  );
}

function ChooseList({
  entries,
  chosen,
  today,
  onToggle,
  onAll,
  onNone,
}: {
  readonly entries: readonly CmeEntry[];
  readonly chosen: ReadonlySet<string>;
  readonly today: string;
  readonly onToggle: (id: string) => void;
  readonly onAll: () => void;
  readonly onNone: () => void;
}) {
  const newestFirst = [...entries].reverse();
  return (
    <div className="grid gap-2" data-testid="cpd-home-choose">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-sm text-[color:var(--text-muted)]" aria-live="polite">
          <span className="nums">{chosen.size}</span> of <span className="nums">{entries.length}</span> chosen
        </p>
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onAll} testId="cpd-home-choose-all">
            Choose all
          </Button>
          <Button size="sm" variant="ghost" onClick={onNone} disabled={chosen.size === 0}>
            Clear
          </Button>
        </span>
      </div>
      <ul role="list" className={flatCard}>
        {newestFirst.map((entry) => {
          const on = chosen.has(entry.id);
          return (
            <li key={entry.id} className={cn(flatRow, "px-0 py-0")}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(entry.id)}
                data-testid="cpd-home-choose-row"
                className={cn(
                  focusRing,
                  "flex min-h-13 w-full min-w-0 items-center gap-3 px-3 py-2 text-left",
                  on && "bg-[color:var(--mode-identity-soft)]",
                )}
              >
                <DateTile on={entry.date} label={formatCmeRowDate(entry.date, today)} />
                <span className="min-w-0 flex-1 truncate text-base-minus font-medium text-[color:var(--text-heading)]">
                  {entry.title}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border",
                    on
                      ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]"
                      : "border-[color:var(--border-strong)]",
                  )}
                >
                  {on ? <Check aria-hidden="true" strokeWidth={2.5} className="size-3.5" /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function YearSwitch({ years, year }: { readonly years: readonly number[]; readonly year: number }) {
  const others = years.filter((candidate) => candidate !== year).sort((a, b) => b - a);
  if (!others.length) return null;
  return (
    <nav
      aria-label="Other CPD years"
      className="flex flex-wrap items-center gap-2 px-1 text-sm text-[color:var(--text-muted)]"
    >
      <span>Other years</span>
      {others.map((other) => (
        <Link
          key={other}
          href={`/cme/cpd-home?year=${other}`}
          className={cn(
            focusRing,
            "inline-flex min-h-12 items-center px-2 text-[color:var(--mode-identity)] underline underline-offset-4",
          )}
        >
          {other}
        </Link>
      ))}
    </nav>
  );
}

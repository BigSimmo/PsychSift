"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeHeadingText, modeNameText, modeNumberText } from "@/components/mode-kit/type";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import {
  HANDBOOK_PUBLISH_BATCH_MAX,
  handbookImportIgnoredLine,
  importExistingFrom,
  parseHandbookImportCsv,
  publishDraftBatch,
  publishableDrafts,
  saveTickedRows,
  type HandbookImportRow,
  type HandbookImportSection,
  type PublishBatchResult,
  type SaveTickedRowsResult,
} from "@/lib/on-call/handbook-import";
import { resolveHandbookPhone, spokenOnCallNumber, type HandbookDial } from "@/lib/on-call/number-resolver";
import type { ServiceDetail, ServiceEntry } from "@/lib/on-call/service-model";

/**
 * Manage service › Import (plan Task 4.2, review F4). Editors and admins only:
 * the page mounts it behind `canEdit`.
 *
 * Two steps, never one. The file becomes a preview; the editor ticks rows and
 * saves them as DRAFTS, which nobody else sees. Publishing happens below, from
 * "Ready to publish", at most 20 at a time, with each change shown as the old
 * value struck through in muted grey beside the new one, and every number a
 * real call link so the editor can dial a few first. The file is read in the
 * browser and never uploaded.
 */

const SECTION_OPTIONS = [
  { value: "contacts", label: "Contacts" },
  { value: "referrals", label: "Referrals" },
  { value: "resources", label: "Find items" },
] as const satisfies readonly { value: HandbookImportSection; label: string }[];

/** How many "Ready to publish" rows show before "Show all" (standard §4: about eight or nine). */
const PUBLISH_ROWS_SHOWN = 9;

type Progress = { readonly verb: "Saving" | "Publishing"; readonly done: number; readonly total: number };

function dialsLabel(dial: HandbookDial): string {
  if (dial.kind === "direct") return "Call";
  if (dial.kind === "switchboard-extension") return `Call then ext ${dial.extension}`;
  if (dial.kind === "extension") return "From a hospital phone";
  if (dial.kind === "text") return "Text";
  return "No number";
}

function numberText(raw: string): string {
  return resolveHandbookPhone(raw).display || raw.trim();
}

/** The old value struck through in muted grey beside the new one (standard §2), never red or green. */
function Changed({ from, to }: { readonly from: string; readonly to: ReactNode }) {
  return (
    <>
      <del className="text-[color:var(--text-muted)]">{from}</del> {to}
    </>
  );
}

function saveSummary(result: SaveTickedRowsResult): string {
  const parts = [`Saved ${result.saved} ${result.saved === 1 ? "draft" : "drafts"}.`];
  if (result.failed.length > 0) {
    parts.push(
      `${result.failed.length} not saved: ${result.failed.map((item) => `line ${item.line}, ${item.message}`).join("; ")}.`,
    );
  }
  if (result.stopped === "session") parts.push("Your session ended. Sign in again to save the rest.");
  if (result.stopped === "cancelled") parts.push("Stopped before the rest.");
  return parts.join(" ");
}

function publishSummary(result: PublishBatchResult, entries: readonly ServiceEntry[]): string {
  const titles = new Map(entries.map((entry) => [entry.id, entry.content.title]));
  const parts = [`Published ${result.published}.`];
  if (result.failed.length > 0) {
    parts.push(
      `${result.failed.length} not published: ${result.failed
        .map((item) => `${titles.get(item.entryId) ?? "an entry"}, ${item.message}`)
        .join("; ")}.`,
    );
  }
  if (result.stopped === "session") parts.push("Your session ended. Sign in again to publish the rest.");
  if (result.stopped === "cancelled") parts.push("Stopped before the rest.");
  return parts.join(" ");
}

function PreviewRow({
  row,
  ticked,
  disabled,
  onToggle,
}: {
  readonly row: HandbookImportRow;
  readonly ticked: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}) {
  const existing = row.existing;
  const title = existing?.title ?? row.title;
  const phoneChanged = Boolean(existing && row.phone && row.phone.trim() !== existing.phone.trim());
  const notesChanged = Boolean(existing && row.notes && row.notes !== existing.body);
  const newNumber = row.dial.display;
  return (
    <tr className="h-12 border-t border-[color:var(--border)] align-top" data-testid={`service-import-row-${row.line}`}>
      <td className="w-12 px-1">
        <Checkbox
          label={<span className="sr-only">Tick line {row.line}</span>}
          checked={ticked}
          disabled={disabled || row.blocked !== null}
          onChange={onToggle}
        />
      </td>
      <td className={cn(modeNumberText, textMuted, "px-2 py-3.5")}>{row.line}</td>
      <td className="min-w-40 px-2 py-3.5">
        <span className={cn(modeNameText, "block break-words text-[color:var(--text-heading)]")}>{title}</span>
        {row.notes ? (
          <span className={cn(textMuted, "block whitespace-pre-wrap break-words text-sm")}>
            {notesChanged && existing ? <Changed from={existing.body} to={row.notes} /> : row.notes}
          </span>
        ) : null}
      </td>
      <td className={cn(modeNumberText, "min-w-32 break-words px-2 py-3.5")}>
        {phoneChanged && existing ? <Changed from={numberText(existing.phone)} to={newNumber} /> : newNumber}
      </td>
      <td className="px-2 py-3.5">{dialsLabel(row.dial)}</td>
      <td className={cn(textMuted, "px-2 py-3.5")}>{row.phoneType}</td>
      <td className="min-w-40 px-2 py-3.5 text-sm">
        {row.blocked ? <span className="block break-words text-[color:var(--text)]">{row.blocked}</span> : null}
        {row.notices.map((notice) => (
          <span key={notice} className={cn(textMuted, "block break-words")}>
            {notice}
          </span>
        ))}
      </td>
    </tr>
  );
}

function PublishRow({
  entry,
  ticked,
  disabled,
  onToggle,
}: {
  readonly entry: ServiceEntry;
  readonly ticked: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}) {
  const published = entry.publishedContent;
  const title = entry.content.title;
  const dial = resolveHandbookPhone(entry.content.phone);
  const number = dial.tel ? (
    <a
      href={dial.tel}
      aria-label={`Call ${title}, ${spokenOnCallNumber(dial.display)}`}
      className={cn(
        focusRing,
        modeNumberText,
        "inline-flex min-h-12 items-center rounded-sm text-[color:var(--text)] underline underline-offset-2",
      )}
    >
      {dial.display}
    </a>
  ) : dial.kind === "none" ? null : (
    <span className={modeNumberText}>
      {dial.display}
      {dial.route === "hospital-phone" ? " · From a hospital phone" : ""}
    </span>
  );
  const phoneChanged = Boolean(published && published.phone && published.phone !== entry.content.phone);
  return (
    <OnCallRow
      testId={`service-import-draft-${entry.id}`}
      title={published && published.title !== title ? <Changed from={published.title} to={title} /> : title}
      subtitle={
        number || phoneChanged ? (
          phoneChanged && published ? (
            <Changed from={numberText(published.phone)} to={number} />
          ) : (
            number
          )
        ) : undefined
      }
      trailing={
        <span className="flex w-12 justify-center">
          <Checkbox
            label={<span className="sr-only">Tick {title}</span>}
            checked={ticked}
            disabled={disabled}
            onChange={onToggle}
          />
        </span>
      }
    />
  );
}

export function ServiceImportPanel({
  serviceId,
  siteId,
  siteName,
  authEpoch,
  detail,
  demo,
  reload,
  sleep,
}: {
  readonly serviceId: string;
  readonly siteId: string | null;
  readonly siteName: string | null;
  readonly authEpoch: number;
  readonly detail: Pick<ServiceDetail, "entries">;
  readonly demo: boolean;
  /** Loads the service detail once. Called once at the end of each run. */
  readonly reload: () => Promise<void> | void;
  /** Only so tests run instantly; production uses the real 2 s spacing. */
  readonly sleep?: (ms: number) => Promise<void>;
}) {
  const headingId = useId();
  const [section, setSection] = useState<HandbookImportSection>("contacts");
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [publishTicked, setPublishTicked] = useState<ReadonlySet<string>>(new Set());
  const [showAllDrafts, setShowAllDrafts] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const run = useRef<AbortController | null>(null);
  const runEpoch = useRef(authEpoch);

  // A new sign-in (or sign-out) mid-run stops it: the rest must not be sent as someone else.
  useEffect(() => {
    if (runEpoch.current === authEpoch) return;
    runEpoch.current = authEpoch;
    run.current?.abort();
  }, [authEpoch]);
  useEffect(() => () => run.current?.abort(), []);

  const parsed = useMemo(
    () =>
      fileText === null
        ? null
        : parseHandbookImportCsv(fileText, { section, existing: importExistingFrom(detail, siteId, section) }),
    [detail, fileText, section, siteId],
  );
  const drafts = useMemo(() => publishableDrafts(detail, siteId), [detail, siteId]);
  const reviewDrafts = detail.entries.filter(
    (entry) => entry.status === "draft" && entry.content.kind !== "operational" && entry.content.siteId === siteId,
  ).length;

  const running = progress !== null;
  const saveableRows = parsed?.rows.filter((row) => row.blocked === null) ?? [];
  const tickedRows = saveableRows.filter((row) => ticked.has(row.line));
  const tickedDrafts = drafts.filter((entry) => publishTicked.has(entry.id));
  const visibleDrafts = showAllDrafts ? drafts : drafts.slice(0, PUBLISH_ROWS_SHOWN);
  const ignoredLine = parsed ? handbookImportIgnoredLine(parsed.ignoredColumns) : null;

  async function chooseFile(file: File | undefined) {
    setSummary(null);
    setTicked(new Set());
    if (!file) {
      setFileText(null);
      return;
    }
    try {
      setFileText(await file.text());
      setFileError(null);
    } catch {
      setFileText(null);
      setFileError("This file could not be read. Save it as CSV and choose it again.");
    }
  }

  async function saveTicked() {
    if (demo || running || tickedRows.length === 0) return;
    const controller = new AbortController();
    run.current = controller;
    setSummary(null);
    setProgress({ verb: "Saving", done: 0, total: tickedRows.length });
    const result = await saveTickedRows({
      serviceId,
      rows: tickedRows,
      siteId,
      section,
      signal: controller.signal,
      sleep,
      onProgress: (done, total) => setProgress({ verb: "Saving", done, total }),
    });
    run.current = null;
    setProgress(null);
    setTicked(new Set());
    setSummary(saveSummary(result));
    if (result.saved > 0 && runEpoch.current === authEpoch) await reload();
  }

  async function publishTickedDrafts() {
    if (demo || running || tickedDrafts.length === 0 || tickedDrafts.length > HANDBOOK_PUBLISH_BATCH_MAX) return;
    const controller = new AbortController();
    run.current = controller;
    setSummary(null);
    setProgress({ verb: "Publishing", done: 0, total: tickedDrafts.length });
    const result = await publishDraftBatch({
      serviceId,
      entries: tickedDrafts,
      signal: controller.signal,
      sleep,
      onProgress: (done, total) => setProgress({ verb: "Publishing", done, total }),
    });
    run.current = null;
    setProgress(null);
    setPublishTicked(new Set());
    setSummary(publishSummary(result, tickedDrafts));
    if (result.published > 0 && runEpoch.current === authEpoch) await reload();
  }

  function tickNextBatch() {
    const next = new Set(publishTicked);
    let added = 0;
    for (const entry of drafts) {
      if (added >= HANDBOOK_PUBLISH_BATCH_MAX) break;
      if (next.has(entry.id)) continue;
      next.add(entry.id);
      added += 1;
    }
    setPublishTicked(next);
    // Never tick a row the editor cannot see.
    if (drafts.some((entry, index) => index >= PUBLISH_ROWS_SHOWN && next.has(entry.id))) setShowAllDrafts(true);
  }

  const saveLabel = demo
    ? "Demo mode saves nothing"
    : tickedRows.length === 1
      ? "Save 1 ticked row as a draft"
      : tickedRows.length === 0
        ? "Save ticked rows as drafts"
        : `Save ${tickedRows.length} ticked rows as drafts`;
  const publishLabel = demo
    ? "Demo mode saves nothing"
    : tickedDrafts.length > HANDBOOK_PUBLISH_BATCH_MAX
      ? `Publish at most ${HANDBOOK_PUBLISH_BATCH_MAX} at a time`
      : tickedDrafts.length === 0
        ? "Publish"
        : `Publish ${tickedDrafts.length}`;

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-5" data-testid="service-import">
      <div className="grid gap-3">
        <h2 id={headingId} className={cn(modeHeadingText, "text-lg-minus text-[color:var(--text-heading)]")}>
          Import from a spreadsheet
        </h2>
        <ModeNotice>
          Only numbers, roles, wards and locations. Do not include patient details or staff names. On-site items
          (access, food, taxi) belong in Admin.
        </ModeNotice>
        <SegmentedControl
          label="Import as"
          value={section}
          onChange={(value) => {
            if (running) return;
            setSection(value);
            setTicked(new Set());
          }}
          options={SECTION_OPTIONS}
        />
        <p className="text-sm text-[color:var(--text)]">
          Goes to <span className={modeNameText}>{siteName ?? "Service-wide"}</span>
        </p>
        <p className={cn(textMuted, "text-sm")}>Rows are saved as drafts. Nobody sees them until you publish below.</p>
        <FormField
          label="Choose a CSV file"
          hint="In Excel or Sheets: File › Download › CSV."
          error={fileError ?? undefined}
        >
          {(field) => (
            <input
              id={field.id}
              type="file"
              accept=".csv,text/csv"
              aria-describedby={field.describedBy}
              aria-invalid={field.invalid || undefined}
              disabled={running}
              onChange={(event) => void chooseFile(event.target.files?.[0])}
              className={cn(fieldControlPlain, "py-3 file:mr-3 file:border-0 file:bg-transparent file:font-semibold")}
            />
          )}
        </FormField>
      </div>

      {parsed ? (
        <div className="grid min-w-0 gap-3" data-testid="service-import-preview">
          {parsed.missingTitleColumn ? (
            <ModeNotice>No title column. Name one column title, role, service, ward or contact.</ModeNotice>
          ) : null}
          {parsed.truncated ? (
            <ModeNotice>Only the first 200 rows are shown. Import the rest as a second file.</ModeNotice>
          ) : null}
          {parsed.rows.length > 0 ? (
            <>
              <div className="min-w-0 overflow-x-auto rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)]">
                <table className="w-full min-w-[40rem] border-collapse text-left text-sm text-[color:var(--text)]">
                  <thead>
                    <tr className={cn(textMuted, "h-12 text-xs")}>
                      <th scope="col" className="px-2 font-medium">
                        <span className="sr-only">Tick</span>
                      </th>
                      <th scope="col" className="px-2 font-medium">
                        Line
                      </th>
                      <th scope="col" className="px-2 font-medium">
                        Title
                      </th>
                      <th scope="col" className="px-2 font-medium">
                        Phone
                      </th>
                      <th scope="col" className="px-2 font-medium">
                        Dials
                      </th>
                      <th scope="col" className="px-2 font-medium">
                        Type
                      </th>
                      <th scope="col" className="px-2 font-medium">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.map((row) => (
                      <PreviewRow
                        key={row.line}
                        row={row}
                        ticked={ticked.has(row.line)}
                        disabled={running}
                        onToggle={() =>
                          setTicked((current) => {
                            const next = new Set(current);
                            if (next.has(row.line)) next.delete(row.line);
                            else next.add(row.line);
                            return next;
                          })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {ignoredLine ? <p className={cn(textMuted, "text-sm")}>{ignoredLine}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={running || saveableRows.length === 0}
                  onClick={() => setTicked(new Set(saveableRows.map((row) => row.line)))}
                >
                  Tick all that can be saved
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={running || ticked.size === 0}
                  onClick={() => setTicked(new Set())}
                >
                  Clear ticks
                </Button>
              </div>
              <Button
                variant="primary"
                block
                disabled={demo || running || tickedRows.length === 0}
                onClick={() => void saveTicked()}
              >
                {saveLabel}
              </Button>
            </>
          ) : !parsed.missingTitleColumn ? (
            <p className={cn(textMuted, "text-sm")}>No rows in this file.</p>
          ) : null}
        </div>
      ) : null}

      {progress ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className={cn(modeNumberText, "text-sm text-[color:var(--text)]")}>
            {progress.verb} {Math.min(progress.done + 1, progress.total)} of {progress.total}…
          </p>
          <Button variant="secondary" size="sm" onClick={() => run.current?.abort()}>
            Cancel
          </Button>
        </div>
      ) : summary ? (
        <p role="status" className="text-sm text-[color:var(--text)]">
          {summary}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-3" data-testid="service-import-publish">
        {drafts.length > 0 ? (
          <>
            <p className={cn(textMuted, "text-sm")}>Dial two or three of these before you publish.</p>
            <OnCallGroupedList eyebrow="Ready to publish">
              {visibleDrafts.map((entry) => (
                <PublishRow
                  key={entry.id}
                  entry={entry}
                  ticked={publishTicked.has(entry.id)}
                  disabled={running}
                  onToggle={() =>
                    setPublishTicked((current) => {
                      const next = new Set(current);
                      if (next.has(entry.id)) next.delete(entry.id);
                      else next.add(entry.id);
                      return next;
                    })
                  }
                />
              ))}
            </OnCallGroupedList>
            <div className="flex flex-wrap gap-2">
              {drafts.length > PUBLISH_ROWS_SHOWN && !showAllDrafts ? (
                <Button variant="ghost" size="sm" onClick={() => setShowAllDrafts(true)}>
                  Show all {drafts.length}
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" disabled={running} onClick={tickNextBatch}>
                Tick the next {HANDBOOK_PUBLISH_BATCH_MAX}
              </Button>
            </div>
            <Button
              // One filled button per screen: while a file preview is open, saving is the main step.
              variant={parsed?.rows.length ? "secondary" : "primary"}
              block
              disabled={
                demo || running || tickedDrafts.length === 0 || tickedDrafts.length > HANDBOOK_PUBLISH_BATCH_MAX
              }
              onClick={() => void publishTickedDrafts()}
            >
              {publishLabel}
            </Button>
          </>
        ) : (
          <p className={cn(textMuted, "text-sm")}>No drafts to publish.</p>
        )}
        {reviewDrafts > 0 ? (
          <p className={cn(textMuted, "text-sm")}>Clinical and legal drafts go through review on the Handbook tab.</p>
        ) : null}
      </div>
    </section>
  );
}

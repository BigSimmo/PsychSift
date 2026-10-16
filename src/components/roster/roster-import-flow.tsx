"use client";

import { FileUp, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeActionButton } from "@/components/mode-kit/action-button";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeNumberText } from "@/components/mode-kit/type";
import { Button } from "@/components/ui/button";
import { RosterCodeChooser } from "@/components/roster/roster-code-chooser";
import { cn, eyebrowText } from "@/components/ui-primitives";
import {
  findRememberedRow,
  gridRowToShifts,
  normaliseCode,
  type CodeMap,
  type CodeMeaning,
  type RosterGrid,
} from "@/lib/roster/import/grid";
import { RosterReadError, tableToGrid } from "@/lib/roster/import/table";
import { type ShiftKind } from "@/lib/roster/shift-kind";
import { detectOwnShiftConflicts, diffRoster, rosterWindow, shiftIsInWindow } from "@/lib/roster/shifts/diff";
import {
  ON_CALL_SHIFT_FILE_NAME_MAX,
  type OnCallShiftChange,
  type OnCallShiftFormat,
  type OnCallShiftInput,
  type OnCallShiftSnapshot,
} from "@/lib/roster/shifts/model";
import { parseRosterCsv } from "@/lib/roster/shifts/parse-csv";
import { parseRosterIcs, plural, shiftCapNote } from "@/lib/roster/shifts/parse-ics";
import { formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";

import { formatShiftRange, kindOf } from "./roster-format";
import { RosterLetter } from "./roster-week-strip";
import type { RosterSettingsState } from "./use-roster-settings";
import { errorCodeOf } from "./use-roster-links";
import type { RosterShiftsState } from "./use-roster-shifts";

/**
 * Import a file, in three steps that keep the page's header and add a close
 * bar: pick the file, say which row is you (skipped when the remembered name
 * is found), then see only what changes and choose any unknown code.
 *
 * CSV and calendar files are read here on the phone. Excel and PDF go to
 * `/api/roster/read-file`, which reads them in memory and returns only the
 * grid; the file is never kept. What each code means and which row is yours
 * are saved through `/api/roster/settings`, never on the device.
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024;

type Step = "pick" | "row" | "review";

type Loaded = {
  readonly format: OnCallShiftFormat;
  readonly fileName: string;
  /** A grid (Excel, PDF, grid-shaped CSV), or shifts already read (calendar file, list-shaped CSV). */
  readonly grid: RosterGrid | null;
  readonly shifts: readonly (OnCallShiftInput & { readonly kind: ShiftKind })[];
};

const READ_ERRORS: Record<RosterReadError["reason"], string> = {
  scanned: "Can't read this PDF. Try the Excel version.",
  no_dates: "No dates were found in that file.",
  no_names: "No names were found in that file.",
  too_big: "That file is too big. Export a shorter date range.",
  unreadable: "That file could not be read.",
};

/** Follows the parser's own note when a file has more shifts than one import may carry. Nothing is saved. */
const TOO_MANY_SHIFTS = "Export a shorter date range.";

function formatOf(name: string): OnCallShiftFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".ics")) return "ics";
  return null;
}

/** Split CSV text into rows of cells, honouring quotes. */
export function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function gridWindow(grid: RosterGrid): { start: string; end: string } | null {
  const dates = grid.dates.filter((date): date is string => Boolean(date)).sort();
  return dates.length ? { start: dates[0]!, end: dates.at(-1)! } : null;
}

async function readOnServer(file: File): Promise<RosterGrid | string> {
  const form = new FormData();
  form.set("file", file);
  try {
    const response = await fetch("/api/roster/read-file", { method: "POST", body: form });
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const grid = (payload as { grid?: RosterGrid } | null)?.grid;
      return grid && Array.isArray(grid.dates) && Array.isArray(grid.rows) ? grid : READ_ERRORS.unreadable;
    }
    if (response.status === 401) return "Sign in to import a roster.";
    if (response.status === 413) return READ_ERRORS.too_big;
    const code = errorCodeOf(payload) as RosterReadError["reason"] | null;
    return (code && READ_ERRORS[code]) ?? READ_ERRORS.unreadable;
  } catch {
    return "That file could not be read. Check your connection and try again.";
  }
}

function Snapshot({ snapshot, struck = false }: { readonly snapshot: OnCallShiftSnapshot; readonly struck?: boolean }) {
  const Tag = struck ? "s" : "span";
  return (
    <Tag className={cn(struck && "text-[color:var(--text-muted)]")}>
      {snapshot.title} {formatShiftRange(snapshot)}
    </Tag>
  );
}

function changeDate(change: OnCallShiftChange): string {
  return perthDateOf(change.kind === "removed" ? change.before.startsAt : change.after.startsAt);
}

function ChangeRow({ change }: { readonly change: OnCallShiftChange }) {
  const date = formatPerthDay(changeDate(change));
  const kind = change.kind === "removed" ? null : kindOf({ ...change.after, kind: null });
  return (
    <ModeRow
      testId="roster-import-change"
      title={
        <span className="flex min-w-0 items-center gap-2">
          <RosterLetter kind={kind} />
          {date}
        </span>
      }
      subtitle={
        change.kind === "added" ? (
          <>
            New · <Snapshot snapshot={change.after} />
          </>
        ) : change.kind === "moved" ? (
          <>
            <Snapshot snapshot={change.before} struck /> <Snapshot snapshot={change.after} />
          </>
        ) : (
          <>
            <Snapshot snapshot={change.before} struck /> removed
          </>
        )
      }
    />
  );
}

export function RosterImportFlow({
  shifts,
  settings,
  today,
  onClose,
  onSaved,
}: {
  readonly shifts: RosterShiftsState;
  readonly settings: RosterSettingsState;
  /** Perth date, for reading header dates that carry no year. */
  readonly today: string;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const inputId = useId();
  const workplaceId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const knownWorkplaces = useMemo(() => {
    const names = new Set<string>();
    for (const shift of shifts.shifts) if (shift.workplace) names.add(shift.workplace);
    for (const name of Object.keys(settings.settings.codes)) if (name) names.add(name);
    return [...names];
  }, [shifts.shifts, settings.settings.codes]);
  const [workplace, setWorkplace] = useState(() => knownWorkplaces[0] ?? "");
  const [step, setStep] = useState<Step>("pick");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rowIndex, setRowIndex] = useState<number | null>(null);
  const [chosen, setChosen] = useState<CodeMap>({});
  const [chooser, setChooser] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const place = workplace.trim();
  const codes: CodeMap = useMemo(
    () => ({ ...(settings.settings.codes[place] ?? {}), ...chosen }),
    [settings.settings.codes, place, chosen],
  );

  const review = useMemo(() => {
    if (!loaded) return null;
    const read =
      loaded.grid && rowIndex !== null
        ? gridRowToShifts(loaded.grid, rowIndex, codes)
        : { shifts: [...loaded.shifts], unknown: [] };
    const window = loaded.grid ? gridWindow(loaded.grid) : rosterWindow(read.shifts);
    if (!window) return null;
    const stored = shifts.shifts.filter((shift) => shift.source === "import" && (shift.workplace ?? "") === place);
    const diff = diffRoster(stored, read.shifts, window);
    const retainedOther = shifts.shifts.filter(
      (shift) => !(shift.source === "import" && (shift.workplace ?? "") === place && shiftIsInWindow(shift, window)),
    );
    const conflicts = detectOwnShiftConflicts([...retainedOther, ...read.shifts]);
    return { ...read, window, diff, conflicts, unchanged: Math.max(0, read.shifts.length - diff.added - diff.changed) };
  }, [loaded, rowIndex, codes, shifts.shifts, place]);

  function goToRows(next: Loaded) {
    setLoaded(next);
    setChosen({});
    if (!next.grid) {
      setRowIndex(null);
      setStep("review");
      return;
    }
    const remembered = findRememberedRow(next.grid, settings.settings.rowName);
    setRowIndex(remembered);
    setStep(remembered === null ? "row" : "review");
  }

  async function readFile(file: File) {
    setError(null);
    const format = formatOf(file.name);
    if (!format) {
      setError("Choose a PDF, Excel, CSV or calendar file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(READ_ERRORS.too_big);
      return;
    }
    const fileName = file.name.slice(0, ON_CALL_SHIFT_FILE_NAME_MAX);
    setReading(true);
    try {
      if (format === "xlsx" || format === "pdf") {
        const grid = await readOnServer(file);
        if (typeof grid === "string") setError(grid);
        else goToRows({ format, fileName, grid, shifts: [] });
        return;
      }
      const text = await file.text();
      if (format === "ics") {
        const result = parseRosterIcs(text);
        const read = result.shifts.map((shift) => ({ ...shift, kind: kindOf(shift) }));
        const capNote = shiftCapNote(result);
        if (capNote) setError(`${capNote} ${TOO_MANY_SHIFTS}`);
        else if (read.length === 0) setError(["No shifts were found in that file.", ...result.notes].join(" "));
        else goToRows({ format, fileName, grid: null, shifts: read });
        return;
      }
      const list = parseRosterCsv(text);
      const capNote = shiftCapNote(list);
      if (capNote) {
        setError(`${capNote} ${TOO_MANY_SHIFTS}`);
        return;
      }
      if (list.shifts.length > 0) {
        goToRows({
          format,
          fileName,
          grid: null,
          shifts: list.shifts.map((shift) => ({ ...shift, kind: kindOf(shift) })),
        });
        return;
      }
      try {
        goToRows({ format, fileName, grid: tableToGrid(splitCsvRows(text), today), shifts: [] });
      } catch (caught) {
        setError(caught instanceof RosterReadError ? READ_ERRORS[caught.reason] : READ_ERRORS.unreadable);
      }
    } finally {
      setReading(false);
    }
  }

  function chooseRow(index: number) {
    setRowIndex(index);
    setStep("review");
    const name = loaded?.grid?.rows[index]?.name ?? null;
    if (name && name !== settings.settings.rowName) void settings.update({ rowName: name.slice(0, 80) });
  }

  function chooseCode(code: string, meaning: CodeMeaning) {
    const key = normaliseCode(code);
    setChosen((current) => ({ ...current, [key]: meaning }));
    setChooser(null);
    // Remember the code only once the stored codes are known: saving over codes that never loaded would lose them.
    if (settings.status !== "ready") return;
    const stored = settings.settings.codes[place] ?? {};
    void settings.update({ codes: { [place]: { ...stored, [key]: meaning } } });
  }

  async function save() {
    if (!loaded || !review) return;
    setSaving(true);
    setError(null);
    const failure = await shifts.save({
      format: loaded.format,
      workplace: place || null,
      fileName: loaded.fileName,
      windowStart: review.window.start,
      windowEnd: review.window.end,
      shifts: review.shifts.map((shift) => ({
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        title: shift.title,
        location: shift.location,
        sourceUid: shift.sourceUid,
        kind: shift.kind,
      })),
    });
    setSaving(false);
    if (failure) setError(failure);
    else onSaved();
  }

  const stepNumber = step === "pick" ? 1 : step === "row" ? 2 : 3;
  const canSave = review !== null && review.unknown.length === 0 && !saving;

  return (
    <section className="grid min-w-0 gap-4" data-testid="roster-import-flow" aria-label="Import a file">
      <div className="flex min-w-0 items-center gap-2 border-b border-[color:var(--border)] pb-2">
        <ModeActionButton icon={X} label="Close" onClick={onClose} testId="roster-import-close" />
        <h2 className="min-w-0 flex-1 text-base-minus font-normal text-[color:var(--text-heading)]">Import a file</h2>
        <span className={cn(modeNumberText, "text-sm text-[color:var(--text-muted)]")}>Step {stepNumber} of 3</span>
      </div>

      {step === "pick" ? (
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm text-[color:var(--text-muted)]" htmlFor={workplaceId}>
            Workplace
            <input
              id={workplaceId}
              type="text"
              maxLength={80}
              list={`${workplaceId}-list`}
              value={workplace}
              onChange={(event) => setWorkplace(event.target.value)}
              className="min-h-12 w-full min-w-0 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-base-minus text-[color:var(--text)]"
            />
            <datalist id={`${workplaceId}-list`}>
              {knownWorkplaces.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".pdf,.xlsx,.csv,.ics"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="roster-import-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readFile(file);
            }}
          />
          <Button
            variant="primary"
            icon={FileUp}
            onClick={() => inputRef.current?.click()}
            busy={reading}
            busyLabel="Reading…"
          >
            Choose a file
          </Button>
        </div>
      ) : null}

      {step === "row" && loaded?.grid ? (
        <ModeGroupedList eyebrow="Which row is you?" testId="roster-import-rows">
          {loaded.grid.rows.map((row, index) => (
            <li key={`${row.name}-${index}`} className="relative">
              <button
                type="button"
                onClick={() => chooseRow(index)}
                className="flex min-h-12 w-full min-w-0 items-center px-3 text-left text-base-minus font-normal text-[color:var(--text-heading)] active:bg-[color:var(--surface-wash)]"
              >
                {row.name}
              </button>
            </li>
          ))}
        </ModeGroupedList>
      ) : null}

      {step === "review" && loaded && review ? (
        <div className="grid gap-4">
          <p className="text-sm text-[color:var(--text-muted)]" data-testid="roster-import-found">
            <span className="text-[color:var(--text)]">{loaded.fileName}</span> ·{" "}
            {plural(review.shifts.length, "shift")} found
          </p>

          {review.conflicts.length > 0 ? (
            <ModeNotice tone="warning" testId="roster-own-shift-conflict-warning">
              {review.conflicts.length === 1
                ? `Double-booked shift: ${review.conflicts[0]!.first.title} overlaps ${review.conflicts[0]!.second.title} by ${review.conflicts[0]!.overlapMinutes} min.`
                : `${review.conflicts.length} overlapping shifts found in your roster.`}
            </ModeNotice>
          ) : null}

          {review.unknown.length ? (
            <ModeGroupedList eyebrow="Unknown codes" testId="roster-import-unknown">
              {review.unknown.map(({ code, days }) => (
                <ModeRow
                  key={code}
                  title={`“${code}”`}
                  subtitle={`Used on ${plural(days, "day")}`}
                  trailing={
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Choose ${code}`}
                      onClick={() => setChooser(code)}
                    >
                      Choose
                    </Button>
                  }
                />
              ))}
            </ModeGroupedList>
          ) : null}

          {review.diff.changes.length ? (
            <ModeGroupedList eyebrow="What changes" testId="roster-import-changes">
              {review.diff.changes.map((change, index) => (
                <ChangeRow key={`${changeDate(change)}-${index}`} change={change} />
              ))}
            </ModeGroupedList>
          ) : null}

          {review.diff.conflicts.length ? (
            <ModeNotice tone="warning" data-testid="roster-import-conflicts">
              {plural(review.diff.conflicts.length, "overlapping shift")} found in this file.
            </ModeNotice>
          ) : null}

          <p className={cn(eyebrowText, "px-3")} data-testid="roster-import-unchanged">
            {review.unchanged} unchanged
          </p>

          <Button variant="primary" disabled={!canSave} busy={saving} busyLabel="Saving…" onClick={() => void save()}>
            Save {plural(review.shifts.length, "shift")}
          </Button>
        </div>
      ) : null}

      {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}

      <RosterCodeChooser code={chooser} onClose={() => setChooser(null)} onChoose={chooseCode} />
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeNotice } from "@/components/mode-kit/notice";
import { RosterInviteSheet } from "@/components/roster/invite/roster-invite-sheet";
import { RosterCodeChooser } from "@/components/roster/roster-code-chooser";
import { splitCsvRows } from "@/components/roster/roster-import-flow";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  gridRowToShifts,
  normaliseCode,
  type CodeMap,
  type CodeMeaning,
  type RosterGrid,
} from "@/lib/roster/import/grid";
import { tableToGrid } from "@/lib/roster/import/table";
import { compareWithLive } from "@/lib/roster/publish/compare";
import {
  buildOpenShifts,
  buildPublishPayload,
  validatePublishPeriod,
  type PublishPeriod,
  type RosterPublishRow,
} from "@/lib/roster/publish/build";
import { matchRowsToPeople } from "@/lib/roster/publish/match";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import type {
  RosterAssignment,
  RosterChanges,
  RosterOverview,
  RosterPerson,
  RosterShiftCode,
} from "@/lib/roster/team/model";

import { RosterPublishPreview } from "./roster-publish-preview";
import { RosterRowSorter, type RowChoice } from "./roster-row-sorter";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** The server cannot publish yet (it is missing an update); said without the jargon. */
const PUBLISH_UNAVAILABLE = "Publishing isn't available yet — ask the app owner.";
const EMPTY_PEOPLE: RosterPerson[] = [];
type LiveState =
  | { status: "idle" | "loading" }
  | { status: "missing-g1" | "error"; key: string }
  | {
      status: "ready";
      key: string;
      freshnessToken: string;
      assignments: RosterAssignment[];
      changes: RosterChanges;
      people: RosterPerson[];
      codes: RosterShiftCode[];
    };

function gridPeriod(grid: RosterGrid): PublishPeriod | null {
  const dates = grid.dates.filter((date): date is string => typeof date === "string").sort();
  return dates.length ? { start: dates[0]!, end: dates.at(-1)! } : null;
}

function snapshotKey(serviceId: string, period: PublishPeriod | null, refresh: number): string | null {
  if (!period) return null;
  try {
    validatePublishPeriod(period);
  } catch {
    return null;
  }
  return `${serviceId}:${period.start}:${period.end}:${refresh}`;
}

function validGrid(value: unknown): value is RosterGrid {
  if (!value || typeof value !== "object") return false;
  const grid = value as Record<string, unknown>;
  return (
    Array.isArray(grid.dates) &&
    grid.dates.every((date) => date === null || /^\d{4}-\d{2}-\d{2}$/.test(String(date))) &&
    Array.isArray(grid.rows) &&
    grid.rows.every((row) => {
      if (!row || typeof row !== "object") return false;
      const record = row as Record<string, unknown>;
      return (
        typeof record.name === "string" &&
        Array.isArray(record.cells) &&
        record.cells.every((cell) => typeof cell === "string")
      );
    })
  );
}

export function RosterPublishTab({ serviceId, overview }: { serviceId: string; overview: RosterOverview }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [grid, setGrid] = useState<RosterGrid | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [period, setPeriod] = useState<PublishPeriod | null>(null);
  const [choices, setChoices] = useState<Record<number, RowChoice>>({});
  const [chosenCodes, setChosenCodes] = useState<CodeMap>({});
  const [codeToChoose, setCodeToChoose] = useState<string | null>(null);
  const [inviteRow, setInviteRow] = useState<number | null>(null);
  const [swapChoices, setSwapChoices] = useState<Record<string, "keep" | "file">>({});
  const [openChoices, setOpenChoices] = useState<Record<string, "keep" | "file">>({});
  const [liveResult, setLive] = useState<LiveState>({ status: "idle" });
  const [reading, setReading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestKey = grid ? snapshotKey(serviceId, period, refresh) : null;
  const live = useMemo<LiveState>(
    () =>
      requestKey === null
        ? { status: "idle" }
        : "key" in liveResult && liveResult.key === requestKey
          ? liveResult
          : { status: "loading" },
    [requestKey, liveResult],
  );

  const people = live.status === "ready" ? live.people : EMPTY_PEOPLE;
  const matches = useMemo(() => matchRowsToPeople(grid?.rows.map((row) => row.name) ?? [], people), [grid, people]);
  const codes = useMemo<CodeMap>(() => {
    const stored: Record<string, CodeMeaning> = {};
    for (const code of live.status === "ready" ? live.codes : []) {
      if (code.kind === "off") stored[normaliseCode(code.code)] = { kind: "off" };
      else if (code.starts && code.ends)
        stored[normaliseCode(code.code)] = { kind: code.kind, start: code.starts, end: code.ends };
    }
    return { ...stored, ...chosenCodes };
  }, [live, chosenCodes]);

  const read = useMemo(() => {
    if (!grid)
      return {
        rows: [] as RosterPublishRow[],
        openShifts: [] as RosterPublishRow[],
        unknown: [] as string[],
        unresolved: 0,
        matched: 0,
      };
    const rows: RosterPublishRow[] = [];
    const openShifts: RosterPublishRow[] = [];
    const unknown = new Set<string>();
    let unresolved = 0;
    let matched = 0;
    grid.rows.forEach((row, index) => {
      const match = matches[index]?.match;
      const choice = choices[index];
      const userId =
        choice?.kind === "person" ? choice.userId : !choice && match && "userId" in match ? match.userId : null;
      const person = people.find((candidate) => candidate.userId === userId);
      if (userId) matched += 1;
      if (!userId && !choice) unresolved += 1;
      grid.dates.forEach((date, column) => {
        if (!date) return;
        const cell = row.cells[column] ?? "";
        const result = gridRowToShifts({ dates: [date], rows: [{ name: row.name, cells: [cell] }] }, 0, codes);
        result.unknown.forEach(({ code }) => unknown.add(code));
        result.shifts.forEach((shift) => {
          const item: RosterPublishRow = {
            rowName: row.name,
            userId,
            rosterName: userId ? null : choice?.kind === "named" ? row.name : null,
            siteId: null,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            shiftCode: normaliseCode(cell),
            kind: shift.kind,
            grade: person?.grade ?? null,
          };
          if (choice?.kind === "open") openShifts.push(item);
          else rows.push(item);
        });
      });
    });
    return { rows, openShifts, unknown: [...unknown].sort(), unresolved, matched };
  }, [grid, matches, choices, codes, people]);

  useEffect(() => {
    if (!requestKey || !period) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const query = new URLSearchParams({ from: period.start, to: period.end });
        const response = await fetch(`/api/roster/team/${encodeURIComponent(serviceId)}/publish?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const answer = await response.json().catch(() => null);
        if (!response.ok) {
          if (!controller.signal.aborted)
            setLive({
              status: answer?.code === "roster_publish_requires_update" ? "missing-g1" : "error",
              key: requestKey,
            });
          return;
        }
        if (
          typeof answer?.freshnessToken !== "string" ||
          !Array.isArray(answer.assignments) ||
          !Array.isArray(answer.changes?.swaps) ||
          !Array.isArray(answer.people) ||
          !Array.isArray(answer.codes)
        )
          throw new Error("preview shape");
        if (!controller.signal.aborted) setLive({ status: "ready", key: requestKey, ...answer });
      } catch {
        if (!controller.signal.aborted) setLive({ status: "error", key: requestKey });
      }
    })();
    return () => controller.abort();
  }, [grid, period, serviceId, requestKey]);

  const comparison = useMemo(
    () =>
      period && live.status === "ready"
        ? compareWithLive({
            fileRows: read.rows,
            fileOpenShifts: read.openShifts,
            live: live.assignments,
            approvedChanges: live.changes.swaps,
            approvedOpenShifts: live.changes.openShifts,
            period,
            choices: swapChoices,
            openChoices,
          })
        : null,
    [period, live, read.rows, read.openShifts, swapChoices, openChoices],
  );

  async function loadFile(file: File) {
    setError(null);
    setReading(true);
    setGrid(null);
    setLive({ status: "idle" });
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("That file is too large. Choose one under 2 MB.");
      const ext = file.name.toLowerCase().split(".").at(-1);
      let next: unknown;
      if (ext === "csv") {
        next = tableToGrid(splitCsvRows(await file.text()), perthDateOf(new Date()));
      } else if (ext === "xlsx" || ext === "pdf") {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch("/api/roster/read-file", { method: "POST", body: form, cache: "no-store" });
        if (!response.ok) throw new Error("That roster could not be read.");
        next = ((await response.json()) as { grid?: unknown }).grid;
      } else throw new Error("Choose a PDF, Excel or CSV roster.");
      if (!validGrid(next)) throw new Error("That roster could not be read.");
      const window = gridPeriod(next);
      if (!window) throw new Error("No roster dates were found.");
      setGrid(next);
      setPeriod(window);
      setSourceName(file.name.slice(0, 120));
      setSuccess(null);
      setChoices({});
      setChosenCodes({});
      setSwapChoices({});
      setOpenChoices({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That roster could not be read.");
    } finally {
      setReading(false);
    }
  }

  const canBuild = Boolean(period && read.unresolved === 0 && read.unknown.length === 0);
  const previewError = useMemo(() => {
    if (!canBuild || !period) return null;
    try {
      const assignments = comparison?.rows ?? read.rows;
      const opens = comparison?.openShifts ?? read.openShifts;
      if (assignments.length + opens.length > 5000)
        throw new Error("A team roster can contain at most 5,000 shifts and open offers together.");
      buildPublishPayload({ period, sourceName, rows: assignments });
      buildOpenShifts({ period, rows: opens });
      return null;
    } catch (caught) {
      return caught instanceof Error ? caught.message : "Check the roster before publishing.";
    }
  }, [canBuild, period, sourceName, comparison, read.rows, read.openShifts]);
  // An unset or invalid period never starts a comparison (`snapshotKey` is
  // null), so it has to be named before "Comparing…" or the manager is sent
  // to wait instead of to the date fields.
  const periodProblem = useMemo(() => {
    if (!period) return "Set the roster period first.";
    if (period.start && period.end && period.end < period.start)
      return "The roster period ends before it starts. Fix the dates first.";
    try {
      validatePublishPeriod(period);
      return null;
    } catch (caught) {
      return caught instanceof Error ? `${caught.message.replace(/\.$/, "")} first.` : "Fix the roster dates first.";
    }
  }, [period]);
  const canPublish = live.status === "ready" && Boolean(comparison) && !publishing && canBuild && !previewError;
  // Why Publish is off, in the same order as the checks above, shown beside the button.
  const publishBlocked = publishing
    ? null
    : live.status === "missing-g1"
      ? PUBLISH_UNAVAILABLE
      : live.status === "error"
        ? "The live roster couldn't be compared, so publishing is paused. Try again later."
        : periodProblem
          ? periodProblem
          : live.status !== "ready" || !comparison
            ? "Comparing with the live roster…"
            : read.unresolved > 0
              ? `Sort the ${read.unresolved} unmatched ${read.unresolved === 1 ? "row" : "rows"} above first.`
              : read.unknown.length
                ? `Choose what ${read.unknown.length === 1 ? "1 code means" : `${read.unknown.length} codes mean`} above first.`
                : previewError
                  ? "Fix the problem above first."
                  : null;

  async function publish() {
    if (!canPublish || !period || !grid || !comparison || live.status !== "ready") return;
    setError(null);
    setPublishing(true);
    try {
      const roles = new Map<string, string>();
      const seenNames = new Map<string, string>();
      grid.rows.forEach((row, index) => {
        const choice = choices[index];
        const match = matches[index]?.match;
        const userId =
          choice?.kind === "person" ? choice.userId : !choice && match && "userId" in match ? match.userId : null;
        if (!userId) return;
        const name = row.name.trim();
        const previous = seenNames.get(userId);
        if (previous && previous !== name)
          throw new Error("One person appears under two different names. Sort those rows before publishing.");
        seenNames.set(userId, name);
        if (live.people.find((person) => person.userId === userId)?.rosterName?.trim() !== name)
          roles.set(userId, name);
      });
      const mergedCodes = new Map(live.codes.map((code) => [normaliseCode(code.code), code]));
      for (const [code, meaning] of Object.entries(chosenCodes)) {
        if (meaning.kind === "off") mergedCodes.set(code, { code, kind: "off", starts: null, ends: null, label: null });
        else mergedCodes.set(code, { code, kind: meaning.kind, starts: meaning.start, ends: meaning.end, label: null });
      }
      const body = {
        expectedToken: live.freshnessToken,
        roles: [...roles].map(([userId, rosterName]) => ({ userId, rosterName })),
        codes: [...mergedCodes.values()],
        publication: buildPublishPayload({ period, sourceName, rows: comparison.rows }),
        openShifts: buildOpenShifts({ period, rows: comparison.openShifts }),
        overrideChanges: [
          ...comparison.undoesSwaps
            .filter((swap) => swapChoices[swap.swapId] === "file")
            .map((swap) => ({ kind: "swap" as const, id: swap.swapId })),
          ...comparison.undoesOpenClaims
            .filter((claim) => openChoices[claim.openShiftId] === "file")
            .map((claim) => ({ kind: "open" as const, id: claim.openShiftId })),
        ],
      };
      const response = await fetch(`/api/roster/team/${encodeURIComponent(serviceId)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const answer = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409 && answer?.code === "roster_conflict") {
          setLive({ status: "idle" });
          setSwapChoices({});
          setOpenChoices({});
          setRefresh((value) => value + 1);
          throw new Error("The live roster changed. Review the refreshed comparison before publishing.");
        }
        if (answer?.code === "roster_publish_requires_update") {
          setLive({ status: "missing-g1", key: requestKey! });
          throw new Error(PUBLISH_UNAVAILABLE);
        }
        throw new Error(
          typeof answer?.message === "string" ? answer.message : "The roster could not be published. Try again.",
        );
      }
      if (
        !Number.isInteger(answer?.version) ||
        !Array.isArray(answer?.changedUserIds) ||
        !Array.isArray(answer?.openShiftIds)
      )
        throw new Error(
          "The publication saved, but its receipt could not be read. Refresh the team before trying again.",
        );
      setSuccess(
        `Published v${answer.version}. ${answer.changedUserIds.length} ${answer.changedUserIds.length === 1 ? "person has" : "people have"} roster updates. ${answer.openShiftIds.length} open ${answer.openShiftIds.length === 1 ? "shift" : "shifts"} ready.`,
      );
      setGrid(null);
      setPeriod(null);
      setLive({ status: "idle" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The roster could not be published. Try again.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="grid gap-5" data-testid="roster-publish-tab">
      <ModeGroupedList eyebrow="Upload the roster">
        <ModeRow
          title="PDF, Excel or CSV"
          subtitle="The file is read in memory and thrown away. Only its file name is kept if published."
        />
      </ModeGroupedList>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.xlsx,.csv"
        className="sr-only"
        aria-label="Choose a team roster file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void loadFile(file);
        }}
      />
      <Button variant="secondary" disabled={reading} onClick={() => fileInput.current?.click()}>
        {reading ? "Reading roster…" : "Choose file"}
      </Button>
      {success ? <ModeNotice>{success}</ModeNotice> : null}
      {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
      {grid && period ? (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Period starts"
              type="date"
              value={period.start}
              onChange={(event) => {
                setLive({ status: "idle" });
                setPeriod({ ...period, start: event.target.value });
              }}
            />
            <TextField
              label="Period ends"
              type="date"
              value={period.end}
              onChange={(event) => {
                setLive({ status: "idle" });
                setPeriod({ ...period, end: event.target.value });
              }}
            />
          </div>
          <p className="text-sm text-[color:var(--text-muted)]">
            Rows matched {read.matched} of {grid.rows.length} · People with changes {comparison?.byPerson.length ?? "—"}
          </p>
          {live.status === "ready" ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              Compared with the live roster, including {live.changes.swaps.length} swaps.
            </p>
          ) : null}
          {live.status === "missing-g1" ? <ModeNotice tone="warning">{PUBLISH_UNAVAILABLE}</ModeNotice> : null}
          {live.status === "error" ? (
            <ModeNotice tone="warning">The live roster could not be compared. Try again later.</ModeNotice>
          ) : null}
          <RosterRowSorter
            rows={matches}
            people={people}
            choices={choices}
            onChoose={(index, choice) => setChoices((current) => ({ ...current, [index]: choice }))}
            onInvite={setInviteRow}
          />
          {read.unknown.length ? (
            <ModeGroupedList eyebrow={`Choose ${read.unknown.length} ${read.unknown.length === 1 ? "code" : "codes"}`}>
              {read.unknown.map((code) => (
                <ModeRow
                  key={code}
                  title={code}
                  trailing={
                    <Button variant="secondary" onClick={() => setCodeToChoose(code)}>
                      Choose
                    </Button>
                  }
                />
              ))}
            </ModeGroupedList>
          ) : null}
          {comparison ? (
            <RosterPublishPreview
              comparison={comparison}
              swapChoices={swapChoices}
              onSwapChoice={(id, choice) => setSwapChoices((current) => ({ ...current, [id]: choice }))}
              openChoices={openChoices}
              onOpenChoice={(id, choice) => setOpenChoices((current) => ({ ...current, [id]: choice }))}
            />
          ) : null}
          {previewError ? <ModeNotice tone="warning">{previewError}</ModeNotice> : null}
          <div className="grid gap-2">
            <Button
              variant="primary"
              disabled={!canPublish}
              aria-describedby={publishBlocked ? "roster-publish-blocked" : undefined}
              onClick={() => void publish()}
            >
              {publishing ? "Publishing…" : "Publish"}
            </Button>
            {publishBlocked ? (
              <p id="roster-publish-blocked" className="text-sm text-[color:var(--text-muted)]">
                {publishBlocked}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <RosterCodeChooser
        code={codeToChoose}
        onClose={() => setCodeToChoose(null)}
        onChoose={(code, meaning) => {
          setChosenCodes((current) => ({ ...current, [normaliseCode(code)]: meaning }));
          setCodeToChoose(null);
        }}
      />
      {inviteRow !== null ? (
        <RosterInviteSheet serviceId={serviceId} teamName={overview.service.name} onClose={() => setInviteRow(null)} />
      ) : null}
    </div>
  );
}

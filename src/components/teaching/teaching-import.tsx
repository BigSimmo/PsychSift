"use client";

import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { focusRing } from "@/components/card-recipes";
import { modeInsetHairline, modeModuleSurface } from "@/components/mode-kit/recipes";
import { REPEAT_LABELS } from "@/components/teaching/organise-sheets";
import { shortDayLabel } from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import { ModeNotice } from "@/components/mode-kit/notice";
import {
  TeachingAccountPage,
  TeachingDepthPage,
  teachingStickySubmit,
} from "@/components/teaching/teaching-depth-page";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn, textMuted } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost, teachingUpload } from "@/lib/teaching/client";
import { DEMO_TEACHING_SERVICE_ID } from "@/lib/teaching/demo-programme";
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_TEMPLATE_HEADERS,
  teachingDepthUrl,
  type ImportCommitted,
  type ImportPreview,
  type SheetRow,
} from "@/lib/teaching/depth-model";
import { parseCsv } from "@/lib/teaching/import-csv";
import { previewRows } from "@/lib/teaching/import-sheet";
import type { SeriesInput, TeamSummary } from "@/lib/teaching/model";

const TEACHING_IMPORT_READ_URL = "/api/teaching/import/read";

/**
 * The template: the headings, then one clearly made-up example row to copy the shape from. Delete the
 * example before importing; a real timetable never needs it.
 */
const TEMPLATE_EXAMPLE = [
  "Demo journal club",
  "journal",
  "weekly",
  "2026-02-04",
  "2026-06-24",
  "12:30",
  "60",
  "Demo seminar room",
  "",
  "",
];
const TEMPLATE_CSV = `${IMPORT_TEMPLATE_HEADERS.join(",")}\r\n${TEMPLATE_EXAMPLE.join(",")}\r\n`;

/** "Wed 4 Feb · 12:30 Perth · Every week · Demo seminar room", from the fields the preview sends. */
function previewLine(series: Partial<SeriesInput>): string {
  return [
    series.firstDate ? shortDayLabel(series.firstDate) : null,
    series.startTime ? `${series.startTime} Perth` : null,
    series.repeat ? (REPEAT_LABELS[series.repeat] ?? null) : null,
    series.venue ?? (series.firstDate ? "Room not set" : null),
  ]
    .filter(Boolean)
    .join(" · ");
}

function formWith(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

function ImportPage({ demoMode }: { demoMode: boolean }) {
  const resource = useTeachingResource<{ teams: TeamSummary[] }>(demoMode ? null : "/api/teaching?view=week");
  const teams = demoMode
    ? [{ id: DEMO_TEACHING_SERVICE_ID, name: "Demo health service", role: "organiser" }]
    : (resource.data?.teams ?? []).filter((team) => ["organiser", "admin"].includes(team.role));
  const [serviceId, setServiceId] = useState("");
  const service = teams.some((team) => team.id === serviceId) ? serviceId : teams[0]?.id;
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileId = useId();
  const sequence = useRef(0);
  return (
    <TeachingDepthPage
      title="Import a timetable"
      demoMode={demoMode}
      resource={resource}
      ready={demoMode || resource.status === "ready"}
    >
      <p>
        Use a service timetable only: no patient details, attendance, passcodes or slides. The file is read on this
        device. Only timetable rows are sent for preview.
      </p>
      <a
        className={cn(
          "inline-flex min-h-tap items-center self-start px-1 text-sm font-medium text-[color:var(--primary)]",
          focusRing,
        )}
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`}
        download="teaching-template.csv"
      >
        Download CSV template
      </a>
      {teams.length === 0 ? (
        <ModeNotice>Only a service organiser or admin can import its timetable.</ModeNotice>
      ) : (
        <>
          {teams.length > 1 ? (
            <Select
              label="Service"
              disabled={busy}
              value={service}
              onChange={(event) => {
                sequence.current++;
                setServiceId(event.target.value);
                setPreview(null);
                setResult(null);
                setError(null);
              }}
              options={teams.map((team) => ({ value: team.id, label: team.name }))}
            />
          ) : (
            <p className={cn("text-sm", textMuted)}>
              Service: <span className="font-medium text-[color:var(--text-heading)]">{teams[0].name}</span>
            </p>
          )}
          <div className="grid gap-1">
            <input
              id={fileId}
              type="file"
              accept=".csv,.xlsx"
              className="peer sr-only"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                const current = ++sequence.current;
                setFileName(file?.name ?? null);
                setPreview(null);
                setError(null);
                setResult(null);
                if (!file || !service) return;
                if (file.size > IMPORT_MAX_FILE_BYTES) {
                  setError("Use a file no larger than 1 MB.");
                  return;
                }
                setBusy(true);
                try {
                  // An .xlsx is read on the server so exceljs never ships to the browser; CSV stays local.
                  const rows = /\.xlsx$/i.test(file.name)
                    ? (await teachingUpload<{ rows: SheetRow[] }>(TEACHING_IMPORT_READ_URL, formWith(file))).rows
                    : /\.csv$/i.test(file.name)
                      ? parseCsv(await file.text())
                      : null;
                  if (!rows) throw new Error("Choose a CSV or XLSX file.");
                  const next = demoMode
                    ? previewRows(rows, [])
                    : await teachingPost<ImportPreview>(teachingDepthUrl(service), { action: "import.preview", rows });
                  if (current === sequence.current) setPreview(next);
                } catch (cause) {
                  if (current === sequence.current)
                    setError(
                      cause instanceof Error && !("code" in cause) ? cause.message : teachingErrorMessage(cause),
                    );
                } finally {
                  if (current === sequence.current) setBusy(false);
                }
              }}
            />
            <label
              htmlFor={fileId}
              className={cn(
                buttonFaceClass({ variant: "secondary", block: true }),
                "cursor-pointer peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)] peer-disabled:cursor-default peer-disabled:text-[color:var(--disabled)]",
              )}
            >
              <Upload aria-hidden="true" className="size-icon-md shrink-0" />
              Choose CSV or XLSX (up to 1 MB)
            </label>
            {fileName ? <p className={cn("px-1 text-sm", textMuted)}>{fileName}</p> : null}
          </div>
          {busy ? (
            <p role="status" className={cn("text-sm", textMuted)}>
              Working…
            </p>
          ) : null}
          {preview ? (
            <section className="grid gap-2">
              <h2 className="text-base-minus font-medium text-[color:var(--text-heading)]">
                Preview — nothing imported yet
              </h2>
              <ul role="list" className={modeModuleSurface} data-testid="teaching-import-preview">
                {preview.rows.map((row, index) => {
                  const ready = preview.ready?.length === preview.rows.length ? preview.ready[index] : null;
                  return (
                    <li key={row.line} className={cn(modeInsetHairline, "grid min-h-13 gap-0.5 px-3 py-1")}>
                      <p className="text-base-minus font-medium leading-5 break-words text-[color:var(--text-heading)]">
                        {row.title || `Line ${row.line}`}
                      </p>
                      {ready ? (
                        <p className={cn("text-sm leading-5", textMuted)} data-testid="teaching-import-preview-when">
                          {previewLine(ready)}
                        </p>
                      ) : (
                        <p className={cn("text-sm leading-5", textMuted)}>Line {row.line}</p>
                      )}
                      {row.errors.map((message) => (
                        <p key={message} role="alert" className="text-sm leading-5 text-[color:var(--text-heading)]">
                          {message}
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ul>
              <p>
                Import adds new series. Presenters must be assigned in Organise afterwards. Check dates and Perth times
                before importing.
              </p>
              <div className={teachingStickySubmit}>
                <Button
                  type="button"
                  variant="primary"
                  block
                  disabled={busy || !preview.ready?.length}
                  onClick={async () => {
                    if (!preview.ready?.length || !service || busy) return;
                    if (demoMode) {
                      setResult("Demo preview only. No programme was changed.");
                      return;
                    }
                    setBusy(true);
                    setError(null);
                    try {
                      const saved = await teachingPost<ImportCommitted>(teachingDepthUrl(service), {
                        action: "import.commit",
                        rows: preview.ready,
                      });
                      setResult(`Imported ${saved.series} series and ${withUnit(saved.occurrences, "sessions")}.`);
                      setPreview(null);
                    } catch {
                      setPreview(null);
                      setError(
                        "The import outcome could not be confirmed. Check Organise before importing again to avoid duplicate series.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Import these sessions
                </Button>
              </div>
            </section>
          ) : null}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {result ? <p role="status">{result}</p> : null}
    </TeachingDepthPage>
  );
}
export function TeachingImport(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={ImportPage} {...props} />;
}

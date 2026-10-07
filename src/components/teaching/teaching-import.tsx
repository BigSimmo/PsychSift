"use client";

import { Check, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { focusRing } from "@/components/card-recipes";
import { WorkButton } from "@/components/mode-kit/work";
import { REPEAT_LABELS } from "@/components/teaching/organise-sheets";
import { shortDayLabel } from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import { T5Icon, T5List, T5Note, T5Section } from "@/components/teaching/t5-kit";
import {
  TeachingAccountPage,
  TeachingDepthPage,
  teachingStickySubmit,
} from "@/components/teaching/teaching-depth-page";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Select } from "@/components/ui/select";
import { cn } from "@/components/ui-primitives";
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
      {/* Work-mode redesign, owner request 6 Oct 2026: the file is the first card, the preview is a
          labelled list with a tick or an alert per row, and the rules sit as a footnote. */}
      {teams.length === 0 ? (
        <T5Note tone="notice">Only a service organiser or admin can import its timetable.</T5Note>
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
          ) : null}
          <T5Section label="Timetable file" right={teams.length === 1 ? teams[0].name : undefined}>
            <div className="work-card grid gap-2 p-3">
              <div className="flex items-center gap-3">
                <T5Icon icon={FileSpreadsheet} />
                <div className="grid min-w-0 gap-0.5">
                  <p className="text-sm font-bold leading-tight break-words text-[color:var(--text-heading)]">
                    {fileName ?? "No file chosen"}
                  </p>
                  <p className="text-xs leading-snug text-[color:var(--text-muted)]">
                    Read on this device. CSV or XLSX, up to 1 MB.
                  </p>
                </div>
              </div>
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
                      : await teachingPost<ImportPreview>(teachingDepthUrl(service), {
                          action: "import.preview",
                          rows,
                        });
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
                  "flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-[var(--work-radius-field)] border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-4 text-sm font-bold text-[color:var(--mode-identity)]",
                  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)] peer-disabled:cursor-default peer-disabled:text-[color:var(--disabled)]",
                )}
              >
                <Upload aria-hidden="true" className="size-icon-md shrink-0" />
                {fileName ? "Choose another CSV or XLSX (up to 1 MB)" : "Choose CSV or XLSX (up to 1 MB)"}
              </label>
              <a
                className={cn(
                  "inline-flex min-h-12 items-center justify-center text-sm font-bold text-[color:var(--mode-identity)]",
                  focusRing,
                )}
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`}
                download="teaching-template.csv"
              >
                Download CSV template
              </a>
            </div>
          </T5Section>
          {busy ? (
            <p role="status" className="text-xs text-[color:var(--text-muted)]">
              Working…
            </p>
          ) : null}
          {preview ? (
            <T5Section label="Preview" right="Nothing imported yet">
              <T5List testId="teaching-import-preview">
                {preview.rows.map((row, index) => {
                  const ready = preview.ready?.length === preview.rows.length ? preview.ready[index] : null;
                  const failed = row.errors.length > 0;
                  return (
                    <li key={row.line} className="flex items-start gap-3 px-3 py-2.5">
                      <T5Icon icon={failed ? TriangleAlert : Check} tone={failed ? "red" : "green"} />
                      <div className="grid min-w-0 gap-0.5">
                        <p className="text-sm font-bold leading-tight break-words text-[color:var(--text-heading)]">
                          {row.title || `Line ${row.line}`}
                        </p>
                        {ready ? (
                          <p
                            className="text-xs leading-snug text-[color:var(--text-muted)]"
                            data-testid="teaching-import-preview-when"
                          >
                            {previewLine(ready)}
                          </p>
                        ) : (
                          <p className="text-xs leading-snug text-[color:var(--text-muted)]">Line {row.line}</p>
                        )}
                        {row.errors.map((message) => (
                          <p
                            key={message}
                            role="alert"
                            className="text-xs leading-snug text-[color:var(--danger-text)]"
                          >
                            {message}
                          </p>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </T5List>
              <T5Note tone="notice" icon="alert">
                Check dates and Perth times. Import adds new series, then assign presenters in Organise.
              </T5Note>
              <div className={teachingStickySubmit}>
                <WorkButton
                  size="wide"
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
                </WorkButton>
              </div>
            </T5Section>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[color:var(--danger-text)]">
          {error}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="text-xs font-semibold text-[color:var(--success-text)]">
          {result}
        </p>
      ) : null}
      <T5Note icon="shield">
        A service timetable only. No patient details, attendance, passcodes or slides. Only timetable rows are sent for
        preview.
      </T5Note>
    </TeachingDepthPage>
  );
}
export function TeachingImport(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={ImportPage} {...props} />;
}

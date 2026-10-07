"use client";

import { Download, FileText, History, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
} from "@/components/mode-kit/work";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, textMuted } from "@/components/ui-primitives";
import { AssessmentsSampleLine } from "@/components/work-screens/assessments/assessments-sample-gate";
import { downloadTextFile } from "@/lib/admin/download-file";
import { initialAssessmentsState, todayLabel } from "@/lib/teaching/assessments/model";
import {
  DEFAULT_ASSESSMENTS_EXPORT,
  EXPORT_PERIODS,
  epaCsv,
  exportBlocker,
  exportPreview,
  exportButtonLabel,
  exportDoctors,
  exportFiles,
  signedForms,
  statusCsv,
  type AssessmentsExportOptions,
  type ExportPeriod,
} from "@/lib/work-screens/assessments/export";

function Toggle({
  label,
  detail,
  on,
  onChange,
  testId,
}: {
  label: string;
  detail: string;
  on: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  return (
    <li className="min-w-0 border-t border-[color:var(--border)] first:border-t-0">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        data-testid={testId}
        className={cn(focusRing, "flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left")}
      >
        <span className="grid min-w-0 flex-1">
          <span className="text-sm font-medium text-[color:var(--text-heading)]">{label}</span>
          <span className={cn(textMuted, "text-xs")}>{detail}</span>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none",
            on
              ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)]"
              : "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]",
          )}
        >
          <span
            className={cn(
              "absolute size-5 rounded-full bg-[color:var(--surface-raised)] transition-transform motion-reduce:transition-none",
              on ? "translate-x-[1.05rem]" : "translate-x-0.5",
            )}
          />
        </span>
      </button>
    </li>
  );
}

/**
 * Assessments Export (`/teaching/assessments/export`, mock-ups assess_export and assess_pdf). Choose
 * what to include, which doctor and which period, then save the spreadsheets made on this page, and
 * open each signed form as its printable copy. Made-up records only, and every file says so.
 */
export function AssessmentsExportPage() {
  const s = useMemo(() => initialAssessmentsState(), []);
  const [options, setOptions] = useState<AssessmentsExportOptions>(DEFAULT_ASSESSMENTS_EXPORT);
  const [saved, setSaved] = useState<string | null>(null);
  const doctors = useMemo(() => exportDoctors(s), [s]);
  const forms = options.forms ? signedForms(s, options) : [];
  const files = exportFiles(options);
  const blocker = exportBlocker(s, options);
  const preview = exportPreview(s, options);
  useModeBandHeading({ eyebrow: "Your supervision records", title: "Export" });
  const set = (patch: Partial<AssessmentsExportOptions>) => {
    setSaved(null);
    setOptions((current) => ({ ...current, ...patch }));
  };

  function save() {
    const date = todayLabel(s);
    files.forEach((file, index) => {
      const text = file.id === "epas" ? epaCsv(s, options, date) : statusCsv(s, options, date);
      // A short gap between files, so a browser that allows one download per tap still offers both.
      // Each file carries its own byte-order mark, so none is added here.
      window.setTimeout(() => downloadTextFile(text, file.name, "text/csv;charset=utf-8"), index * 400);
    });
    setSaved(
      files.length === 1
        ? `Saved ${files[0]!.name}. Check your downloads.`
        : `Saved ${files.length} spreadsheets. Check your downloads.`,
    );
  }

  return (
    <main className="min-w-0" data-testid="assessments-export-page">
      <WorkBody>
        <h1 className="sr-only">Export your supervision records</h1>
        <AssessmentsSampleLine />

        <WorkSectionLabel>Include</WorkSectionLabel>
        <WorkCard as="ul" testId="assessments-export-include">
          <Toggle
            label="Signed forms"
            detail="One printable copy per form"
            on={options.forms}
            onChange={(forms) => set({ forms })}
            testId="assessments-export-forms"
          />
          <Toggle
            label="EPAs"
            detail="Spreadsheet: level of supervision and who recorded it"
            on={options.epas}
            onChange={(epas) => set({ epas })}
            testId="assessments-export-epas"
          />
          <Toggle
            label="Term status"
            detail="Spreadsheet: done, due or overdue. No ratings or comments"
            on={options.status}
            onChange={(status) => set({ status })}
            testId="assessments-export-status"
          />
        </WorkCard>

        <WorkSectionLabel>Doctors</WorkSectionLabel>
        <WorkChips scroll label="Doctors">
          <WorkChip
            selected={options.doctor === "all"}
            onClick={() => set({ doctor: "all" })}
            testId="assessments-export-doctor-all"
          >
            All
          </WorkChip>
          {doctors.map((d) => (
            <WorkChip
              key={d.id}
              selected={options.doctor === d.id}
              onClick={() => set({ doctor: d.id })}
              testId={`assessments-export-doctor-${d.id}`}
            >
              {d.name}
            </WorkChip>
          ))}
        </WorkChips>

        <WorkSectionLabel>Period</WorkSectionLabel>
        <SegmentedControl
          label="Period"
          layout="equal"
          value={options.period}
          onChange={(period) => set({ period: period as ExportPeriod })}
          options={EXPORT_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
        />

        {files.length ? (
          <WorkCard as="ul" testId="assessments-export-preview" aria-label="What the files would hold">
            {options.epas ? (
              <li className="min-w-0">
                <WorkIconRow
                  icon={FileText}
                  tone="neutral"
                  title={files.find((f) => f.id === "epas")?.name ?? "EPAs"}
                  sub={preview.epaRows === 1 ? "1 made-up EPA" : `${preview.epaRows} made-up EPAs`}
                />
              </li>
            ) : null}
            {options.status ? (
              <li className="min-w-0">
                <WorkIconRow
                  icon={FileText}
                  tone="neutral"
                  title={files.find((f) => f.id === "status")?.name ?? "Term status"}
                  sub={preview.statusRows === 1 ? "1 made-up doctor" : `${preview.statusRows} made-up doctors`}
                />
              </li>
            ) : null}
          </WorkCard>
        ) : null}
        {files.length && !blocker ? (
          <WorkButton size="wide" icon={Download} onClick={save} testId="assessments-export-save">
            {exportButtonLabel(options)}
          </WorkButton>
        ) : null}
        {blocker ? (
          <p className={cn(textMuted, "px-1 text-center text-sm")} data-testid="assessments-export-blocker">
            {blocker}
          </p>
        ) : null}
        {saved ? (
          <p
            role="status"
            className="px-1 text-center text-sm text-[color:var(--text)]"
            data-testid="assessments-export-saved"
          >
            {saved}
          </p>
        ) : null}

        {options.forms ? (
          <>
            <WorkSectionLabel count={forms.length}>Signed forms</WorkSectionLabel>
            {forms.length ? (
              <WorkCard as="ul" testId="assessments-export-form-list">
                {forms.map((form) => (
                  <li key={form.id} className="min-w-0">
                    <WorkIconRow icon={FileText} tone="neutral" title={form.title} sub={form.detail} href={form.href} />
                  </li>
                ))}
              </WorkCard>
            ) : (
              <WorkEmpty
                icon={FileText}
                title="No signed forms for this doctor here"
                body="This sample holds signed forms for Dr Sam Lee only."
                testId="assessments-export-no-forms"
              />
            )}
            <p className={cn(textMuted, "px-1 text-xs")}>
              Open a form to see its printable copy. The doctor emails the signed form to the MEU. PsychSift
              doesn&apos;t send it.
            </p>
          </>
        ) : null}

        <WorkSectionLabel>Also</WorkSectionLabel>
        <WorkCard as="ul">
          <li className="min-w-0">
            <WorkIconRow
              icon={Users}
              title="Supervision hours"
              sub="Kept in Supervision, with your confirmed hours"
              href="/teaching/supervision"
            />
          </li>
          <li className="min-w-0">
            <WorkIconRow
              icon={History}
              title="History"
              sub="Every form and EPA signed so far"
              href="/teaching/assessments?view=all&as=supervisor"
            />
          </li>
        </WorkCard>
        <p className={cn(textMuted, "px-1 text-center text-xs")}>
          Files are made on this device. Made-up records are left out of them. Nothing is uploaded or sent.
        </p>
      </WorkBody>
    </main>
  );
}

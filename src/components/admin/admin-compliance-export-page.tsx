"use client";

import { FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";

import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageBreadcrumbs, InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modeModuleSurface } from "@/components/mode-kit/recipes";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { focusRing } from "@/components/card-recipes";
import {
  buildComplianceOverview,
  COMPLIANCE_EXPORT_HEADER,
  complianceExportAboutRows,
  complianceExportFileName,
  complianceExportRows,
  complianceExportSelection,
  type ComplianceExportRange,
} from "@/lib/admin/compliance-overview";
import { downloadTextFile } from "@/lib/admin/download-file";
import { selectNewJobStart } from "@/lib/admin/new-job-progress";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { buildXlsx, XLSX_MIME } from "@/lib/admin/xlsx-lite";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { useOnCallEntries } from "@/lib/on-call/entry-store";

/** The columns a reader can drop. Item (column 0) always stays, so every row still names its requirement. */
const OPTIONAL_COLUMNS = COMPLIANCE_EXPORT_HEADER.slice(1);
/** The 5 Oct mock-up starts with Item, Group, Status and the recorded date. */
const DEFAULT_COLUMNS: readonly string[] = ["Group", "Status", "Date you recorded"];
const WIDTHS: Record<string, number> = {
  Item: 34,
  Group: 14,
  Status: 18,
  "Date you recorded": 18,
  "Before your next job": 44,
  Rule: 16,
  Source: 34,
  "Source checked": 16,
};
const PREVIEW_ROWS = 6;

const RANGE_OPTIONS = [
  { value: "everything", label: "Everything" },
  { value: "next-60-days", label: "Next 60 days" },
] as const satisfies readonly { value: ComplianceExportRange; label: string }[];

/**
 * Admin · Compliance · Export (5 Oct mock-up v2, screen 14): a personal copy
 * of the doctor's own record as an Excel file, saved on this device. Nothing
 * is uploaded or sent; the file is built in the page. PDF is not offered
 * because no PDF export of this table exists.
 */
export function AdminComplianceExportPage({ now: nowProp }: { now?: Date } = {}) {
  const state = useOnCallEntries();
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  const today = perthCalendarDate(now);
  const loadState = adminLoadState(state);
  const [signInOpen, setSignInOpen] = useState(false);
  const [columns, setColumns] = useState<readonly string[]>(DEFAULT_COLUMNS);
  const [range, setRange] = useState<ComplianceExportRange>("everything");

  const overview = useMemo(() => {
    const own = selectAdminOwnEntries(state);
    const shared = selectAdminSharedEntries(state);
    const start = selectNewJobStart({ own, shared });
    return buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, own, now, start?.startsOn ?? null);
  }, [state, now]);

  const selection = useMemo(
    () => complianceExportSelection(complianceExportRows(overview), overview, columns, range, today),
    [overview, columns, range, today],
  );
  const header = selection[0] ?? [];
  const body = selection.slice(1);
  const fileName = complianceExportFileName(now);

  function toggleColumn(name: string) {
    setColumns((current) => (current.includes(name) ? current.filter((c) => c !== name) : [...current, name]));
  }

  function save() {
    const bytes = buildXlsx([
      { name: "Items", rows: selection, widths: header.map((name) => WIDTHS[name] ?? 18) },
      { name: "About this file", rows: complianceExportAboutRows(overview, now), widths: [110] },
    ]);
    downloadTextFile(bytes, fileName, XLSX_MIME);
    announce("Compliance spreadsheet saved.");
  }

  return (
    <InformationPageShell testId="admin-compliance-export-main">
      <div className="grid min-w-0 gap-1">
        <InformationPageBreadcrumbs home={{ label: "Compliance", href: ADMIN_PAGE_HREFS.compliance }} />
        <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">Export a copy</h1>
        <p className={cn(textMuted, "text-sm")}>Your own record as a spreadsheet, saved on this device</p>
      </div>

      {loadState === "loading" ? (
        <ModeModuleSkeleton rows={6} twoLine testId="admin-compliance-export-loading" />
      ) : loadState === "failed" ? (
        <AdminLoadFailed
          reason={state.isOffline ? "offline" : "failed"}
          onRetry={state.retry}
          testId="admin-compliance-export-failed"
        />
      ) : loadState === "signed-out" ? (
        <>
          <EmptyState
            title="Sign in to export your compliance"
            body="Your records are kept for your signed-in account only."
            actions={
              <Button variant="primary" onClick={() => setSignInOpen(true)}>
                Sign in
              </Button>
            }
            testId="admin-compliance-export-signed-out"
          />
          <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
      ) : (
        <div className="grid min-w-0 gap-5" data-testid="admin-compliance-export-ready">
          {state.demoMode ? (
            <ModeNotice testId="admin-compliance-export-demo-notice">
              Example records. These dates are made up, and nothing here is your own.
            </ModeNotice>
          ) : null}

          <section className={cn(modeModuleSurface, "grid min-w-0 gap-3 p-4")} aria-labelledby="export-preview">
            <div className="flex min-w-0 items-center gap-2">
              <FileSpreadsheet aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
              <h2
                id="export-preview"
                className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--text-heading)]"
              >
                {fileName}
              </h2>
              <span
                className={cn(textMuted, "shrink-0 text-xs tabular-nums")}
                data-testid="admin-compliance-export-count"
              >
                {`${body.length} ${body.length === 1 ? "row" : "rows"}`}
              </span>
            </div>
            {body.length === 0 ? (
              <p className={cn(textMuted, "text-sm")} data-testid="admin-compliance-export-empty">
                Nothing falls due in the next 60 days. Choose Everything to export every item.
              </p>
            ) : (
              <div className="min-w-0 overflow-x-auto" data-testid="admin-compliance-export-preview">
                <table className="w-full min-w-0 border-collapse text-left text-xs">
                  <thead>
                    <tr>
                      {header.map((name) => (
                        <th
                          key={name}
                          scope="col"
                          className="border-b border-[color:var(--border)] py-1.5 pr-3 font-medium whitespace-nowrap text-[color:var(--text-muted)]"
                        >
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.slice(0, PREVIEW_ROWS).map((row, index) => (
                      <tr key={`${row[0]}-${index}`}>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={header[cellIndex]}
                            className="border-b border-[color:var(--border)] py-1.5 pr-3 align-top text-[color:var(--text)]"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {body.length > PREVIEW_ROWS ? (
              <p className={cn(textMuted, "text-xs")}>{`${body.length - PREVIEW_ROWS} more rows in the file`}</p>
            ) : null}
            <div className={cn(modeInsetHairline, "grid gap-1 pt-3")}>
              <p className="text-xs text-[color:var(--text)]">Two sheets: Items, and About this file.</p>
              <p className={cn(textMuted, "text-xs")}>
                About this file: every date was entered by you. Nothing here has been checked with the issuing body.
              </p>
            </div>
          </section>

          <fieldset className="grid min-w-0 gap-2">
            <legend className={cn(eyebrowText, "mb-2 flex w-full justify-between px-1")}>
              <span>Columns</span>
              <span className="tabular-nums" data-testid="admin-compliance-export-column-count">
                {`${header.length} of ${COMPLIANCE_EXPORT_HEADER.length}`}
              </span>
            </legend>
            <div className="flex min-w-0 flex-wrap gap-2">
              <span className="inline-flex min-h-12 items-center rounded-full border border-[color:var(--border)] px-4 text-sm text-[color:var(--text-muted)]">
                Item, always
              </span>
              {OPTIONAL_COLUMNS.map((name) => {
                const on = columns.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleColumn(name)}
                    data-testid={`admin-compliance-export-column-${name.toLowerCase().replaceAll(" ", "-")}`}
                    className={cn(
                      focusRing,
                      "inline-flex min-h-12 items-center rounded-full border px-4 text-sm",
                      on
                        ? "border-[color:var(--text-heading)] font-medium text-[color:var(--text-heading)]"
                        : "border-[color:var(--border)] text-[color:var(--text-muted)]",
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid min-w-0 gap-2">
            <p id="export-dates" className={cn(eyebrowText, "px-1")}>
              Dates
            </p>
            <SegmentedControl
              ariaLabelledBy="export-dates"
              value={range}
              onChange={setRange}
              options={RANGE_OPTIONS}
              layout="equal"
            />
          </div>

          <div className="grid min-w-0 gap-2">
            <Button
              variant="primary"
              block
              onClick={save}
              disabled={body.length === 0}
              testId="admin-compliance-export-save"
            >
              Save to phone
            </Button>
            <p className={cn(textMuted, "px-1 text-xs")}>
              This file is for you. Nothing is sent to your health service.
            </p>
          </div>
        </div>
      )}
    </InformationPageShell>
  );
}

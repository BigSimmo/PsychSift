"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";

import { AdminNote, AdminPage, AdminSkeleton, adminStyles } from "@/components/admin/admin-kit";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { focusRing } from "@/components/card-recipes";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageBreadcrumbs } from "@/components/information-page-shell";
import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import { ModeNotice } from "@/components/mode-kit/notice";
import { WorkButton, WorkChip, WorkDock, WorkIconCircle, WorkSectionLabel } from "@/components/mode-kit/work";
import { WorkStateNotice } from "@/components/mode-kit/work-state";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/components/ui-primitives";
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
import { useExampleData } from "@/lib/example-data/store";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { guardExampleAction } from "@/lib/example-data/guards";

/** The columns a reader can drop. Item (column 0) always stays, so every row still names its requirement. */
const OPTIONAL_COLUMNS = COMPLIANCE_EXPORT_HEADER.slice(1);
/**
 * The 5 Oct mock-up starts with Item, Group, Status and the recorded date; Rule
 * and Source are on too, so a default file still says where each rule comes
 * from and which rules are unconfirmed.
 */
const DEFAULT_COLUMNS: readonly string[] = ["Group", "Status", "Date you recorded", "Rule", "Source"];
const WIDTHS: Record<string, number> = {
  Item: 34,
  Group: 14,
  Status: 18,
  "Date you recorded": 18,
  "Before your next job": 44,
  Rule: 16,
  Source: 34,
  "Rule updated": 16,
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
  // The example data banner already says these are example records; this notice is for the demo build.
  const examplesBanner = useExampleData("admin").active;
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
  const fileName = complianceExportFileName(now, state.demoMode);

  function toggleColumn(name: string) {
    setColumns((current) => (current.includes(name) ? current.filter((c) => c !== name) : [...current, name]));
  }

  function save() {
    // Example records never leave the app (the local demo build keeps its labelled demo export).
    if (!guardExampleAction(state.sample, "export")) return;
    const bytes = buildXlsx([
      { name: "Items", rows: selection, widths: header.map((name) => WIDTHS[name] ?? 18) },
      {
        name: "About this file",
        rows: complianceExportAboutRows(overview, now, {
          range,
          omittedColumns: OPTIONAL_COLUMNS.filter((name) => !columns.includes(name)),
          rows: body.length,
          demo: state.demoMode,
        }),
        widths: [110],
      },
    ]);
    downloadTextFile(bytes, fileName, XLSX_MIME);
    announce("Compliance spreadsheet saved.");
  }

  useModeBandHeading({ eyebrow: "Compliance", title: "Export a copy" });

  return (
    <AdminPage testId="admin-compliance-export-main">
      <div className="grid min-w-0 gap-1">
        <InformationPageBreadcrumbs home={{ label: "Compliance", href: ADMIN_PAGE_HREFS.compliance }} />
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          Export a copy
        </PageTitleUnderBand>
        <p className="text-sm text-[color:var(--text-muted)]">Your own record as a spreadsheet, saved on this device</p>
      </div>

      {loadState === "loading" ? (
        <div className="grid min-w-0 gap-5" data-testid="admin-compliance-export-loading" aria-busy="true">
          <span className="sr-only">Loading your compliance</span>
          <AdminSkeleton className="h-36" />
          <AdminSkeleton className="h-24" />
          <AdminSkeleton className="h-16" />
        </div>
      ) : loadState === "failed" ? (
        <AdminLoadFailed
          reason={state.loadError ?? "failed"}
          onRetry={state.retry}
          testId="admin-compliance-export-failed"
        />
      ) : loadState === "signed-out" ? (
        <>
          <WorkStateNotice
            kind="signed-out"
            title="Sign in to export your compliance"
            body="Your records are kept for your signed-in account only."
            onSignIn={() => setSignInOpen(true)}
            testId="admin-compliance-export-signed-out"
          />
          <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
      ) : (
        <div className="grid min-w-0 gap-5" data-testid="admin-compliance-export-ready">
          {state.demoMode && !examplesBanner ? (
            <ModeNotice testId="admin-compliance-export-demo-notice">
              Example records. These dates are made up, and nothing here is your own.
            </ModeNotice>
          ) : null}

          <section className={cn("work-card", adminStyles.exportFile)} aria-labelledby="export-preview">
            <div className="work-row">
              <WorkIconCircle icon={FileSpreadsheet} />
              <span className="work-row__text">
                <h2 id="export-preview" className="work-row__title truncate" title={fileName}>
                  {fileName}
                </h2>
                <span className="work-row__sub">Two sheets: Items, and About this file.</span>
              </span>
              <span className="work-row__end tabular-nums" data-testid="admin-compliance-export-count">
                {`${body.length} ${body.length === 1 ? "row" : "rows"}`}
              </span>
            </div>
            {body.length === 0 ? (
              <p className={adminStyles.exportBody} data-testid="admin-compliance-export-empty">
                {`No recorded dates fall in the next 60 days.${overview.counts["not-recorded"] > 0 ? ` ${overview.counts["not-recorded"]} items have no date recorded yet.` : ""} Choose Everything to export every item.`}
              </p>
            ) : (
              <div
                // A keyboard user scrolls the wide preview sideways once it has focus.
                tabIndex={0}
                role="region"
                aria-label="Preview of the file"
                className={cn(focusRing, adminStyles.exportPreview)}
                data-testid="admin-compliance-export-preview"
                data-no-tab-swipe=""
              >
                <table aria-labelledby="export-preview">
                  <thead>
                    <tr>
                      {header.map((name) => (
                        <th key={name} scope="col">
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.slice(0, PREVIEW_ROWS).map((row, index) => (
                      <tr key={`${row[0]}-${index}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={header[cellIndex]}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {body.length > PREVIEW_ROWS ? (
              <p className={adminStyles.exportBody}>{`${body.length - PREVIEW_ROWS} more rows in the file`}</p>
            ) : null}
          </section>

          <div className={adminStyles.section} role="group" aria-labelledby="export-columns">
            <WorkSectionLabel
              as="h2"
              id="export-columns"
              count={
                <span data-testid="admin-compliance-export-column-count">{`${header.length} of ${COMPLIANCE_EXPORT_HEADER.length}`}</span>
              }
            >
              Columns
            </WorkSectionLabel>
            <div className="work-chips flex-wrap">
              <span className="work-chip" data-testid="admin-compliance-export-column-item">
                Item, always
              </span>
              {OPTIONAL_COLUMNS.map((name) => (
                <WorkChip
                  key={name}
                  selected={columns.includes(name)}
                  onClick={() => toggleColumn(name)}
                  testId={`admin-compliance-export-column-${name.toLowerCase().replaceAll(" ", "-")}`}
                >
                  {name}
                </WorkChip>
              ))}
            </div>
          </div>

          <div className={adminStyles.section}>
            <WorkSectionLabel as="h2" id="export-dates">
              Dates
            </WorkSectionLabel>
            <SegmentedControl
              ariaLabelledBy="export-dates"
              value={range}
              onChange={setRange}
              options={RANGE_OPTIONS}
              layout="equal"
            />
          </div>

          <AdminNote>
            About this file: every date was entered by you. Nothing here has been checked with the issuing body. This
            file is for you. Nothing is sent to your health service.
          </AdminNote>

          <WorkDock aria-label="Export actions">
            <WorkButton
              variant="primary"
              size="wide"
              icon={Download}
              onClick={save}
              disabled={body.length === 0}
              testId="admin-compliance-export-save"
            >
              Save to this device
            </WorkButton>
          </WorkDock>
        </div>
      )}
    </AdminPage>
  );
}

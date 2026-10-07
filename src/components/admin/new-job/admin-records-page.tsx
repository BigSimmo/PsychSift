"use client";

import { Copy, FileText, LogIn, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import { AdminNote, AdminPage, AdminSkeleton, adminStyles } from "@/components/admin/admin-kit";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { AdminNavHeader } from "@/components/admin/admin-nav-header";
import { ADMIN_RECORDS_SECTIONS } from "@/components/admin/admin-page-sections";
import { AdminShowAll } from "@/components/admin/admin-show-all";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { InformationPageBreadcrumbs } from "@/components/information-page-shell";
import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkButton, WorkCard, WorkDock, WorkEmpty, WorkSectionLabel } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import {
  adminRecordsSections,
  adminRecordsText,
  type AdminRecordsRow,
  type AdminRecordsSection,
} from "@/lib/admin/leaving-pack";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { guardExampleAction } from "@/lib/example-data/guards";

/** A group longer than this folds behind "Show all N". */
const RECORDS_PREVIEW_ROWS = 6;

/** Each group's DOM anchor. The rail (`ADMIN_RECORDS_SECTIONS`) offers all but "Not for this job". */
const SECTION_ID: Record<AdminRecordsSection["label"], string> = {
  Renewals: "admin-records-renewals",
  "Not recorded yet": "admin-records-not-recorded",
  "Not for this job": "admin-records-not-for-this-job",
  "New job": "admin-records-new-job",
  Admin: "admin-records-admin",
  Contacts: "admin-records-contacts",
};

function RecordRow({ row }: { row: AdminRecordsRow }) {
  return (
    <li data-testid={`admin-records-row-${row.key}`}>
      <div className="work-row">
        <span className="work-row__text">
          <span className="work-row__title">{row.title}</span>
          {row.lines.map((line) => (
            <span key={line} className="work-row__sub">
              {line}
            </span>
          ))}
        </span>
      </div>
    </li>
  );
}

function RecordGroup({ section, expandAll }: { section: AdminRecordsSection; expandAll: boolean }) {
  const id = SECTION_ID[section.label];
  return (
    <section id={id} className={cn(inPageAnchor, adminStyles.section)} aria-label={section.label}>
      <WorkSectionLabel>
        {section.label}
        <span className="tabular-nums" data-testid={`${id}-count`}>{` · ${section.rows.length}`}</span>
      </WorkSectionLabel>
      <AdminShowAll
        items={section.rows}
        label={section.label}
        testId={`${id}-list`}
        previewRows={RECORDS_PREVIEW_ROWS}
        showCount
        expandAll={expandAll}
        listClassName="work-card work-rows"
        renderItem={(row) => <RecordRow key={row.key} row={row} />}
      />
    </section>
  );
}

/**
 * "Your Admin records" (owner-approved behaviour): an on-screen page, never a
 * download. It lists `adminRecordsSections`: every renewal with its date and
 * earlier dates, what is not recorded yet, what is not for this job, the New
 * job ticks, other Admin rows and contacts. Copy writes the same lines
 * (`adminRecordsText`), dates included. Copy and Print are visible secondary
 * buttons at the top; there is no primary command on this page. A group of
 * more than six rows folds behind "Show all N", and every group opens in full
 * before printing, so paper never loses a row.
 */
export function AdminRecordsPage({ now: nowProp }: { now?: Date } = {}) {
  const state = useOnCallEntries();
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [printAll, setPrintAll] = useState(false);
  const loadState = adminLoadState(state);
  const own = useMemo(() => selectAdminOwnEntries(state), [state]);
  const sections = useMemo(() => adminRecordsSections(own), [own]);

  // The browser's own Print (Ctrl+P) gets every row too, not just the first batch.
  // Once printing ends, or the print dialog is cancelled, the groups fold again.
  useEffect(() => {
    const openAll = () => flushSync(() => setPrintAll(true));
    const foldAgain = () => setPrintAll(false);
    window.addEventListener("beforeprint", openAll);
    window.addEventListener("afterprint", foldAgain);
    return () => {
      window.removeEventListener("beforeprint", openAll);
      window.removeEventListener("afterprint", foldAgain);
    };
  }, []);

  function copy() {
    if (!guardExampleAction(state.sample, "copy")) return;
    void copyTextToClipboard(adminRecordsText(sections, now)).then(
      () => setCopyState("copied"),
      () => setCopyState("failed"),
    );
  }

  function print() {
    if (!guardExampleAction(state.sample, "export")) return;
    flushSync(() => setPrintAll(true));
    window.print();
  }

  useModeBandHeading({ eyebrow: "New job", title: "Your Admin records" });

  return (
    <AdminPage testId="admin-records-main">
      <div className="grid gap-1">
        <div className="print:hidden">
          <InformationPageBreadcrumbs
            home={{ label: "New job", href: "/admin/new-job" }}
            current="Your Admin records"
          />
        </div>
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          Your Admin records
        </PageTitleUnderBand>
        <p className="text-sm text-[color:var(--text-muted)]" data-testid="admin-records-subtitle">
          As you recorded them · {formatDateEcho(perthCalendarDate(now))}
        </p>
      </div>

      {loadState === "ready" ? (
        <div className="print:hidden" data-testid="admin-records-actions">
          {/* A fixed dock at the foot of the screen; first in reading order so the actions come before the groups. */}
          <WorkDock aria-label="Record actions">
            <WorkButton variant="secondary" icon={Copy} onClick={copy} testId="admin-records-copy">
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Could not copy" : "Copy"}
            </WorkButton>
            <WorkButton variant="secondary" icon={Printer} onClick={print} testId="admin-records-print">
              Print
            </WorkButton>
          </WorkDock>
          <span className="sr-only" role="status" aria-live="polite">
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Could not copy" : ""}
          </span>
        </div>
      ) : null}

      {loadState === "ready" ? (
        <div className="print:hidden">
          <AdminNavHeader title="Your Admin records" sections={ADMIN_RECORDS_SECTIONS} />
        </div>
      ) : null}

      {loadState === "failed" ? (
        <AdminLoadFailed reason={state.loadError} onRetry={state.retry} testId="admin-records-load-failed" />
      ) : loadState === "loading" ? (
        // Design point 11: skeletons while loading, never an empty-looking page.
        <div className="grid gap-5" data-testid="admin-records-loading" aria-busy="true">
          <span className="sr-only">Loading your records</span>
          <AdminSkeleton className="h-36" />
          <AdminSkeleton className="h-24" />
        </div>
      ) : loadState === "signed-out" ? (
        <WorkCard>
          <WorkEmpty
            icon={LogIn}
            title="Sign in to see your Admin records"
            body="They are kept for your signed-in account only."
            testId="admin-records-signed-out"
          />
        </WorkCard>
      ) : (
        <>
          {sections.map((section) => (
            <RecordGroup key={section.label} section={section} expandAll={printAll} />
          ))}
          {sections.length === 0 ? (
            <WorkCard>
              <WorkEmpty icon={FileText} title="Nothing recorded yet." testId="admin-records-empty" />
            </WorkCard>
          ) : null}
        </>
      )}

      <AdminNote testId="admin-records-take-with-you">
        For a site or job change, take registration numbers and renewal dates, the contacts and logins you saved, and
        your New job ticks. Hospital files, patient information, and anything you did not type here are not included.
      </AdminNote>
    </AdminPage>
  );
}

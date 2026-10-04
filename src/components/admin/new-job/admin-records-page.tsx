"use client";

import { Copy, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { AdminNavHeader } from "@/components/admin/admin-nav-header";
import { ADMIN_RECORDS_SECTIONS } from "@/components/admin/admin-page-sections";
import { AdminShowAll } from "@/components/admin/admin-show-all";
import { cardSurface, cardPadding } from "@/components/card-recipes";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { InformationPageBreadcrumbs, InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import {
  adminRecordsSections,
  adminRecordsText,
  type AdminRecordsRow,
  type AdminRecordsSection,
} from "@/lib/admin/leaving-pack";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

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
    <li
      className="border-b border-[color:var(--border)] px-3 py-2 last:border-b-0"
      data-testid={`admin-records-row-${row.key}`}
    >
      <span className="block break-words text-sm font-medium text-[color:var(--text-heading)]">{row.title}</span>
      {row.lines.map((line) => (
        <span key={line} className={cn(textMuted, "block break-words text-sm")}>
          {line}
        </span>
      ))}
    </li>
  );
}

function RecordGroup({ section, expandAll }: { section: AdminRecordsSection; expandAll: boolean }) {
  const id = SECTION_ID[section.label];
  return (
    <section id={id} className={cn(inPageAnchor, "grid gap-2")} aria-label={section.label}>
      <h2 className={cn(eyebrowText, "px-1")}>
        {section.label}
        <span className="nums" data-testid={`${id}-count`}>{` · ${section.rows.length}`}</span>
      </h2>
      <AdminShowAll
        items={section.rows}
        label={section.label}
        testId={`${id}-list`}
        previewRows={RECORDS_PREVIEW_ROWS}
        showCount
        expandAll={expandAll}
        listClassName={cn(cardSurface, "overflow-hidden")}
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
    void copyTextToClipboard(adminRecordsText(sections, now)).then(
      () => setCopyState("copied"),
      () => setCopyState("failed"),
    );
  }

  function print() {
    flushSync(() => setPrintAll(true));
    window.print();
  }

  return (
    <>
      {loadState === "ready" ? <AdminNavHeader title="Your Admin records" sections={ADMIN_RECORDS_SECTIONS} /> : null}
      <InformationPageShell testId="admin-records-main">
        <div className="grid gap-1">
          <InformationPageBreadcrumbs
            home={{ label: "New job", href: "/admin/new-job" }}
            current="Your Admin records"
          />
          <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">Your Admin records</h1>
          <p className={cn(textMuted, "text-sm")} data-testid="admin-records-subtitle">
            As you recorded them · {formatDateEcho(perthCalendarDate(now))}
          </p>
          <p className={cn(textMuted, "text-sm")} data-testid="admin-records-take-with-you">
            For a site or job change, take registration numbers and renewal dates, the contacts and logins you saved,
            and your New job ticks. Hospital files, patient information, and anything you did not type here are not
            included.
          </p>
        </div>

        {loadState === "ready" ? (
          <div className="flex flex-wrap items-center gap-2 print:hidden" data-testid="admin-records-actions">
            <Button variant="secondary" size="sm" icon={Copy} onClick={copy} testId="admin-records-copy">
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Could not copy" : "Copy"}
            </Button>
            <Button variant="secondary" size="sm" icon={Printer} onClick={print} testId="admin-records-print">
              Print
            </Button>
            <span className="sr-only" role="status">
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Could not copy" : ""}
            </span>
          </div>
        ) : null}

        {loadState === "failed" ? (
          <AdminLoadFailed reason={state.loadError} onRetry={state.retry} testId="admin-records-load-failed" />
        ) : loadState === "loading" ? (
          // Design point 11: skeletons while loading, never an empty-looking page.
          <ModeModuleSkeleton rows={4} twoLine eyebrow testId="admin-records-loading" />
        ) : loadState === "signed-out" ? (
          <p
            className={cn(cardSurface, cardPadding.compact, textMuted, "text-sm")}
            data-testid="admin-records-signed-out"
          >
            Sign in to see your Admin records. They are kept for your signed-in account only.
          </p>
        ) : (
          <>
            {sections.map((section) => (
              <RecordGroup key={section.label} section={section} expandAll={printAll} />
            ))}
            {sections.length === 0 ? (
              <p
                className={cn(cardSurface, cardPadding.compact, textMuted, "text-sm")}
                data-testid="admin-records-empty"
              >
                Nothing recorded yet.
              </p>
            ) : null}
          </>
        )}
      </InformationPageShell>
    </>
  );
}

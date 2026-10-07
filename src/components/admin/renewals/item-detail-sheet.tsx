"use client";

import { CalendarPlus, Check, CircleSlash, History, Plus, Undo2 } from "lucide-react";
import { useState } from "react";

import { AdminNote, AdminRow, AdminSection, AdminSheet, adminStyles } from "@/components/admin/admin-kit";
import { AdminRuleToConfirm, AdminStatusTag } from "@/components/admin/admin-status-tag";
import { AdminWindow } from "@/components/admin/renewals/window-bar";
import { WorkButton, WorkCard, WorkIconCircle } from "@/components/mode-kit/work";
import { ExternalTextLink, TextLink } from "@/components/ui/link";
import { complianceBucket } from "@/lib/admin/compliance-overview";
import { formatDateEcho, formatRecordedDate, formatRelativeDate, renewalStartOn } from "@/lib/admin/renewal-dates";
import { windowProgress as renewWindowShare } from "@/lib/admin/renew-next";
import { complianceExpiryHistory, issuerCheckStampLabel, renewalCalendarEvent } from "@/lib/admin/renewals";
import type { AdminRequirementCatalogueItem, RequirementChecklistRow } from "@/lib/admin/requirements";
import { downloadTextFile } from "@/lib/admin/download-file";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { icsFileName, toIcs } from "@/lib/calendar/ics";
import { complianceExpiresOn, complianceIssuerCheckedOn, entryNotForThisJob } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

export type ChecklistItemSubject =
  | { readonly kind: "catalogue"; readonly item: AdminRequirementCatalogueItem; readonly entry: OnCallEntry | null }
  | { readonly kind: "personal"; readonly entry: OnCallEntry };

/**
 * The checklist item detail sheet, in the 5 Oct mock-up v2 order (screen 9):
 * status and "Renew by", the renewal window, the dates, where the proof is,
 * the holder-pressed issuer-check stamp, history, then the rule with its
 * source ("Rule to confirm" when the catalogue could not confirm it), "Add to
 * calendar", a quiet "Not for this job" row, and "Renewed" at the foot. The stamp is a
 * holder action only — never "verified" or "compliant".
 */
export function ChecklistItemDetailSheet({
  subject,
  now,
  canEdit = true,
  onClose,
  onRenew,
  onNotForThisJob,
  onIssuerCheck,
  testId = "admin-renewals-item-sheet",
}: {
  readonly subject: ChecklistItemSubject | null;
  readonly now: Date;
  readonly canEdit?: boolean;
  readonly onClose: () => void;
  readonly onRenew: () => void;
  /** Catalogue items only; toggles "not for this job". `entry` is null for an
   *  item never recorded — the page then creates a minimal row to carry the flag
   *  (the design's "Visa and work rights — Not recorded yet — Not for this job"). */
  readonly onNotForThisJob?: (
    item: AdminRequirementCatalogueItem,
    entry: OnCallEntry | null,
    notForThisJob: boolean,
  ) => Promise<void>;
  /** Explicit issuer-check stamp: set today's Perth date, or clear. Never auto-set by Renewed. */
  readonly onIssuerCheck?: (entry: OnCallEntry, checkedOn: string | null) => Promise<void>;
  readonly testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = subject !== null;
  const item = subject?.kind === "catalogue" ? subject.item : undefined;
  const entry = subject?.entry ?? null;
  const expiresOn = entry ? complianceExpiresOn(entry) : undefined;
  const history = entry ? complianceExpiryHistory(entry) : [];
  const flagged = entry ? entryNotForThisJob(entry) : false;
  const issuerCheckedOn = entry ? complianceIssuerCheckedOn(entry) : undefined;
  const proofNote =
    entry?.details && typeof entry.details === "object"
      ? (entry.details as { proofNote?: unknown }).proofNote
      : undefined;
  const today = perthCalendarDate(now);
  const startOn = entry && expiresOn ? (renewalStartOn(entry) ?? null) : null;
  const windowProgress = renewWindowShare(startOn, expiresOn, today);
  const row: RequirementChecklistRow | null =
    subject?.kind === "catalogue"
      ? {
          item: subject.item,
          entry,
          expiresOn,
          state: !entry ? "not-recorded" : expiresOn ? "needs-action" : "no-end-date",
        }
      : null;
  const bucket = row ? complianceBucket(row, today) : null;
  /** A passed date is named as passed everywhere in the sheet, never "Renew by". */
  const dateLabel = bucket === "date-passed" ? "Date passed" : "Renew by";

  async function toggleNotForThisJob() {
    if (!item || !onNotForThisJob) return;
    setBusy(true);
    setError(null);
    try {
      await onNotForThisJob(item, entry, !flagged);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function recordIssuerCheck() {
    if (!entry || !onIssuerCheck) return;
    setBusy(true);
    setError(null);
    try {
      await onIssuerCheck(entry, perthCalendarDate(now));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function clearIssuerCheck() {
    if (!entry || !onIssuerCheck) return;
    setBusy(true);
    setError(null);
    try {
      await onIssuerCheck(entry, null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  function addToCalendar() {
    if (!entry) return;
    const event = renewalCalendarEvent(entry, now);
    if (!event) return;
    downloadTextFile(toIcs([event]), icsFileName(entry.title), "text/calendar;charset=utf-8");
  }

  const showWindow = Boolean(expiresOn && startOn && windowProgress !== null);
  const relative = expiresOn ? formatRelativeDate(expiresOn, today) : "";
  const relativeLine = expiresOn
    ? `${relative.charAt(0).toUpperCase()}${relative.slice(1)}${
        startOn && startOn <= today && expiresOn >= today
          ? ` · renewal window opened ${formatRecordedDate(startOn)}`
          : ""
      }`
    : null;

  return (
    <AdminSheet
      open={open}
      onClose={onClose}
      title={item?.title ?? entry?.title ?? ""}
      description="Recorded by you, not confirmed with the issuing body."
      testId={testId}
      footer={
        canEdit ? (
          <div className="grid gap-2">
            {error ? (
              <p className="work-row__sub m-0" role="alert">
                {error}
              </p>
            ) : null}
            <WorkButton size="wide" icon={entry ? Check : Plus} onClick={onRenew} testId={`${testId}-renew`}>
              {entry ? "Renewed" : "Add date"}
            </WorkButton>
          </div>
        ) : undefined
      }
    >
      {subject ? (
        // One surface (the sheet); its groups are flat white cards with hairlines.
        <div className={adminStyles.column} data-testid={`${testId}-groups`}>
          {row ? (
            <WorkCard padded testId={`${testId}-status-block`}>
              <div className="grid gap-1.5">
                <AdminStatusTag status={bucket ?? "not-recorded"} testId={`${testId}-status`} />
                {expiresOn ? (
                  <span className={adminStyles.sheetBig}>{`${dateLabel} ${formatDateEcho(expiresOn)}`}</span>
                ) : (
                  <span className={adminStyles.sheetBig}>
                    {row.state === "no-end-date" ? "Recorded, no end date" : "No date recorded yet"}
                  </span>
                )}
                {relativeLine ? <span className="work-row__sub">{relativeLine}</span> : null}
              </div>
              {showWindow && startOn && expiresOn && windowProgress !== null ? (
                <div className="mt-3">
                  <AdminWindow
                    progress={windowProgress}
                    start={`${startOn <= today ? "Opened" : "Opens"} ${formatRecordedDate(startOn)}`}
                    end={`${dateLabel} ${formatRecordedDate(expiresOn)}`}
                    showToday={startOn <= today && expiresOn >= today}
                    testId={`${testId}-window`}
                  />
                </div>
              ) : null}
            </WorkCard>
          ) : null}

          <WorkCard>
            <dl className={adminStyles.kv}>
              <div className={adminStyles.kvRow}>
                <dt>{expiresOn ? (row ? dateLabel : "Expiry date") : "Renew by"}</dt>
                <dd data-testid={`${testId}-expiry`}>
                  {expiresOn
                    ? formatRecordedDate(expiresOn)
                    : row?.state === "no-end-date"
                      ? "No end date"
                      : "Not recorded yet"}
                </dd>
              </div>
              {startOn ? (
                <div className={adminStyles.kvRow}>
                  <dt>Start renewing from</dt>
                  <dd>{formatRecordedDate(startOn)}</dd>
                </div>
              ) : null}
              {proofNote ? (
                <div className={adminStyles.kvRow}>
                  <dt>Where your proof is</dt>
                  <dd className="font-normal">{String(proofNote)}</dd>
                </div>
              ) : null}
            </dl>
          </WorkCard>

          {entry ? (
            <WorkCard padded testId={`${testId}-issuer-check`}>
              <p className="work-row__title m-0" data-testid={`${testId}-issuer-check-label`}>
                {issuerCheckStampLabel(issuerCheckedOn)}
              </p>
              <p className="work-row__sub m-0">Press this only after you have looked it up with the issuer yourself.</p>
              {canEdit && onIssuerCheck ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-2">
                  <WorkButton
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void recordIssuerCheck()}
                    testId={`${testId}-issuer-check-record`}
                  >
                    Record issuer check today
                  </WorkButton>
                  {issuerCheckedOn ? (
                    <WorkButton
                      variant="quiet"
                      disabled={busy}
                      onClick={() => void clearIssuerCheck()}
                      testId={`${testId}-issuer-check-clear`}
                    >
                      Clear issuer check
                    </WorkButton>
                  ) : null}
                </div>
              ) : null}
            </WorkCard>
          ) : (
            <p className="work-row__sub m-0 px-1" data-testid={`${testId}-issuer-check-label`}>
              No issuer check recorded
            </p>
          )}

          {history.length > 0 ? (
            <AdminSection label="History" count={`${history.length + 1} versions`} testId={`${testId}-history`}>
              <WorkCard as="ul">
                {history.map((date) => (
                  <AdminRow
                    key={date}
                    lead={<WorkIconCircle icon={History} tone="neutral" />}
                    title={`Recorded before: ${formatRecordedDate(date)}`}
                    sub="Replaced when you recorded a new date"
                  />
                ))}
              </WorkCard>
            </AdminSection>
          ) : null}

          {item ? (
            <AdminSection label="Rule" testId={`${testId}-rule`}>
              <WorkCard padded>
                {item.status === "confirmed" ? (
                  <p className="work-row__title m-0 leading-snug">{item.rule}</p>
                ) : (
                  <div className="grid gap-1">
                    <AdminRuleToConfirm />
                    <p className="work-row__title m-0">
                      Confirm this with your service or the source before relying on it.
                    </p>
                    <p className="work-row__sub m-0">{item.whatIsUnconfirmed}</p>
                  </div>
                )}
                <ExternalTextLink href={item.sourceUrl} className="min-h-tap w-fit items-center text-xs">
                  {`Source: ${item.sourceName} · Updated ${formatRecordedDate(item.updated)}`}
                </ExternalTextLink>
                {/* Spec review 20: a plain link from the medical registration item to
                    CPD's own year check. Navigation only: Admin reads no CPD data. */}
                {item.id === "medical-registration-renewal" ? (
                  <TextLink
                    href="/cme/check"
                    data-testid="admin-renewals-cpd-link"
                    className="min-h-tap w-fit items-center text-sm"
                  >
                    Open CPD year check
                  </TextLink>
                ) : null}
              </WorkCard>
            </AdminSection>
          ) : null}

          {entry || (item && onNotForThisJob) ? (
            <WorkCard as="ul">
              {entry ? (
                <AdminRow
                  lead={<WorkIconCircle icon={CalendarPlus} />}
                  title="Add to calendar"
                  sub={startOn ? `Reminder ${formatRecordedDate(startOn)}` : "One calendar file for this date"}
                  onClick={addToCalendar}
                  testId={`${testId}-calendar`}
                />
              ) : null}
              {item && onNotForThisJob ? (
                <AdminRow
                  lead={<WorkIconCircle icon={flagged ? Undo2 : CircleSlash} tone="neutral" />}
                  title={flagged ? "Move back" : "Not for this job"}
                  sub={flagged ? "Put it back on your checklist" : "Move it out of your checklist"}
                  onClick={() => void toggleNotForThisJob()}
                  disabled={busy}
                  testId={`${testId}-not-for-this-job`}
                />
              ) : null}
            </WorkCard>
          ) : null}

          <AdminNote>Dates you entered or confirmed, not a check.</AdminNote>
        </div>
      ) : null}
    </AdminSheet>
  );
}

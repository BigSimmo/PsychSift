"use client";

import { ServiceStructuredPreview } from "@/components/on-call/service-structured-preview";

import { Clipboard, ExternalLink, Flag, NotebookPen, Pencil, Phone, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ServiceSiteHours } from "@/components/on-call/service-site-hours";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import { HandbookResourceCatalogue } from "@/components/on-call/handbook-resource-catalogue";
import { OnCallCopyNumber } from "@/components/on-call/on-call-copy-number";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { cardSurface, focusRing } from "@/components/card-recipes";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InlineNotice, cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { resolveHandbookPhone, spokenOnCallNumber } from "@/lib/on-call/number-resolver";
import type { ServiceAction, ServiceDetail, ServiceEntry } from "@/lib/on-call/service-model";
import { formatOnCallDate } from "@/components/on-call/on-call-dates";

type ReportAction = Extract<ServiceAction, { action: "report.create" }>;

const handbookGroups = [
  "contacts",
  "referrals",
  "resources",
  "documentation",
  "teaching",
  "admin",
  "playbook",
  "cover",
] as const;
const groupLabels: Record<(typeof handbookGroups)[number], string> = {
  contacts: "Local contacts",
  referrals: "Local referrals",
  resources: "Local resources",
  documentation: "Documentation",
  teaching: "Teaching",
  admin: "Service administration",
  playbook: "Hospital playbook",
  cover: "Role cover",
};

function humanStatus(status: ServiceEntry["status"]): string {
  if (status === "pending_review") return "Awaiting independent review";
  return status[0].toUpperCase() + status.slice(1);
}

function updateLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Review date unavailable" : `Draft saved ${formatOnCallDate(date)}`;
}

function learningHref(entry: ServiceEntry): string | null {
  const source = entry.content.sources[0];
  if (!source) return null;
  return `/cme/new?${new URLSearchParams({ title: entry.content.title, sourceUrl: source.url }).toString()}`;
}

function ServiceEntryCard({
  entry,
  siteName,
  canEdit,
  onEdit,
  onReport,
  onConfirm,
}: {
  readonly entry: ServiceEntry;
  readonly siteName: string;
  readonly canEdit: boolean;
  readonly onEdit: () => void;
  readonly onReport: (action: ReportAction) => Promise<void>;
  readonly onConfirm?: () => Promise<unknown>;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const learning = learningHref(entry);
  // For editors `content` is the DRAFT and withdrawn rows are included, so the
  // Call button dials only the published number (as `publishedHandbookItems`
  // does). An unpublished number is shown as plain text, never as a call link.
  const published = entry.status === "withdrawn" ? null : entry.publishedContent;
  const dial = resolveHandbookPhone(published?.phone ?? "");
  const unpublishedPhone =
    entry.content.phone.trim() &&
    entry.content.phone !== published?.phone &&
    !entry.content.steps &&
    !entry.content.cover
      ? entry.content.phone
      : null;

  async function submitReport() {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onReport({ action: "report.create", entryId: entry.id, reason: reason.trim() });
      setReason("");
      setReportOpen(false);
    } catch (cause) {
      if (
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        (cause instanceof TypeError && cause.message.includes("fetch"))
      ) {
        setError("You are offline. Connect to send a correction.");
      } else {
        setError(cause instanceof Error ? cause.message : "This correction could not be reported.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!onConfirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm this entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      id={onCallEntryAnchorId(entry.id)}
      tabIndex={-1}
      className={cn(cardSurface, "min-w-0 scroll-mt-32 p-4")}
      data-testid={`service-entry-${entry.id}`}
    >
      <div className="grid gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="break-words text-sm font-medium text-[color:var(--text-heading)]">
              <a
                href={`#${onCallEntryAnchorId(entry.id)}`}
                className={cn(focusRing, "inline-flex min-h-tap items-center break-words")}
                onClick={() => {
                  window.requestAnimationFrame(() => {
                    document.getElementById(onCallEntryAnchorId(entry.id))?.focus();
                  });
                }}
              >
                {entry.content.title}
              </a>
            </h4>
            <p className={cn(textMuted, "mt-0.5 break-words text-xs")}>
              {siteName} · {humanStatus(entry.status)}
              {entry.revision !== entry.publishedRevision ? ` · ${updateLabel(entry.updatedAt)}` : ""}
            </p>
          </div>
          {canEdit ? (
            <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>
              Edit
            </Button>
          ) : null}
        </div>

        <ServiceStructuredPreview content={entry.content} />
        <OnCallUpdatedLine updatedAt={entry.publishedAt ?? null} lastConfirmedAt={entry.lastConfirmedAt} />
        {onConfirm ? (
          <Button variant="secondary" busy={busy} onClick={() => void confirm()}>
            Still correct
          </Button>
        ) : null}
        {error && !reportOpen ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
        {entry.content.body ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[color:var(--text)]">
            {entry.content.body}
          </p>
        ) : null}
        {dial.kind !== "none" ? (
          <div className="flex min-h-tap min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-[color:var(--text)]">
            {dial.tel ? (
              <a
                href={dial.tel}
                // Opens with the words the button shows ("Call 5550 0000"), then who (A11Y-02).
                aria-label={`Call ${dial.display} (${spokenOnCallNumber(dial.display)}), ${entry.content.title}`}
                className={cn(buttonFaceClass({ variant: "primary", size: "sm" }), focusRing, "min-w-0 no-underline")}
              >
                <Phone aria-hidden="true" className="size-icon-sm shrink-0" />
                <span className="nums break-all font-normal">Call {dial.display}</span>
              </a>
            ) : (
              <span className="nums min-w-0 flex-1 break-all font-normal">
                {dial.display}
                {dial.route === "hospital-phone" ? (
                  <span className={cn(textMuted, "ml-2 text-xs")}>From a hospital phone</span>
                ) : null}
              </span>
            )}
            {dial.copy ? (
              <OnCallCopyNumber
                value={dial.copy}
                label={`${dial.route === "hospital-phone" ? "Copy extension" : "Copy number"} for ${entry.content.title}`}
                testId={`service-entry-${entry.id}-copy-phone`}
              />
            ) : null}
          </div>
        ) : null}

        {unpublishedPhone ? (
          <p className="nums break-all text-sm font-normal text-[color:var(--text)]">
            Phone or extension: {unpublishedPhone}
            <span className={cn(textMuted, "ml-2 text-xs")}>Not published</span>
          </p>
        ) : null}

        {entry.content.kind !== "operational" && entry.reviewedAt && entry.publishedRevision === entry.revision ? (
          <p className={cn(textMuted, "break-words text-xs")}>
            Reviewed {formatOnCallDate(entry.reviewedAt)}
            {entry.reviewedBy ? ` · reviewer ${entry.reviewedBy.slice(0, 8)}` : ""}
          </p>
        ) : null}

        {entry.content.sources.length > 0 ? (
          <div className="grid gap-1.5">
            <p className={cn(textMuted, "text-2xs font-semibold uppercase tracking-kicker")}>Source links</p>
            {entry.content.sources.map((source) => (
              <a
                key={`${source.url}:${source.label}`}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  focusRing,
                  "inline-flex min-h-tap min-w-0 items-center gap-2 rounded-sm text-sm font-semibold text-[color:var(--clinical-accent)]",
                )}
              >
                <ExternalLink aria-hidden="true" className="size-icon-sm shrink-0" />
                <span className="break-words">{source.label}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className={cn(textMuted, "text-xs")}>No source link is recorded for this operational entry.</p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {/* The server refuses a report on an entry with no published revision. */}
          {published ? (
            <Button variant="secondary" size="sm" icon={Flag} onClick={() => setReportOpen((open) => !open)}>
              Flag incorrect entry
            </Button>
          ) : null}
          {learning ? (
            <Link
              href={learning}
              className={cn(
                buttonFaceClass({ variant: "ghost", size: "sm" }),
                focusRing,
                "min-w-0 justify-center whitespace-normal text-center no-underline",
              )}
            >
              <NotebookPen aria-hidden="true" className="size-icon-sm shrink-0" />
              Log this learning
            </Link>
          ) : null}
        </div>

        {reportOpen ? (
          <div className="grid gap-2 border-t border-[color:var(--border)] pt-3">
            <FormField
              label="What needs correcting?"
              id={`service-report-${entry.id}`}
              hint="Describe the service information that needs review. Do not include patient details."
            >
              {(field) => (
                <textarea
                  id={field.id}
                  aria-describedby={field.describedBy}
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className={cn(fieldControlPlain, "h-auto min-h-20 resize-y py-2")}
                />
              )}
            </FormField>
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                busy={busy}
                busyLabel="Sending…"
                disabled={!reason.trim()}
                onClick={() => void submitReport()}
              >
                Send correction
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setReportOpen(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function BlankTemplate({ title, text }: { readonly title: string; readonly text: string }) {
  const [status, setStatus] = useState<string | null>(null);

  async function copy() {
    try {
      await copyTextToClipboard(text);
      setStatus(`${title} copied.`);
    } catch {
      setStatus("Could not copy this structure.");
    }
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold text-[color:var(--text)]">{title}</p>
      <p className={cn(textMuted, "text-xs leading-5")}>{text}</p>
      <Button variant="secondary" size="sm" icon={Clipboard} onClick={() => void copy()}>
        Copy blank structure
      </Button>
      {status ? (
        <span role="status" className={cn(textMuted, "text-xs")}>
          {status}
        </span>
      ) : null}
    </div>
  );
}

export function ServiceHandbook({
  detail,
  selectedSiteId,
  canEdit,
  onEdit,
  onAdd,
  onAction,
}: {
  readonly detail: ServiceDetail;
  readonly selectedSiteId: string | null;
  readonly canEdit: boolean;
  readonly onEdit: (entry: ServiceEntry) => void;
  readonly onAdd: () => void;
  readonly onAction: (action: ServiceAction) => Promise<Record<string, unknown>>;
}) {
  const [query, setQuery] = useState("");
  const sites = new Map(detail.sites.map((site) => [site.id, site.name]));
  const siteEntries = detail.entries.filter(
    (entry) =>
      handbookGroups.includes(entry.content.section as (typeof handbookGroups)[number]) &&
      (entry.content.siteId === null || entry.content.siteId === selectedSiteId),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("en-AU");
  const entries = normalizedQuery
    ? siteEntries.filter((entry) =>
        [
          entry.content.title,
          entry.content.body,
          entry.content.phone,
          ...entry.content.sources.flatMap((source) => [source.label, source.url]),
        ].some((value) => value.toLocaleLowerCase("en-AU").includes(normalizedQuery)),
      )
    : siteEntries;

  function focusFirstEntry() {
    const exact = entries.find((entry) => entry.content.title.trim().toLocaleLowerCase("en-AU") === normalizedQuery);
    const target = exact ?? entries[0];
    if (!target) return;
    window.requestAnimationFrame(() => {
      document.getElementById(onCallEntryAnchorId(target.id))?.focus();
    });
  }

  return (
    <section aria-labelledby="service-handbook-heading" className="grid gap-5" data-testid="service-handbook">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="service-handbook-heading" className="text-lg font-semibold text-[color:var(--text-heading)]">
            Service handbook
          </h2>
          <p className={cn(textMuted, "mt-1 text-sm leading-6")}>
            Service-maintained local information sits above a small catalogue of official WA starting points.
          </p>
        </div>
        {canEdit ? (
          <Button variant="primary" onClick={onAdd}>
            Add handbook entry
          </Button>
        ) : null}
      </div>

      {canEdit && selectedSiteId
        ? detail.sites
            .filter((site) => site.id === selectedSiteId)
            .map((site) => <ServiceSiteHours key={site.id} site={site} onAction={onAction} />)
        : null}
      <form
        role="search"
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          focusFirstEntry();
        }}
      >
        <FormField label="Search service handbook" id="service-handbook-search">
          {(field) => (
            <input
              id={field.id}
              aria-describedby={field.describedBy}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={fieldControlPlain}
              placeholder="Contact, referral, topic or source"
            />
          )}
        </FormField>
        <Button type="submit" variant="secondary" icon={Search} className="self-end" disabled={entries.length === 0}>
          Open first result
        </Button>
      </form>

      {handbookGroups.map((group) => {
        const groupEntries = entries.filter((entry) => entry.content.section === group);
        return (
          <section key={group} aria-labelledby={`service-${group}-heading`} className="grid gap-2">
            <h3 id={`service-${group}-heading`} className="text-sm font-semibold text-[color:var(--text-heading)]">
              {groupLabels[group]}
            </h3>
            {groupEntries.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {groupEntries.map((entry) => (
                  <ServiceEntryCard
                    key={entry.id}
                    entry={entry}
                    siteName={
                      entry.content.siteId ? (sites.get(entry.content.siteId) ?? "Selected site") : "Service-wide"
                    }
                    canEdit={canEdit}
                    onEdit={() => onEdit(entry)}
                    onConfirm={
                      entry.status !== "withdrawn" &&
                      entry.publishedContent &&
                      entry.publishedRevision === entry.revision &&
                      (entry.publishedContent.kind === "operational" ? canEdit : detail.membership.clinicalReviewer)
                        ? () =>
                            onAction({
                              action: "entry.confirm",
                              entryId: entry.id,
                              publishedRevision: entry.publishedRevision!,
                            })
                        : undefined
                    }
                    onReport={async (action) => {
                      await onAction(action);
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className={cn(textMuted, "text-sm")}>
                No local {groupLabels[group].toLowerCase()} have been published here yet.
              </p>
            )}
          </section>
        );
      })}

      <section aria-labelledby="blank-note-structures-heading" className={cn(cardSurface, "grid gap-3 p-4")}>
        <div>
          <h3 id="blank-note-structures-heading" className="text-sm font-semibold text-[color:var(--text-heading)]">
            Blank documentation structures
          </h3>
          <p className={cn(textMuted, "mt-1 text-xs leading-5")}>
            Reference headings only. Do not type or store patient details on this page.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <BlankTemplate
            title="Telephone advice structure"
            text={
              "Date and time\nCaller and service\nReason for call\nInformation provided\nAdvice given\nAgreed actions\nEscalation\nFollow-up responsibility"
            }
          />
          <BlankTemplate
            title="Assessment structure"
            text={
              "Reason for assessment\nSources of information\nHistory\nMental state examination\nPhysical health\nRisk assessment\nImpression\nPlan\nReview and follow-up"
            }
          />
          <BlankTemplate
            title="Transfer structure"
            text={
              "Reason for transfer\nReferring and receiving teams\nClinical summary\nOutstanding tasks\nDocuments and communication\nTransfer arrangements\nHandover confirmation"
            }
          />
          <BlankTemplate
            title="Handover structure"
            text={
              "Situation\nBackground\nAssessment\nRecommendation\nOutstanding tasks\nResponsible clinician\nReview timeframe"
            }
          />
        </div>
      </section>

      <HandbookResourceCatalogue query={query} />
    </section>
  );
}

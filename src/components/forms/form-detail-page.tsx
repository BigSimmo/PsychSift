"use client";

import {
  Bookmark,
  BookmarkCheck,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clipboard,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  Info,
  Navigation,
  Phone,
  Route,
  Scale,
  ShieldCheck,
  Tag,
  X,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import {
  cn,
  codeText,
  floatingControl,
  ignoreUnavailableActivation,
  metadataPill,
  metadataPillDensity,
  textMuted,
  toneDanger,
  toneInfo,
  toneNeutral,
  toneSuccess,
  toneWarning,
} from "@/components/ui-primitives";
import { InformationPageShell } from "@/components/information-page-shell";
import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import { inPageActionRowClass, inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";
import { FormCodeBadge, splitFormCode } from "@/components/forms/form-code-badge";
import { PriorityFactsSection } from "@/components/forms/form-priority-facts-section";
import { MhaTimelinePanel } from "@/components/forms/mha-timeline-panel";
import { DisclosureGroup, disclosureBodyText } from "@/components/ui/disclosure";
import { appModeHomeHref } from "@/lib/app-modes";
import { formTitleForCode } from "@/lib/form-register";
import { formCatalogDetails, type FormRecord } from "@/lib/form-ranker";
import { hasMhaTimeline } from "@/lib/mha-timeline";
import type { ServiceChipTone, ServiceContact, ServiceCriterion, ServiceSummaryCard } from "@/lib/service-ranker";
import { useAccountData } from "@/components/account-data-provider";

const missingText = "Not listed";

function hasText(value: string | null | undefined): value is string {
  return Boolean(value && value.trim().length > 0);
}

function displayText(value: string | null | undefined, fallback = missingText) {
  return hasText(value) ? value.trim() : fallback;
}

/**
 * The catalogue's `sourceNote` as a display fallback, unless the form has already
 * been clinically reviewed and the note is only the pre-review "awaiting clinical
 * review" caveat — that caveat is shown elsewhere while the form is drafted, and
 * once a form is reviewed the note text itself (pinned in data/forms-catalog.json,
 * not edited by this component) would otherwise keep reading "Awaiting clinical
 * review" indefinitely.
 */
export function reviewedSourceNote(
  details: { sourceNote?: string | null; contentReviewStatus?: string } | null | undefined,
): string | undefined {
  const note = details?.sourceNote;
  if (!hasText(note)) return undefined;
  if (details?.contentReviewStatus === "reviewed" && note.includes("Awaiting clinical review")) {
    return undefined;
  }
  return note;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the legacy selection path for restricted browser contexts.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  try {
    const copied = document.execCommand?.("copy");
    if (copied === false) throw new Error("copy command rejected");
  } finally {
    document.body.removeChild(textArea);
  }
}

function chipToneClass(tone: ServiceChipTone | null | undefined) {
  if (tone === "danger") return toneDanger;
  if (tone === "info") return toneInfo;
  if (tone === "warning") return toneWarning;
  if (tone === "success") return toneSuccess;
  return toneNeutral;
}

export function sourceToneClass(form: FormRecord) {
  const status = form.source?.status?.toLowerCase() ?? "";
  if (/required|review|unverified|not verified|unchecked|pending|unknown|confirm/.test(status)) return toneWarning;
  if (form.verification?.locallyVerified === true) return toneSuccess;
  return toneNeutral;
}

function formCode(form: FormRecord) {
  const details = formCatalogDetails(form);
  if (details?.form) return details.form;
  if (form.slug.includes("transport")) return "4A";
  if (form.slug.includes("capacity")) return "CAP";
  if (form.slug.includes("clozapine")) return "CLZ";
  if (form.slug.includes("handover")) return "SAFE";
  return form.title
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function formShortTitle(form: FormRecord) {
  const details = formCatalogDetails(form);
  return details?.form ? `Form ${details.form}` : displayText(form.catalogueLabel, "Form");
}

function summaryCardsFor(form: FormRecord): ServiceSummaryCard[] {
  if (form.summaryCards?.length) return form.summaryCards.slice(0, 4);

  return [
    { id: "route", label: "Route", title: "Use pathway", detail: form.route },
    { id: "eligibility", label: "Eligibility", title: "Patient fit", detail: form.eligibility },
    { id: "authority", label: "Authority", title: "Referral / maker", detail: form.referral },
    { id: "source", label: "Source", title: form.source?.status, detail: form.source?.label },
  ];
}

function joinNotes(notes: string[] | null | undefined) {
  if (!notes?.length) return undefined;
  return notes
    .map((note) => note.trim())
    .filter(Boolean)
    .map((note) => (/[.!?]$/.test(note) ? note : `${note}.`))
    .join(" ");
}

function detailRowsFor(form: FormRecord) {
  const referralRows = form.referralInfo?.length
    ? form.referralInfo
    : [
        { label: "Use only when", value: form.eligibility },
        { label: "Before signing", value: form.referral },
        { label: "Clinical pearls", value: form.bestUse },
        { label: "Source details", value: form.source?.label },
      ];

  return [
    ...referralRows,
    { label: "Verification", value: joinNotes(form.verification?.notes) },
    { label: "Related pathway", value: form.route },
  ].filter((row) => hasText(row.value));
}

export function formDetailsClipboardText(form: FormRecord) {
  const lines = [form.title, `Form code: ${formCode(form)}`];

  if (hasText(form.subtitle)) lines.push(displayText(form.subtitle));
  const statuses = (form.statusChips ?? []).map((chip) => chip.label?.trim()).filter(hasText);
  if (statuses.length) lines.push(`Status: ${statuses.join(", ")}`);

  for (const card of summaryCardsFor(form)) {
    const label = displayText(card.label, "Priority fact");
    const values = [card.title, card.detail].filter(hasText).map((value) => value.trim());
    if (values.length) lines.push(`${label}: ${values.join(" — ")}`);
  }

  if (hasText(form.bestUse)) lines.push(`Legal boundary: ${displayText(form.bestUse)}`);
  for (const row of detailRowsFor(form)) lines.push(`${row.label}: ${displayText(row.value)}`);

  const primaryContact = hasText(form.primaryContact?.value)
    ? form.primaryContact
    : form.contacts?.find((contact) => hasText(contact.value));
  if (primaryContact) {
    lines.push(`${displayText(primaryContact.label, "Contact")}: ${displayText(primaryContact.value)}`);
  }

  if (hasText(form.source?.label)) lines.push(`Source: ${displayText(form.source.label)}`);
  if (hasText(form.source?.status)) lines.push(`Source status: ${displayText(form.source.status)}`);
  if (hasText(form.source?.reviewed)) lines.push(`Source reviewed: ${displayText(form.source.reviewed)}`);
  if (hasText(form.source?.url)) lines.push(`Source URL: ${displayText(form.source.url)}`);

  return lines.join("\n");
}

function callHref(contact: ServiceContact | null) {
  if (!contact || contact.kind !== "phone" || !hasText(contact.value)) return null;
  return `tel:${contact.value.replace(/[^\d+]/g, "")}`;
}

function criterionToneClass(tone: ServiceCriterion["tone"]) {
  if (tone === "meet") return toneSuccess;
  if (tone === "reject") return toneDanger;
  return toneWarning;
}

/** Soft cue + body for Confirm callouts — medium prefix only, never full-row bold. */
function ConfirmCalloutText({ cue, body }: { cue?: string; body: string }) {
  if (!cue) return <>{body}</>;
  return (
    <span>
      <span className="font-medium">{cue}</span>
      {body ? <> {body}</> : null}
    </span>
  );
}

function confirmCheckParts(check: string): { cue?: string; body: string } {
  const normalized = check.replace(/^Before use:\s*/i, "Before use: ");
  const match = normalized.match(/^(Before use:)\s*(.*)$/i);
  if (!match) return { body: normalized };
  return { cue: "Before use:", body: match[2] ?? "" };
}

// Compact code cell for the pathway before/parallel/after lists. Visually it
// shows only the short head ("6B") so a qualifier like "6B attachment" can't
// overflow the fixed-width column, but the full code is exposed to assistive
// tech via an sr-only label (the decorative head is aria-hidden) and to sighted
// users via a tooltip — matching FormCodeBadge's pattern.
type PathwayStepItem = { code: string; title: string; meta: string; isEmpty: boolean };

// One list for the Before, Parallel and After steps. An empty step shows its
// sentence only: rendering the short label and the sentence together read as
// "No parallel formNo parallel form is listed for this step" (audit VUX-38).
function PathwayStepList({ items, className }: { items: readonly PathwayStepItem[]; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]",
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={`${item.code}-${item.title}`}
          className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 border-b border-[color:var(--border)] p-2.5 last:border-b-0"
        >
          <PathwayStepCode code={item.code} />
          {item.isEmpty ? (
            <p className={cn("text-xs font-medium leading-5", textMuted)}>{item.title}</p>
          ) : (
            <p className="text-xs font-medium leading-5 text-[color:var(--text-heading)]">
              <span className="font-semibold">{item.meta}</span>
              {" — "}
              <span className={textMuted}>{item.title}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function PathwayStepCode({ code }: { code: string }) {
  const { head, qualifier } = splitFormCode(code);
  const fullCode = qualifier ? `${head} ${qualifier}` : head;
  return (
    <span
      className={cn("truncate text-sm font-bold text-[color:var(--text-heading)]", codeText)}
      title={qualifier ? fullCode : undefined}
    >
      <span className="sr-only">{fullCode}</span>
      <span aria-hidden>{head}</span>
    </span>
  );
}

function PathwayContextCard({
  form,
  code,
  criteria,
  testId,
}: {
  form: FormRecord;
  code: string;
  criteria: ServiceCriterion[];
  testId?: string;
}) {
  const details = formCatalogDetails(form);
  const [activeTab, setActiveTab] = useState<"pathway" | "source">("pathway");
  const tabPathwayId = useId();
  const tabSourceId = useId();
  const panelPathwayId = `${tabPathwayId}-panel`;
  const panelSourceId = `${tabSourceId}-panel`;
  const pathwayItems = (items: string[] | undefined, emptyTitle: string, emptyMeta: string) =>
    items?.length
      ? items.map((item) => {
          const knownTitle = formTitleForCode(item);
          return {
            code: knownTitle ? item : "Context",
            title: knownTitle ?? item,
            meta: knownTitle ? `Form ${item}` : "Pathway step",
            isEmpty: false,
          };
        })
      : [{ code: "None", title: emptyTitle, meta: emptyMeta, isEmpty: true }];
  const beforeForms = pathwayItems(details?.before, "No form is listed before this step", "No prior form");
  const parallelForms = pathwayItems(details?.parallel, "No parallel form is listed for this step", "No parallel form");
  const afterForms = pathwayItems(
    details?.after,
    "No next form is listed; confirm the lawful off-ramp or local workflow",
    "No next form",
  );
  const confirmChecks = [
    ...(details?.preUseChecks ?? []),
    ...(details?.copies ? [details.copies] : []),
    ...(details?.safetyPearl ? [details.safetyPearl] : []),
  ].filter((value, index, values) => value.trim().length > 0 && values.indexOf(value) === index);

  return (
    <section
      data-testid={testId}
      className="rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--shadow-inset)]"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
            <Navigation className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="text-sm font-semibold text-[color:var(--text-heading)]">Decision context</h2>
        </div>
        <Info className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)]" aria-hidden />
      </div>
      <div
        className="grid grid-cols-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-1 text-xs font-semibold"
        role="tablist"
        aria-label="Decision context sections"
      >
        <button
          type="button"
          id={tabPathwayId}
          role="tab"
          aria-selected={activeTab === "pathway"}
          aria-controls={panelPathwayId}
          onClick={() => setActiveTab("pathway")}
          className={cn(
            "min-h-tap rounded-md px-3 py-2 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-compact-meta",
            activeTab === "pathway"
              ? "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
              : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
          )}
        >
          Pathway
        </button>
        <button
          type="button"
          id={tabSourceId}
          role="tab"
          aria-selected={activeTab === "source"}
          aria-controls={panelSourceId}
          onClick={() => setActiveTab("source")}
          className={cn(
            "min-h-tap rounded-md px-3 py-2 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-compact-meta",
            activeTab === "source"
              ? "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
              : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
          )}
        >
          Source info
        </button>
      </div>
      {activeTab === "pathway" ? (
        <div
          id={panelPathwayId}
          role="tabpanel"
          aria-labelledby={tabPathwayId}
          tabIndex={0}
          className="mt-3 space-y-3 border-l border-[color:var(--border-strong)] pl-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          <div className="relative">
            <span className="absolute -left-[1.35rem] top-1.5 h-3 w-3 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface)]" />
            <p className="text-2xs font-bold uppercase text-[color:var(--text-muted)]">Before</p>
            <PathwayStepList className="mt-2" items={beforeForms} />
          </div>
          <div className="relative rounded-lg border border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)]/35 p-3">
            <span className="absolute -left-[1.55rem] top-4 h-4 w-4 rounded-full border-2 border-[color:var(--surface)] bg-[color:var(--clinical-accent)]" />
            <p className="mb-2 text-2xs font-bold uppercase text-[color:var(--text-muted)]">Current</p>
            <div className="flex items-center gap-2.5">
              <FormCodeBadge code={code} variant="sm" />
              <p className="min-w-0 text-sm font-semibold text-[color:var(--text-heading)]">{form.title}</p>
            </div>
            <span className="mt-2 inline-flex min-h-6 items-center rounded-full bg-[color:var(--clinical-accent-soft)] px-2 text-2xs font-bold text-[color:var(--clinical-accent)]">
              You are here
            </span>
            <p className={cn("mt-2 text-xs leading-5", textMuted)}>{displayText(form.subtitle)}</p>
          </div>
          <div className="relative">
            <span className="absolute -left-[1.35rem] top-1.5 h-3 w-3 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface)]" />
            <p className="text-2xs font-bold uppercase text-[color:var(--text-muted)]">Parallel</p>
            <PathwayStepList className="mt-2" items={parallelForms} />
          </div>
          <div className="relative">
            <span className="absolute -left-[1.35rem] top-1.5 h-3 w-3 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface)]" />
            <p className="text-2xs font-bold uppercase text-[color:var(--text-muted)]">After</p>
            <PathwayStepList className="mt-2" items={afterForms} />
          </div>
          <div className="relative">
            <span className="absolute -left-[1.35rem] top-1.5 h-3 w-3 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface)]" />
            <p className="text-2xs font-bold uppercase text-[color:var(--text-muted)]">Confirm</p>
            <div className="mt-2 grid gap-2.5">
              {confirmChecks.slice(0, 4).map((check) => {
                const { cue, body } = confirmCheckParts(check);
                return (
                  <span
                    key={check}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs font-normal leading-5",
                      toneWarning,
                    )}
                  >
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <ConfirmCalloutText cue={cue} body={body} />
                  </span>
                );
              })}
              {criteria
                .filter((criterion) => criterion.tone === "reject")
                .slice(0, 1)
                .map((criterion) => (
                  <span
                    key={criterion.label}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs font-normal leading-5",
                      criterionToneClass(criterion.tone),
                    )}
                  >
                    <CircleX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <ConfirmCalloutText cue="Avoid:" body={criterion.label} />
                  </span>
                ))}
            </div>
          </div>
        </div>
      ) : (
        <div
          id={panelSourceId}
          role="tabpanel"
          aria-labelledby={tabSourceId}
          tabIndex={0}
          className="mt-3 space-y-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          <p className="text-sm font-semibold text-[color:var(--text-heading)]">
            {displayText(details?.sourceFacts?.documentTitle, form.title)}
          </p>
          <dl className="grid gap-2 text-xs">
            <div>
              <dt className="font-bold uppercase text-[color:var(--text-muted)]">Official source</dt>
              <dd className={textMuted}>{displayText(form.source?.label)}</dd>
            </div>
            <div>
              <dt className="font-bold uppercase text-[color:var(--text-muted)]">Source checked</dt>
              <dd className={textMuted}>{displayText(form.source?.reviewed ?? details?.officialTitleCheckedAt)}</dd>
            </div>
            <div>
              <dt className="font-bold uppercase text-[color:var(--text-muted)]">Availability</dt>
              <dd className={textMuted}>
                {details?.availability === "downloadable"
                  ? "Official PDF stored locally; confirm against the register before use"
                  : details?.availability === "unavailable"
                    ? "Marked unavailable on the official register"
                    : "Contact OCP monitoring"}
              </dd>
            </div>
            <div>
              <dt className="font-bold uppercase text-[color:var(--text-muted)]">Act / cue</dt>
              <dd className={textMuted}>
                {displayText(details?.sourceFacts?.sectionCue, reviewedSourceNote(details))}
              </dd>
            </div>
          </dl>
        </div>
      )}
      <a
        href={form.source?.url ?? details?.officialRegisterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(floatingControl, "mt-3 w-full rounded-lg px-3 text-xs")}
      >
        <Navigation className="h-4 w-4" aria-hidden />
        Open official source / pathway
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    </section>
  );
}

function SourceSnapshotCard({ form }: { form: FormRecord }) {
  const details = formCatalogDetails(form);
  const rows = [
    {
      icon: FileText,
      label: "Official form",
      value:
        details?.availability === "downloadable"
          ? `${formShortTitle(form)} · stored official copy`
          : details?.availability === "unavailable"
            ? "Currently unavailable"
            : "Contact OCP monitoring",
    },
    { icon: ShieldCheck, label: "Source currency", value: displayText(form.source?.reviewed, "Review locally") },
    {
      icon: Scale,
      label: "Act sections",
      value: displayText(details?.sourceFacts?.sectionCue, "See current approved form"),
    },
    {
      icon: CalendarDays,
      label: "Use safeguard",
      value: "Check current source before every use",
    },
    ...(details?.officialPdfEditingRestricted !== undefined
      ? [
          {
            icon: ShieldCheck,
            label: "PDF permissions",
            value: details.officialPdfEditingRestricted
              ? "Editing restricted (printing and form-filling permitted)"
              : "Editing permitted",
          },
        ]
      : []),
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] shadow-[var(--shadow-inset)]">
      {rows.map(({ icon: Icon, label, value }) => (
        <div
          key={label}
          className="grid min-h-12 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-[color:var(--border)] px-3 py-2 last:border-b-0"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <p className="text-xs font-semibold text-[color:var(--text-heading)]">{label}</p>
          <p className="max-w-[12rem] text-right text-xs font-medium leading-5 text-[color:var(--text-muted)]">
            {value}
          </p>
        </div>
      ))}
    </section>
  );
}

/**
 * Ids, labels and both breakpoint-pair aliases carried over verbatim from
 * `formSections` in the pill rail this page's header replaces. Exported so the
 * per-route section contract test can assert them against the rendered DOM.
 */
export const formNavSections: readonly PageSection[] = [
  { id: "form-overview", label: "Overview", icon: Info },
  {
    id: "form-decision-context",
    label: "Decision context",
    icon: Navigation,
    targetIds: ["form-decision-context-mobile", "form-decision-context-desktop"],
    fragmentId: "form-decision-context",
  },
  { id: "form-priority-facts", label: "Priority facts", icon: ClipboardList },
  // Rendered only for forms with a quoted Mental Health Act time limit; `useResolvedPageSections`
  // drops the entry everywhere else.
  { id: "form-timeline", label: "Timeline", icon: CalendarClock },
  { id: "form-legal-boundary", label: "Legal boundary", icon: Scale },
  { id: "form-information", label: "Form information", icon: FileText },
  {
    id: "form-source-verification",
    label: "Source / verification",
    icon: ShieldCheck,
    targetIds: ["form-source-verification-mobile", "form-source-verification-desktop"],
    fragmentId: "form-source-verification",
  },
];

function RailCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--shadow-inset)]">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <h2 className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function formInformationIcon(label: string): LucideIcon {
  const normalized = label.toLowerCase();
  if (normalized.includes("only")) return Route;
  if (normalized.includes("sign")) return Clipboard;
  if (normalized.includes("clinical")) return Info;
  if (normalized.includes("source")) return FileText;
  if (normalized.includes("pathway")) return Navigation;
  return CircleCheck;
}

function formInformationItems(rows: Array<{ label: string; value?: string | null }>) {
  return rows.map((row, index) => {
    const Icon = formInformationIcon(row.label);
    const value = displayText(row.value);
    return {
      id: `form-info-${index}-${row.label}`,
      // The glyph alone: Disclosure draws the tile and owns its grid track, so the
      // tile can no longer drift from the column the panel aligns to. It also used
      // to sit inside the title's `truncate` box, where a long label clipped it.
      icon: <Icon className="size-icon-sm" aria-hidden />,
      title: row.label,
      description: value,
      // The collapsed line is a preview of this same value. Opening the row
      // replaces that preview with the fully wrapped answer instead of echoing
      // it in a visually separate, bordered panel.
      extendDescription: true,
      // Type comes from the shared constant, which the collapsed preview also
      // uses. Restating "text-sm leading-6" here is how the two drifted, so the
      // same sentence changed size the moment a reader opened the row.
      content: <p className={cn(disclosureBodyText, "m-0", textMuted)}>{value}</p>,
    };
  });
}

export function FormDetailPage({ form }: { form: FormRecord }) {
  const accountData = useAccountData();
  const saved = accountData.isSaved("form", form.slug);
  const [notice, setNotice] = useState<string | null>(null);
  const code = formCode(form);
  const details = formCatalogDetails(form);
  const summaryCards = summaryCardsFor(form);
  const detailRows = detailRowsFor(form);
  const primaryContact = hasText(form.primaryContact?.value)
    ? form.primaryContact
    : (form.contacts?.find((contact) => hasText(contact.value)) ?? null);
  const hrefForCall = callHref(primaryContact);
  const verified = form.verification?.locallyVerified === true;
  const criteria = form.criteria ?? [];
  const relatedTags = useMemo(() => [...(form.tags ?? []), ...(form.catchments ?? [])].slice(0, 8), [form]);
  const { sections, activeId, selectSection } = useInPageSectionNav(formNavSections);
  const sourceHref = form.source?.url ?? null;

  async function copyValue(value: string | null | undefined, label: string) {
    if (!hasText(value)) {
      setNotice("Nothing available to copy");
      return;
    }

    try {
      await copyText(value.trim());
      setNotice(label);
    } catch {
      setNotice("Copy failed");
    }
  }

  async function toggleSaved() {
    try {
      const nowSaved = !saved;
      if (!(await accountData.setFavourite("form", form.slug, nowSaved))) {
        setNotice(
          accountData.isAuthenticated ? "Save failed. Try again." : "Sign in or create an account to save forms",
        );
        return;
      }
      setNotice(nowSaved ? "Form saved" : "Form removed from saved items");
    } catch {
      setNotice("Save failed");
    }
  }

  return (
    <>
      <InPageNavHeader
        back={{ href: appModeHomeHref("forms", { focus: true }), label: "Forms" }}
        title={form.title}
        sections={sections}
        activeId={activeId}
        onSelectSection={selectSection}
        actionsNoun="form"
        actionsDescription="Choose how to use this form."
        testIdPrefix="form"
        actions={(close) => (
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => {
                close();
                void toggleSaved();
              }}
              aria-pressed={saved}
              className={inPageActionRowClass}
            >
              {saved ? (
                <BookmarkCheck className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              ) : (
                <Bookmark className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              )}
              {saved ? "Remove saved form" : "Save form"}
            </button>
            {sourceHref ? (
              <a
                href={sourceHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                className={inPageActionRowClass}
              >
                <ExternalLink className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                Open official source
              </a>
            ) : (
              <button
                type="button"
                aria-disabled="true"
                onClick={ignoreUnavailableActivation}
                title="Open official source — no official source URL is recorded for this form"
                aria-describedby="form-source-unavailable"
                className={inPageActionRowClass}
              >
                <ExternalLink className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" aria-hidden />
                Open official source
                <span id="form-source-unavailable" className="sr-only">
                  No official source URL is recorded for this form.
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                close();
                void copyValue(formDetailsClipboardText(form), "Form details copied");
              }}
              className={inPageActionRowClass}
            >
              <Download className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Copy details
            </button>
            {hrefForCall ? (
              <a href={hrefForCall} onClick={close} className={inPageActionRowClass}>
                <Phone className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                Call contact
              </a>
            ) : null}
          </div>
        )}
      />
      <InformationPageShell testId="form-detail-page" gap={false}>
        {notice ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "mb-3 flex min-h-tap items-center justify-between gap-3 rounded-lg border p-3 text-sm font-semibold shadow-[var(--shadow-inset)]",
              notice.includes("failed") || notice.includes("Nothing") ? toneWarning : toneSuccess,
            )}
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss form notification"
              className="grid size-tap place-items-center rounded-md transition hover:bg-[color:var(--surface)]/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}

        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 space-y-4">
            <section
              id="form-overview"
              className={cn(
                inPageAnchor,
                "rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--shadow-inset)] sm:p-5",
              )}
            >
              <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-3 xl:grid-cols-[auto_minmax(0,1fr)] xl:items-start">
                <FormCodeBadge code={code} variant="hero" />
                <div className="min-w-0">
                  <h1 className="max-w-4xl text-2xl font-extrabold leading-display text-[color:var(--text-heading)] sm:text-4xl">
                    {form.title}
                  </h1>
                  <p className="mt-1.5 max-w-4xl text-xs font-medium leading-4 text-[color:var(--text-muted)] sm:mt-3 sm:text-base sm:leading-6">
                    {displayText(form.subtitle, "Psychiatry form and workflow details.")}
                  </p>
                  {form.statusChips?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-3">
                      {form.statusChips.map((chip, index) => (
                        <span
                          key={chip.label ?? `form-chip-${index}`}
                          className={cn(
                            "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 text-2xs font-bold uppercase leading-none sm:min-h-7 sm:px-2.5 sm:text-xs",
                            chipToneClass(chip.tone),
                          )}
                        >
                          <span className="hidden h-2 w-2 rounded-full bg-current sm:inline-block" aria-hidden />
                          {displayText(chip.label, "Status")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {/* On a phone the attachment row stacks: the status badges take their own
                line under the title instead of squeezing the title column down to a
                few characters ("Ext...", #47Y8XH). The badges decide whether the
                form can be filled now or must be printed, so neither may truncate. */}
            <section
              data-testid="form-attachment-row"
              className="grid grid-cols-1 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] p-2.5 shadow-[var(--shadow-inset)] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:gap-3 sm:p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color:var(--danger-soft)] text-[color:var(--danger)] sm:h-10 sm:w-10">
                  <FileText className="size-icon-md sm:size-icon-lg" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-[color:var(--clinical-accent-soft)] px-1.5 text-3xs font-bold uppercase leading-none tracking-label text-[color:var(--clinical-accent)]">
                      {`Form ${formCode(form)}`}
                    </span>
                    {details?.availability === "downloadable" ? (
                      <span className="text-2xs font-semibold uppercase leading-none text-[color:var(--text-muted)]">
                        PDF
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-1 break-words text-sm font-semibold text-[color:var(--text-heading)] sm:truncate">
                    {displayText(form.title, `Form ${formCode(form)}`)}
                  </h2>
                  <p className={cn("mt-0.5 break-words text-xs sm:truncate", textMuted)}>
                    {displayText(form.source?.label, "Official form")}
                  </p>
                  {details?.officialPdfEditingRestricted !== undefined ? (
                    <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
                      {details.officialPdfEditingRestricted
                        ? "Editing restricted (printing and form-filling permitted)"
                        : "Editing permitted"}
                    </p>
                  ) : null}
                </div>
              </div>
              <span className="hidden text-xs font-semibold text-[color:var(--text-muted)] sm:block">
                {displayText(form.source?.status, "Source status pending")}
              </span>
              <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
                <span
                  className={cn(
                    "inline-flex min-h-7 items-center rounded-full border px-2 text-xs font-semibold shadow-[var(--shadow-inset)]",
                    details?.officialPdfPasswordProtected ? toneWarning : toneNeutral,
                  )}
                >
                  {details?.officialPdfPasswordProtected ? "Password required" : "Check source"}
                </span>
                {details?.officialPdfEditingRestricted !== undefined ? (
                  <span
                    className={cn(
                      "inline-flex min-h-7 items-center rounded-full border px-2 text-xs font-semibold shadow-[var(--shadow-inset)]",
                      details.officialPdfEditingRestricted ? toneWarning : toneNeutral,
                    )}
                  >
                    {details.officialPdfEditingRestricted ? "Editing restricted" : "Editing permitted"}
                  </span>
                ) : null}
              </div>
              <div data-testid="form-attachment-phone-badges" className="flex flex-wrap items-center gap-1.5 sm:hidden">
                <span
                  className={cn(
                    "inline-flex min-h-6 items-center rounded-full border px-2 text-2xs font-semibold shadow-[var(--shadow-inset)]",
                    details?.officialPdfPasswordProtected ? toneWarning : toneNeutral,
                  )}
                >
                  {details?.officialPdfPasswordProtected ? "Password required" : "Check source"}
                </span>
                {details?.officialPdfEditingRestricted !== undefined ? (
                  <span
                    className={cn(
                      "inline-flex min-h-6 items-center rounded-full border px-2 text-2xs font-semibold shadow-[var(--shadow-inset)]",
                      details.officialPdfEditingRestricted ? toneWarning : toneNeutral,
                    )}
                  >
                    {details.officialPdfEditingRestricted ? "Editing restricted" : "Editing permitted"}
                  </span>
                ) : null}
                <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-[color:var(--text-muted)]" aria-hidden />
              </div>
              {form.source?.url || details?.localPdfPath ? (
                <div className="hidden items-center gap-3 sm:flex">
                  {form.source?.url ? (
                    <a
                      href={form.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg text-sm font-semibold text-[color:var(--clinical-accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10"
                    >
                      Official
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                  ) : null}
                  {details?.localPdfPath ? (
                    <a
                      href={details.localPdfPath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg text-sm font-semibold text-[color:var(--text-muted)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10"
                    >
                      Stored copy
                      <Download className="h-4 w-4" aria-hidden />
                    </a>
                  ) : null}
                </div>
              ) : (
                <span className="hidden text-xs font-semibold text-[color:var(--text-muted)] sm:inline">
                  Source link pending
                </span>
              )}
            </section>

            <PriorityFactsSection form={form} cards={summaryCards} />

            {details?.form && hasMhaTimeline(details.form) ? <MhaTimelinePanel formCode={details.form} /> : null}

            <section
              id="form-legal-boundary"
              className={cn(
                inPageAnchor,
                "rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]/30 p-4 shadow-[var(--shadow-inset)]",
              )}
            >
              <div className="grid gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-[color:var(--warning-soft)] text-[color:var(--warning)] shadow-[var(--shadow-inset)]">
                  <ShieldCheck className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-[color:var(--text-heading)]">Legal boundary</h2>
                    <span className={cn(metadataPillDensity.dense, "rounded-full uppercase", toneWarning)}>
                      Governance
                    </span>
                  </div>
                  <p className="mt-2 max-w-5xl text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                    {displayText(
                      form.bestUse,
                      "Use the current approved form, confirm authority, and document the least restrictive safe option before signing.",
                    )}
                  </p>
                </div>
              </div>
            </section>

            <section id="form-information" aria-label="Form information" className={inPageAnchor}>
              {/* One bordered container with divided rows, not thirteen separate
                  cards: no row here is separable or independently actionable, so
                  the repeated borders were 26 rules drawn around what is really
                  one label/value table. */}
              <DisclosureGroup
                className="min-w-0"
                variant="list"
                items={formInformationItems(detailRows)}
                headingLevel={3}
              />
            </section>

            {/* The `-mobile`/`-desktop` id pairs below are the section anchors
              `formSections` declares. Only one of each pair is ever visible:
              `AvailableInformationPageNavigation` resolves a section to its
              first VISIBLE target, and `lg:hidden` / `hidden lg:block` make
              exactly one side `display:none` per breakpoint. */}
            <div id="form-source-verification-mobile" className={cn(inPageAnchor, "grid gap-3 lg:hidden")}>
              <SourceSnapshotCard form={form} />
            </div>

            <div id="form-decision-context-mobile" className={cn(inPageAnchor, "lg:hidden")}>
              <PathwayContextCard form={form} code={code} criteria={criteria} testId="form-decision-context-mobile" />
            </div>
          </div>

          <aside className="polished-scroll hidden min-w-0 space-y-3 lg:sticky lg:top-[5.75rem] lg:block lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
            <div id="form-decision-context-desktop" className={inPageAnchor}>
              <PathwayContextCard form={form} code={code} criteria={criteria} testId="form-decision-context-desktop" />
            </div>
            {/* Anchors the source band. The two RailCards below ("Source status",
              "Verification") are its siblings in this scrollable rail, so
              landing here brings them into view without a wrapper spanning
              all three. */}
            <div id="form-source-verification-desktop" className={inPageAnchor}>
              <SourceSnapshotCard form={form} />
            </div>

            <RailCard icon={FileText} title="Source status">
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[color:var(--text-heading)]">
                    {displayText(form.source?.label, "Source")}
                  </p>
                  <span
                    className={cn(
                      "inline-flex min-h-6 shrink-0 items-center rounded-md border px-2 text-2xs font-bold",
                      sourceToneClass(form),
                    )}
                  >
                    {displayText(form.source?.status, "Unreviewed")}
                  </span>
                </div>
                {form.source?.reviewed ? (
                  <p className={cn("mt-2 text-xs leading-5", textMuted)}>{form.source.reviewed}</p>
                ) : null}
                {form.source?.notes?.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {form.source.notes.map((note) => (
                      <li
                        key={note}
                        className="flex gap-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]"
                      >
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </RailCard>

            <RailCard icon={ShieldCheck} title="Verification">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <span className={cn(metadataPill, "rounded-full", verified ? toneSuccess : toneWarning)}>
                    {verified ? "Locally verified" : "Verify locally"}
                  </span>
                  <span className={cn(metadataPill, "rounded-full")}>
                    {form.verification?.confidence ?? "Unknown"} confidence
                  </span>
                </div>
                {form.verification?.notes?.length ? (
                  <ul className="space-y-1.5">
                    {form.verification.notes.map((note) => (
                      <li
                        key={note}
                        className="flex gap-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]"
                      >
                        <CircleCheck
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--clinical-accent)]"
                          aria-hidden
                        />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={cn("text-sm leading-6", textMuted)}>No verification notes are listed.</p>
                )}
              </div>
            </RailCard>

            <RailCard icon={Tag} title="Tags & context">
              {relatedTags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {relatedTags.map((tag) => (
                    <span key={tag} className={cn(metadataPillDensity.dense, "rounded-full")}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className={cn("text-sm leading-6", textMuted)}>No tags listed.</p>
              )}
            </RailCard>
          </aside>
        </div>
      </InformationPageShell>
    </>
  );
}

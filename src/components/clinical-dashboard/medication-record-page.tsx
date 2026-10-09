"use client";

import {
  Activity,
  Ban,
  TriangleAlert,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileSearch,
  ClipboardList,
  FlaskConical,
  History,
  Lock,
  Pill,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { BadgeCluster } from "@/components/clinical-dashboard/clinical-badge";
import {
  MedicationConsiderations,
  MedicationInteractionCallout,
} from "@/components/clinical-dashboard/medication-considerations";
import {
  MedicationNavHeader,
  medicationNavSections,
  medicationSectionsByTab,
  medicationTabForSectionType,
  type MedicationTabId,
} from "@/components/clinical-dashboard/medication-nav-header";
import { PatientProfilePanel } from "@/components/clinical-dashboard/patient-profile-panel";
import { mayRecordRecentSearches, useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { useMedicationDetail } from "@/components/clinical-dashboard/use-medication-catalog";
import {
  medicationAccessBadges,
  medicationAccessFields,
  medicationIdentityBadges,
  medicationRowBadges,
  type MedicationGovernance,
} from "@/lib/medication-badges";
import {
  isMaxDoseLabel,
  medicationHeroMetrics,
  medicationIndication,
  type MedicationHeroMetric,
  type MedicationQuickRow,
  type MedicationRecord,
  type MedicationSection,
} from "@/lib/medications";
import { cn, EmptyState, LoadingPanel } from "@/components/ui-primitives";
import { InformationPageFooter, InformationPageShell } from "@/components/information-page-shell";
import { RouteNotFoundPanel } from "@/components/route-not-found-panel";
import { focusRing } from "@/components/card-recipes";
import { appModeHomeHref } from "@/lib/app-modes";
import { recordMedicineVisit } from "@/lib/medicines-recent";
import type { MedicationSourceLink } from "@/lib/medication-source-links";
import { MedicationWhereItStands } from "@/components/clinical-dashboard/medication-where-it-stands";
import { Button } from "@/components/ui/button";
import { ExternalTextLink } from "@/components/ui/link";
import { Sheet } from "@/components/ui/sheet";

const sectionIcons: Record<string, LucideIcon> = {
  dose: CalendarDays,
  risk: TriangleAlert,
  contra: Ban,
  safe: ShieldCheck,
  mon: Activity,
  inter: FlaskConical,
  src: BadgeCheck,
};

// Per-section toned icon tiles. Semantic tones stay reserved (red = contra/safety,
// amber = risk/caution, green = safe/verified); other sections use the neutral
// categorical --type-* hues so the list reads with colour without misusing meaning.
const sectionToneClass: Record<string, string> = {
  contra: "border-[color:var(--danger)]/25 bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
  risk: "border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
  safe: "border-[color:var(--success)]/25 bg-[color:var(--success-soft)] text-[color:var(--success)]",
  src: "border-[color:var(--success)]/25 bg-[color:var(--success-soft)] text-[color:var(--success)]",
  mon: "border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-[color:var(--info)]",
  dose: "border-[color:var(--type-document-border)] bg-[color:var(--type-document-soft)] text-[color:var(--type-document)]",
  inter: "border-[color:var(--type-source-border)] bg-[color:var(--type-source-soft)] text-[color:var(--type-source)]",
};
const defaultSectionTone =
  "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";

// Decorative per-medication identity accent (record.accent is keyed to drug
// class). Exposed as CSS custom properties and softened with color-mix so it
// drives rails/borders only — never text — keeping contrast safe in light + dark
// and staying within the colour contract (semantic colour uses the tokens).
// Only `--med-accent` is consumed (the sections panel's rail); the soft wash
// (#157) and the record block's accent border (flat since mock-up v6) went
// once nothing read them.
function medicationAccentStyle(accent: string | undefined): CSSProperties {
  const base = accent?.trim() || "var(--clinical-accent)";
  return {
    "--med-accent": base,
  } as CSSProperties;
}

// The record's key figures as a flat hairline grid (Medicines mock-up v6).
// Owner decision 1 of 5 Oct 2026 was to make the red and amber tiles neutral,
// on the understanding that their colour came from the kind of field. The
// clinical review found otherwise: `cls`/`flag` is a curator's per-medicine
// severity flag ("Nitrates: FATAL" is `hi`; "Urine colour: NEON YELLOW" is
// `warn`), unsourced but medicine-specific. Until the owner re-decides on the
// corrected facts, the build degrades conservatively: a `hi` (danger) figure
// keeps today's red tile and gains a spoken "High risk" cue; amber and green
// become neutral, with a small warning icon and spoken "Caution" on amber.
type FigureFlag = "high" | "caution" | null;

function figureFlag(metric: MedicationHeroMetric): FigureFlag {
  if (metric.tone === "danger") return "high";
  if (metric.tone === "warning") return "caution";
  return null;
}

/** One row of figures on a computer, as many columns as there are figures (at most four). */
const figureColumns: Record<number, string> = {
  0: "",
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
};

function DetailTile({ metric }: { metric: MedicationHeroMetric }) {
  const flag = figureFlag(metric);
  return (
    <div
      data-testid="medication-figure"
      data-flag={flag ?? undefined}
      className={cn(
        "min-w-0 border-r border-b border-[color:var(--border)] px-3 py-3 last:odd:col-span-2 xl:last:odd:col-span-1",
        flag === "high" && "bg-[color:var(--danger-soft)]",
      )}
    >
      <p
        className={cn(
          "flex items-start gap-1.5 text-2xs font-semibold uppercase leading-tight tracking-eyebrow",
          flag === "high" ? "text-[color:var(--danger)]" : "text-[color:var(--text-muted)]",
        )}
      >
        {flag === "high" ? (
          <>
            <ShieldAlert className="mt-px size-icon-xs shrink-0" aria-hidden="true" />
            <span className="sr-only">High risk: </span>
          </>
        ) : flag === "caution" ? (
          <>
            <TriangleAlert className="mt-px size-icon-xs shrink-0" aria-hidden="true" />
            <span className="sr-only">Caution: </span>
          </>
        ) : null}
        <span className="min-w-0 break-words">{metric.label}</span>
      </p>
      <p
        className={cn(
          "mt-1.5 break-words text-sm-minus font-semibold leading-5",
          flag === "high" ? "text-[color:var(--danger-text)]" : "text-[color:var(--text-heading)]",
        )}
      >
        {metric.value}
      </p>
    </div>
  );
}

function SectionCard({ section }: { section: MedicationSection }) {
  const Icon = sectionIcons[section.type] || ClipboardList;
  const toneClass = sectionToneClass[section.type] || defaultSectionTone;

  return (
    <details
      className="group scroll-mt-16 border-b border-[color:var(--border)] last:border-b-0"
      // The category switcher already limits how much content is on screen.
      // Open every card on arrival so switching category reveals its complete
      // reference at once; native details still lets readers fold a card back.
      open
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-left [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg border", toneClass)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate text-sm-minus font-semibold text-[color:var(--text-heading)]">{section.title}</span>
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] transition group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-2 px-3 pb-3">
        {section.rows.map((row) => {
          const rowBadges = medicationRowBadges(row, section.type);
          return (
            <div
              key={`${section.title}-${row.key}`}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-2.5"
            >
              <p className="text-xs font-semibold text-[color:var(--text-heading)]">{row.key}</p>
              <BadgeCluster items={rowBadges} compact limit={section.type === "contra" ? 4 : 3} className="mt-2" />
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[color:var(--text-muted)]">
                {row.val.replace(/\*\*/g, "")}
              </p>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function SidebarCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-inset)]">
      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-3 py-2">
        <Icon className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
        <h4 className="text-sm-minus font-semibold text-[color:var(--text-heading)]">{title}</h4>
      </div>
      {children}
    </section>
  );
}

// Quick-reference values are the verbose ones (≈164 chars median, up to ~560) and
// would otherwise make the fixed-width sidebar run very tall. Long values collapse
// to two lines with a chevron affordance and expand in place on tap — the same
// clamp-on-collapse pattern the differential sections use (line-clamp-2 +
// group-open:line-clamp-none inside a <details>) — so nothing is removed, just
// tucked one tap away. Short values render as a plain row with no toggle.
function QuickRefRow({ row }: { row: MedicationQuickRow }) {
  const value = row.value.replace(/\*\*/g, "");
  const label = (
    <p className="text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">{row.label}</p>
  );

  if (value.length <= 110) {
    return (
      <div className="px-3 py-2.5">
        {label}
        <p className="mt-1 text-xs leading-5 text-[color:var(--text-heading)]">{value}</p>
      </div>
    );
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-col px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-2">
          {label}
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-[color:var(--decoration-soft)] transition group-open:rotate-180"
            aria-hidden="true"
          />
        </span>
        <span className="mt-1 line-clamp-2 text-xs leading-5 text-[color:var(--text-heading)] group-open:line-clamp-none">
          {value}
        </span>
      </summary>
    </details>
  );
}

function MedicationAccessPanel({ record }: { record: MedicationRecord }) {
  const badges = useMemo(() => medicationAccessBadges(record), [record]);
  const fields = useMemo(() => medicationAccessFields(record), [record]);
  if (!badges.length && !fields.length) return null;

  return (
    <SidebarCard title="Access" icon={Lock}>
      <div className="p-3">
        <BadgeCluster items={badges} compact limit={3} className="mb-2.5" />
        {fields.length ? (
          <dl className="grid gap-2 text-sm-minus">
            {fields.map((field, index) => (
              <div
                key={field.label}
                className={cn(
                  "flex justify-between gap-3",
                  index < fields.length - 1 && "border-b border-[color:var(--border)] pb-2",
                )}
              >
                <dt className="font-semibold text-[color:var(--text-muted)]">{field.label}</dt>
                <dd className="text-right font-medium text-[color:var(--text-heading)]">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </SidebarCard>
  );
}

/**
 * Owner-confirmed source links for this medication (ledger #05WXHX). The server
 * passes only links whose register record is signed off against its current
 * content, so an empty list — the state until the owner signs — renders nothing.
 */
function MedicationSourceLinks({ links }: { links: readonly MedicationSourceLink[] }) {
  if (!links.length) return null;
  return (
    <div className="border-t border-[color:var(--border)] px-3 py-3" data-testid="medication-source-links">
      <h3 className="text-sm-minus font-semibold text-[color:var(--text-heading)]">Sources</h3>
      <ul className="mt-2 space-y-1.5">
        {links.map((link) => (
          <li key={link.id} className="text-xs leading-5">
            <ExternalTextLink href={link.href}>{link.title}</ExternalTextLink>
            <span className="ml-1.5 text-[color:var(--text-muted)]">{link.publisher}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MedicationRecordDetail({
  record,
  governance,
  activeTab,
  sourceLinks = [],
}: {
  record: MedicationRecord;
  governance?: MedicationGovernance;
  /** Owned by `MedicationRecordPage` so the shared header can drive it. */
  activeTab: MedicationTabId;
  sourceLinks?: readonly MedicationSourceLink[];
}) {
  const metrics = useMemo(() => medicationHeroMetrics(record), [record]);
  const badges = useMemo(() => medicationIdentityBadges(record, governance), [record, governance]);
  const indication = useMemo(() => medicationIndication(record), [record]);
  const sectionsByTab = useMemo(() => {
    const raw = medicationSectionsByTab(record);
    const hasMaxDoseElsewhere =
      metrics.some((m) => isMaxDoseLabel(m.label)) ||
      record.quick.some((q) => /max.*dose/i.test(q.label) || /max/i.test(q.label));

    if (!hasMaxDoseElsewhere) return raw;

    // #J7RV8Q: Deduplicate maximum dose display on medication tabs.
    // The maximum dose is already prominently featured in Key figures and Quick reference;
    // omit the duplicate Maximum Dose row from the Rapid Summary section.
    return {
      ...raw,
      summary: raw.summary.map((section) => {
        if (section.type !== "summary") return section;
        return {
          ...section,
          rows: section.rows.filter((row) => !/^(?:max(?:imum)?\s+(?:daily\s+)?dose|dose)$/i.test(row.key.trim())),
        };
      }),
    };
  }, [metrics, record]);
  const activeSections = sectionsByTab[activeTab];
  const activeTabLabel = medicationNavSections.find((section) => section.id === activeTab)?.label ?? "Medication";

  return (
    <div className="space-y-3 py-1 sm:py-2" style={medicationAccentStyle(record.accent)}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-3.5">
          <section className="scroll-mt-16 py-1" data-testid="medication-record-block">
            <div className="flex items-start gap-3 sm:gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-[color:var(--border)] text-[color:var(--text-muted)] forced-colors:border sm:size-14">
                <Pill className="h-[46%] w-[46%]" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="break-words text-lg font-semibold leading-tight tracking-normal text-balance text-[color:var(--text-heading)] sm:text-xl">
                  {record.name}
                </h1>
                <p className="mt-1 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)] sm:text-sm">
                  {record.subclass || record.class}
                  {record.category ? (
                    <>
                      <span className="mx-1.5 text-[color:var(--decoration-soft)]">·</span>
                      {record.category}
                    </>
                  ) : null}
                </p>
                {indication ? (
                  <p className="mt-1 line-clamp-1 text-sm-minus leading-5 text-[color:var(--text-muted)]">
                    {indication}
                  </p>
                ) : null}
                <BadgeCluster items={badges} limit={5} showOverflowCount className="mt-2" />
                {sourceLinks.length === 0 ? (
                  <p
                    className="mt-2 text-sm-minus leading-5 text-[color:var(--text-muted)]"
                    data-testid="medication-no-source"
                  >
                    {/* Three records carry no written source notes, so Additional is named only when it has them. */}
                    {record.sections.some((section) => section.type === "src")
                      ? "No source link confirmed for this record yet. Its own source notes are under Additional."
                      : "No source link confirmed for this record yet, and no source notes are recorded for it."}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {/* Hairlines without stray edges at any count: every tile draws its
              right and bottom rule, the grid is pulled 1px past the clip so the
              outer column's and last row's rules fall outside it, and the
              section draws the top and bottom lines. */}
          <section aria-label="Key figures" className="overflow-hidden border-y border-[color:var(--border)]">
            <div className={cn("-mr-px -mb-px grid grid-cols-2", figureColumns[Math.min(metrics.length, 4)])}>
              {metrics.map((metric, index) => (
                // Some records repeat a stat label (e.g. adrenaline has two "Route"
                // stats), so the label alone is not a unique key — include the index.
                <DetailTile key={`${metric.label}-${index}`} metric={metric} />
              ))}
            </div>
          </section>

          <MedicationWhereItStands medicineName={record.name} />

          {/* The patient-profile and considerations cards used to sit here,
              between the hero stats and the sections. They moved behind the
              header's patients control: they are a per-patient overlay on a
              reference record, not part of the record, and inline they pushed
              every section below a permanently-empty prompt. */}

          {/* The panel is no longer a `tabpanel`: the control that swaps it is
              the shared header's section list, which is a list of buttons rather
              than a tablist, so claiming the role would name a `tab` that no
              longer exists. The id stays per-tab — it is the rendered evidence
              that a declared section resolves to a real panel, which is what
              `tests/in-page-nav-route-sections.dom.test.tsx` asserts. */}
          <section
            id={`medication-panel-${activeTab}`}
            aria-label={`${activeTabLabel} sections`}
            className="overflow-hidden rounded-lg border border-[color:var(--border)] border-l-[3px] border-l-[color:var(--med-accent)] bg-[color:var(--surface-raised)] shadow-[var(--e2)]"
          >
            {activeSections.length ? (
              activeSections.map((section) => (
                <SectionCard key={`${section.type}-${section.title}`} section={section} />
              ))
            ) : (
              <div className="p-3">
                <EmptyState
                  icon={ClipboardList}
                  title="Nothing in this view"
                  body="Switch tabs to see dosing, safety, or more detail for this medication."
                  live="polite"
                />
              </div>
            )}
            {/* The record's provenance ("src") sections live on this tab, so its confirmed source links do too. */}
            {activeTab === "more" ? <MedicationSourceLinks links={sourceLinks} /> : null}
          </section>

          <MedicationFromThisPage medicineName={record.name} />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <SidebarCard title="Quick reference" icon={BookOpen}>
            <div className="divide-y divide-[color:var(--border)]">
              {record.quick.map((row) => (
                <QuickRefRow key={row.label} row={row} />
              ))}
            </div>
          </SidebarCard>

          <MedicationAccessPanel record={record} />
        </aside>
      </div>
    </div>
  );
}

/** A hairline row out of the page: grey icon, title, optional second line, chevron. */
function OnwardRow({
  href,
  icon: Icon,
  title,
  detail,
  testId,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  detail?: string;
  testId?: string;
}) {
  return (
    <li className="min-w-0 border-t border-[color:var(--border)] first:border-t-0">
      <Link
        href={href}
        data-testid={testId}
        className={cn(
          focusRing,
          "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg py-2 text-[color:var(--text-heading)] no-underline",
        )}
      >
        <Icon className="size-icon-md shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
        <span className="grid min-w-0 gap-0.5">
          <span className="break-words text-base-minus font-medium leading-snug">{title}</span>
          {detail ? <span className="text-sm leading-snug text-[color:var(--text-muted)]">{detail}</span> : null}
        </span>
        <ChevronRight className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
      </Link>
    </li>
  );
}

const fromPageLabel = "text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]";

/**
 * "From this page" (mock-up v6, screen 15). No calculator, monitoring schedule
 * or factsheet is linked to any medicine record yet, so the page says so in one
 * grey line rather than leaving a gap, and offers the reader's own documents.
 */
function MedicationFromThisPage({ medicineName }: { medicineName: string }) {
  return (
    <section aria-labelledby="medication-from-page-heading" data-testid="medication-from-page" className="grid gap-1.5">
      <h2 id="medication-from-page-heading" className={fromPageLabel}>
        From this page
      </h2>
      <p className="text-sm-minus leading-5 text-[color:var(--text-muted)]">
        No calculator, monitoring schedule or factsheet is linked to this medicine page yet.
      </p>
      <ul role="list" className="grid">
        <OnwardRow
          href={appModeHomeHref("documents", { query: medicineName, run: true })}
          icon={FileSearch}
          title={`Search your PDFs for ${medicineName}`}
          detail="Opens Documents"
          testId="medication-search-pdfs"
        />
        {/* Some medicines already have a factsheet in the Factsheets section; until they are linked
            here, the section is one tap away so "nothing linked" is never read as "none exists". */}
        <OnwardRow
          href={appModeHomeHref("factsheets")}
          icon={BookOpen}
          title="Browse factsheets"
          detail="Patient and family leaflets"
          testId="medication-browse-factsheets"
        />
      </ul>
    </section>
  );
}

/** How long the record may take before the page says it is slow. */
const MEDICATION_SLOW_LOAD_MS = 8_000;

/**
 * Grey placeholders while the record loads (mock-up v6, screen 13). After
 * eight seconds a plain line says it is slow. Nothing clinical is shown until
 * the record arrives, so a half-loaded page never looks complete.
 */
function MedicationLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), MEDICATION_SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="grid gap-3">
      {slow ? (
        <div
          role="status"
          data-testid="medication-slow-load"
          className="flex items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 forced-colors:border"
        >
          <History className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
          <div className="grid gap-0.5">
            <p className="text-sm font-semibold text-[color:var(--text-heading)]">Still loading</p>
            <p className="text-xs leading-snug text-[color:var(--text-muted)]">
              Taking longer than usual. Nothing is shown until the record arrives.
            </p>
          </div>
        </div>
      ) : null}
      <LoadingPanel label="Loading medication reference…" variant="skeleton" lines={6} />
    </div>
  );
}

/** A slug as words, for the failed page's PDF search when no record arrived to name it. */
function slugAsWords(slug: string): string {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // A malformed escape: use it as typed.
  }
  return decoded.replace(/[-_]+/g, " ").trim();
}

/**
 * The record could not be fetched (mock-up v6, screen 14): say so plainly,
 * never as an empty page, with one button to try again and two ways forward.
 */
function MedicationLoadFailed({ slug, error, onRetry }: { slug: string; error: string | null; onRetry: () => void }) {
  const words = slugAsWords(slug);
  // The hook's own offline wording; any other failure (sign-in, rate limit, server) is not a connection problem.
  const offline = Boolean(error && /offline/i.test(error));
  return (
    <section aria-labelledby="medication-failed-heading" data-testid="medication-load-failed" className="grid gap-4">
      {/* Only the message is announced; the retry button and onward links are reached in order. */}
      <div role="alert" className="grid gap-1">
        <h1 id="medication-failed-heading" className="text-lg font-semibold text-[color:var(--text-heading)]">
          This medicine page didn&rsquo;t load
        </h1>
        <p className="text-sm leading-6 text-[color:var(--text-muted)]">
          {offline
            ? "The server didn\u2019t answer. Check the connection, then try again."
            : error
              ? "Try again in a moment. If it keeps happening, the reason is below."
              : "Try again in a moment."}
        </p>
        {/* The request's own reason, so a sign-in or server fault is never passed off as a bad connection. */}
        {error ? (
          <p className="text-xs leading-snug text-[color:var(--text-muted)]">
            Details: <span data-testid="medication-load-error">{error}</span>
          </p>
        ) : null}
      </div>
      <Button variant="primary" onClick={onRetry} testId="medication-retry" className="justify-self-start">
        Try again
      </Button>
      <ul role="list" className="grid">
        {words ? (
          <OnwardRow
            // Prefilled, not run: the words come from the address, so the reader presses search.
            href={appModeHomeHref("documents", { query: words })}
            icon={FileSearch}
            title={`Search your PDFs for ${words}`}
            detail="Opens Documents"
          />
        ) : null}
        <OnwardRow href={appModeHomeHref("prescribing")} icon={Pill} title="Back to all medicines" />
      </ul>
    </section>
  );
}

/**
 * Notes this medicine on the device for the Medicines hub's "Recent" list:
 * slug and name only. Nothing is written while "Save recent searches" is off.
 */
function useRecordMedicineVisit(slug: string | null, name: string | null) {
  const { canRecordRecentSearches } = useAppPreferences();
  useEffect(() => {
    if (!slug || !name || !canRecordRecentSearches || !mayRecordRecentSearches()) return;
    recordMedicineVisit({ slug, name, at: Date.now() });
  }, [slug, name, canRecordRecentSearches]);
}

/** TGA eBS search of Product Information documents whose trade name or active ingredient matches. */
function tgaProductInformationSearchUrl(name: string) {
  const url = new URL("https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI");
  url.search = `OpenForm&q=${encodeURIComponent(name)}&t=pi`;
  return url.toString();
}

export function MedicationRecordPage({
  slug,
  fallbackRecord,
  fallbackGovernance,
  sourceLinks = [],
}: {
  slug: string;
  fallbackRecord?: MedicationRecord;
  fallbackGovernance?: MedicationGovernance;
  /** Owner-confirmed source links, resolved server-side (`medicationSourceLinks`). */
  sourceLinks?: readonly MedicationSourceLink[];
}) {
  const { data, loading, error, notFound, retry } = useMedicationDetail(slug);
  // Content-first: render the SSR fallback immediately, then swap in the live
  // (owner-aware) record once the hook resolves. Only fall back to the skeleton
  // when there is no server record to show (owner-only slugs) and the fetch is
  // still in flight; the error state applies only when nothing renderable exists.
  const record = data?.record ?? fallbackRecord ?? null;
  // Only trust the SSR fallback governance while the live fetch is still in
  // flight. A failed request means the authoritative status is unknown, so
  // don't keep presenting the fixture-derived guess as if it were confirmed.
  const governance = data?.governance ?? (error ? undefined : fallbackGovernance);
  // Owned here rather than in `MedicationRecordDetail` so the shared header —
  // which sits above the shell — can drive it. The record can swap underneath
  // (SSR fallback → live), and every record offers the same four tabs, so the
  // selection survives that swap rather than snapping back to Summary.
  const [activeTab, setActiveTab] = useState<MedicationTabId>("summary");
  // The record's own slug, never the address text, so Recent always links to a page that exists.
  useRecordMedicineVisit(record?.slug ?? null, record?.name ?? null);
  // Where the catalogue's own "Key Interactions" section currently lives.
  const interactionsTab = medicationTabForSectionType("inter") ?? "more";
  const [patientOpen, setPatientOpen] = useState(false);
  const patientTriggerRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const retryAndKeepFocus = () => {
    retry();
    bodyRef.current?.focus();
  };

  return (
    <>
      <MedicationNavHeader
        title={record?.name ?? (notFound ? "Not found" : slug)}
        record={record}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenPatientDetails={() => setPatientOpen(true)}
      />
      <Sheet
        open={patientOpen}
        onClose={() => setPatientOpen(false)}
        title="Patient details"
        description="Optional. Used only in this browser to tailor dosing, safety and contraindication notes."
        closeLabel="Close patient details"
        returnFocusRef={patientTriggerRef}
        testId="medication-patient-sheet"
      >
        <div className="grid gap-3">
          <PatientProfilePanel defaultOpen />
          {record ? <MedicationConsiderations record={record} /> : null}
        </div>
      </Sheet>
      <InformationPageShell testId={`medication-page-${slug}`} gap={false}>
        {/* Focus lands here after "Try again", whose button the loading state replaces. */}
        <div ref={bodyRef} tabIndex={-1} className="mt-3 outline-none">
          {/* Findings against the entered patient belong on the page, not only
              behind the patient sheet — arriving here from a result row flagged
              "2 interactions" should not mean hunting for them. Renders nothing
              when no profile is entered or nothing matched. */}
          {record ? (
            <MedicationInteractionCallout
              record={record}
              onOpenPatientDetails={() => setPatientOpen(true)}
              onOpenInteractionsSection={() => setActiveTab(interactionsTab)}
              className="mb-3"
            />
          ) : null}
          {record ? (
            <MedicationRecordDetail
              record={record}
              governance={governance}
              activeTab={activeTab}
              sourceLinks={sourceLinks}
            />
          ) : loading ? (
            <MedicationLoading />
          ) : notFound ? (
            // The API said this slug is not in the catalogue (after sign-in resolved),
            // so name it and route back, as every other catalogue does, rather than
            // showing a bare request failure that reads as the system being broken.
            <RouteNotFoundPanel
              title="Medication Not Found"
              description="The requested medication could not be found in the catalogue."
              returnHref={appModeHomeHref("prescribing")}
              returnLabel="Return to medications"
            />
          ) : (
            <MedicationLoadFailed slug={slug} error={error} onRetry={retryAndKeepFocus} />
          )}
        </div>
        <InformationPageFooter className="mt-4 pb-1">
          {/* A record with owner-confirmed source links points at them (they render in the Additional tab's
              Sources list). A record without any keeps the owner's chosen default: a TGA Product Information
              search (ledger #05WXHX). */}
          {sourceLinks.length > 0 ? (
            <>
              PsychSift is a clinical reference prototype, not validated decision support. Verify every dose and
              interaction against this record&rsquo;s linked sources (listed under Sources on the Additional tab) and
              your local guideline before acting on it.
            </>
          ) : (
            <>
              PsychSift is a clinical reference prototype, not validated decision support. This record does not yet link
              to its own sources: verify every dose and interaction against the current Australian product information
              or your local guideline before acting on it.
              {record ? (
                <>
                  {" "}
                  <a
                    href={tgaProductInformationSearchUrl(record.name)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-[color:var(--clinical-accent)] underline underline-offset-2"
                  >
                    Search the TGA Product Information for {record.name}
                  </a>
                  .
                </>
              ) : null}
            </>
          )}
        </InformationPageFooter>
      </InformationPageShell>
    </>
  );
}

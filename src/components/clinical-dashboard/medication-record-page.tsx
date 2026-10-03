"use client";

import {
  Activity,
  Ban,
  TriangleAlert,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  FlaskConical,
  Gauge,
  Lock,
  Pill,
  ShieldAlert,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties } from "react";

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
import { useMedicationDetail } from "@/components/clinical-dashboard/use-medication-catalog";
import {
  medicationAccessBadges,
  medicationAccessFields,
  medicationIdentityBadges,
  medicationRowBadges,
  type MedicationGovernance,
} from "@/lib/medication-badges";
import {
  medicationHeroMetrics,
  medicationIndication,
  type MedicationHeroMetric,
  type MedicationQuickRow,
  type MedicationRecord,
  type MedicationSection,
} from "@/lib/medications";
import type { SemanticTone } from "@/lib/semantic-tone";
import {
  cn,
  EmptyState,
  LoadingPanel,
  toneDanger,
  toneInfo,
  toneSuccess,
  toneWarning,
} from "@/components/ui-primitives";
import { InformationPageFooter, InformationPageShell } from "@/components/information-page-shell";
import { RouteNotFoundPanel } from "@/components/route-not-found-panel";
import { appModeHomeHref } from "@/lib/app-modes";
import type { MedicationSourceLink } from "@/lib/medication-source-links";
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
// Only `--med-accent` and `--med-accent-border` are consumed; a soft wash was
// removed once nothing read it (#157).
function medicationAccentStyle(accent: string | undefined): CSSProperties {
  const base = accent?.trim() || "var(--clinical-accent)";
  return {
    "--med-accent": base,
    "--med-accent-border": `color-mix(in srgb, ${base} 34%, var(--surface))`,
  } as CSSProperties;
}

// Tone-driven hero metric tile. Colour comes only from the metric's semantic tone
// (medicationStatTone, via medicationHeroMetrics) so it honours the #659 contract:
// green = success, amber = caution, red = safety, teal = primary/evidence. The
// value stays in a high-contrast heading colour on every tone so text never sits
// on a same-hue wash (the readability lesson from #659) — the border, soft fill,
// label and icon chip carry the colour.
const heroToneTile: Record<SemanticTone, { card: string; chip: string; label: string; value: string }> = {
  clinical: {
    card: "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]",
    chip: "border-[color:var(--clinical-accent)]/25 bg-[color:var(--surface)] text-[color:var(--clinical-accent)]",
    label: "text-[color:var(--clinical-accent)]",
    value: "text-[color:var(--text-heading)]",
  },
  danger: {
    card: toneDanger,
    chip: "border-[color:var(--danger)]/25 bg-[color:var(--surface)] text-[color:var(--danger)]",
    label: "text-[color:var(--danger)]",
    value: "text-[color:var(--danger-text)]",
  },
  warning: {
    card: toneWarning,
    chip: "border-[color:var(--warning)]/25 bg-[color:var(--surface)] text-[color:var(--warning)]",
    label: "text-[color:var(--warning)]",
    value: "text-[color:var(--text-heading)]",
  },
  success: {
    card: toneSuccess,
    chip: "border-[color:var(--success)]/25 bg-[color:var(--surface)] text-[color:var(--success)]",
    label: "text-[color:var(--success)]",
    value: "text-[color:var(--text-heading)]",
  },
  info: {
    card: toneInfo,
    chip: "border-[color:var(--info-border)] bg-[color:var(--surface)] text-[color:var(--info)]",
    label: "text-[color:var(--info)]",
    value: "text-[color:var(--text-heading)]",
  },
  neutral: {
    card: "border-[color:var(--border)] bg-[color:var(--surface-raised)]",
    chip: "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
    label: "text-[color:var(--text-muted)]",
    value: "text-[color:var(--text-heading)]",
  },
};

// Icon keyed to the metric's meaning: a gauge for the dose ceiling, a timer for
// time-based metrics (half-life / onset / duration), and a tone-appropriate shield
// or alert for everything else (risk & caution flags). Rendered directly (rather
// than assigning the component to a local) so it stays a static component.
function HeroMetricIcon({ metric }: { metric: MedicationHeroMetric }) {
  const label = metric.label.toLowerCase();
  const iconClass = "h-3.5 w-3.5";
  if (/dose|ceiling|\bmax\b/.test(label)) return <Gauge className={iconClass} aria-hidden="true" />;
  if (/half-life|onset|duration|timing|freq/.test(label)) return <Timer className={iconClass} aria-hidden="true" />;
  if (metric.tone === "danger") return <ShieldAlert className={iconClass} aria-hidden="true" />;
  if (metric.tone === "warning") return <TriangleAlert className={iconClass} aria-hidden="true" />;
  if (metric.tone === "success") return <ShieldCheck className={iconClass} aria-hidden="true" />;
  return <Activity className={iconClass} aria-hidden="true" />;
}

function DetailTile({ metric }: { metric: MedicationHeroMetric }) {
  const tone = heroToneTile[metric.tone];
  return (
    <div className={cn("rounded-lg border p-3 shadow-[var(--shadow-inset)]", tone.card)}>
      <div className="flex items-center gap-2">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md border", tone.chip)}>
          <HeroMetricIcon metric={metric} />
        </span>
        <p className={cn("text-2xs font-semibold uppercase leading-tight tracking-eyebrow", tone.label)}>
          {metric.label}
        </p>
      </div>
      <p className={cn("mt-1.5 text-sm-minus font-semibold leading-5", tone.value)}>{metric.value}</p>
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
  const sectionsByTab = useMemo(() => medicationSectionsByTab(record), [record]);
  const activeSections = sectionsByTab[activeTab];
  const activeTabLabel = medicationNavSections.find((section) => section.id === activeTab)?.label ?? "Medication";

  return (
    <div className="space-y-3 py-1 sm:py-2" style={medicationAccentStyle(record.accent)}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-3.5">
          <section className="scroll-mt-16 overflow-hidden rounded-xl border border-[color:var(--border)] border-l-4 border-l-[color:var(--med-accent)] bg-[color:var(--surface-raised)] p-3.5 shadow-[var(--e2)] sm:p-5">
            <div className="flex items-start gap-3 sm:items-center sm:gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[color:var(--med-accent-border)] bg-[color:var(--surface)] text-[color:var(--med-accent)] shadow-[var(--shadow-inset)] sm:h-14 sm:w-14">
                <Pill className="h-[52%] w-[52%]" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-semibold leading-tight tracking-normal text-[color:var(--text-heading)] sm:text-3xl">
                  {record.name}
                </h1>
                <p className="mt-1 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)] sm:text-sm">
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[color:var(--med-accent)] align-middle"
                    aria-hidden="true"
                  />
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
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            {metrics.map((metric, index) => (
              // Some records repeat a stat label (e.g. adrenaline has two "Route"
              // stats), so the label alone is not a unique key — include the index.
              <DetailTile key={`${metric.label}-${index}`} metric={metric} />
            ))}
          </section>

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
  const { data, loading, error, notFound } = useMedicationDetail(slug);
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
  // Where the catalogue's own "Key Interactions" section currently lives.
  const interactionsTab = medicationTabForSectionType("inter") ?? "more";
  const [patientOpen, setPatientOpen] = useState(false);
  const patientTriggerRef = useRef<HTMLElement | null>(null);

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
        <div className="mt-3">
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
            <LoadingPanel label="Loading medication reference…" variant="skeleton" lines={6} />
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
            <div className="rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] p-4 text-sm text-[color:var(--danger-text)]">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{error ?? "Medication not found."}</p>
              </div>
            </div>
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

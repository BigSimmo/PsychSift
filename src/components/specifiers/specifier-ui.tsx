import Link from "next/link";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { ArrowRight, Bookmark, CheckCircle2, ChevronsUpDown, Info, Minus, ShieldAlert, Tags } from "lucide-react";

import { cardSurface } from "@/components/card-recipes";
import { InformationPageBreadcrumbs, InformationPageShell } from "@/components/information-page-shell";
import { cn, eyebrowText } from "@/components/ui-primitives";
import type { SpecifierRecord } from "@/lib/specifiers";
import type { SpecifierSourceStatus } from "@/lib/specifiers-search-index";
import { SPECIFIERS_SAFETY_NOTE } from "@/lib/specifiers-governance";

/**
 * Was a private copy of the same string `formulation-ui.tsx` also carried,
 * byte-identical in both. Kept as a named export so the mode's call sites read
 * as intended rather than incidental, but the definition is now shared.
 */
export const specifierCard = cardSurface;

export function SpecifierPageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <InformationPageShell className={className}>{children}</InformationPageShell>;
}

export function SpecifierBreadcrumbs({ current }: { current?: string }) {
  return <InformationPageBreadcrumbs home={{ label: "Specifiers", href: "/specifiers/search" }} current={current} />;
}

const specifierWordingPathwaySteps = [
  "Base diagnosis",
  "Episode features",
  "Course and onset",
  "Severity or remission",
] as const;

/** Non-interactive clinical wording order shared by map and builder. */
export function SpecifierWordingPathway() {
  return (
    <section
      aria-label="Specifier wording pathway"
      className="grid min-w-0 gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] p-3 sm:grid-cols-[minmax(0,0.8fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center"
    >
      {specifierWordingPathwaySteps.map((label, index) => (
        <div key={label} className="contents">
          <div className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-extrabold text-[color:var(--text-heading)]">
            <span className="nums grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent)] text-xs text-[color:var(--clinical-accent-contrast)]">
              {index + 1}
            </span>
            <span className="min-w-0 break-words">{label}</span>
          </div>
          {index < specifierWordingPathwaySteps.length - 1 ? (
            <ArrowRight
              className="hidden h-4 w-4 justify-self-center text-[color:var(--clinical-accent)] sm:block"
              aria-hidden
            />
          ) : null}
        </div>
      ))}
    </section>
  );
}

export function SpecifierDiagnosisFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label
      className={cn(
        // Content-sized control: wide enough for “All diagnoses” without becoming a full-width field.
        "relative inline-flex min-h-tap w-auto max-w-full shrink-0 items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] py-1 pl-2.5 pr-7 text-xs font-semibold shadow-[var(--shadow-inset)]",
        "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--focus)]",
      )}
    >
      <span className="shrink-0 text-[color:var(--text-muted)]">Diagnosis</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Filter by diagnosis"
        className="w-40 max-w-[min(100%,12rem)] cursor-pointer appearance-none bg-transparent text-xs font-semibold text-[color:var(--text)] outline-none [-webkit-appearance:none] sm:w-44"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronsUpDown
        className="pointer-events-none absolute right-2 size-icon-sm text-[color:var(--decoration-soft)]"
        aria-hidden
      />
    </label>
  );
}

export function SpecifierMatchCard({ record, isTopMatch }: { record: SpecifierRecord; isTopMatch: boolean }) {
  const typicalLanguage = record.patientLanguage[0]?.trim();

  return (
    <article
      data-testid={isTopMatch ? "specifier-top-match" : undefined}
      data-specifier-match-card
      className={cn(
        specifierCard,
        "group relative overflow-hidden border-[color:var(--border-strong)] shadow-[var(--e2)] transition hover:border-[color:var(--clinical-accent)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--focus)] motion-reduce:transition-none",
        isTopMatch && "border-2 border-[color:var(--clinical-accent)]",
      )}
    >
      <Link
        href={`/specifiers/${record.slug}`}
        aria-label={`Open ${record.name}`}
        className="block focus-visible:outline-none"
      >
        <div data-specifier-card-main className="p-4 sm:p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-lg font-extrabold text-[color:var(--text-heading)] transition group-hover:text-[color:var(--clinical-accent)] motion-reduce:transition-none sm:text-xl">
                {record.name}
              </span>
              {isTopMatch ? (
                <span className="inline-flex min-h-6 items-center gap-1 rounded-md bg-[color:var(--success-soft)] px-2 text-2xs font-extrabold text-[color:var(--success)]">
                  <CheckCircle2 className="size-icon-xs" aria-hidden />
                  Top match
                </span>
              ) : null}
            </div>
            <span
              data-testid="specifier-open-tab"
              className="-mr-4 -mt-4 inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-bl-xl border-b border-l border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-xs font-semibold text-[color:var(--clinical-accent)] transition group-hover:border-[color:var(--clinical-accent)] group-hover:bg-[color:var(--clinical-accent)] group-hover:text-[color:var(--clinical-accent-contrast)] motion-reduce:transition-none sm:-mr-5 sm:-mt-5 sm:px-3.5 sm:text-sm"
            >
              <Bookmark className="h-4 w-4" aria-hidden />
              Open
            </span>
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,0.5fr)] sm:items-start">
            <div data-specifier-card-copy className="min-w-0">
              <p className="max-w-3xl text-sm font-medium leading-6 text-[color:var(--text-muted)]">{record.summary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <SpecifierFamilyBadge record={record} />
                <DiagnosisChips values={record.appliesTo.slice(0, 2)} />
              </div>
            </div>

            {/* A tinted well rather than a bordered card: the result is
                already the card, and a box inside it was a card in a card. */}
            <div
              data-specifier-card-signal
              className="rounded-lg bg-[color:var(--clinical-accent-soft)] p-3.5 sm:mt-0.5"
            >
              <p className={eyebrowText}>Deciding signal</p>
              <p className="mt-1.5 text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
                {record.clinicalSignal}
              </p>
            </div>
          </div>
        </div>

        <div
          data-specifier-card-details
          className={cn(
            "grid gap-px border-t border-[color:var(--border)] bg-[color:var(--border)]",
            typicalLanguage && "sm:grid-cols-2",
          )}
        >
          <div className="bg-[color:var(--surface-subtle)] px-4 py-3.5 sm:px-5 sm:py-4">
            <p className={eyebrowText}>Ask this</p>
            <p className="mt-1 text-xs font-medium leading-5 text-[color:var(--text-muted)] sm:text-sm">
              {record.decisionQuestion}
            </p>
          </div>
          {typicalLanguage ? (
            <div className="bg-[color:var(--surface-subtle)] px-4 py-3.5 sm:px-5 sm:py-4">
              <p className={eyebrowText}>Typical language</p>
              <p className="mt-1 text-xs font-medium leading-5 text-[color:var(--text-muted)] sm:text-sm">
                &ldquo;{typicalLanguage}&rdquo;
              </p>
            </div>
          ) : null}
        </div>
      </Link>
    </article>
  );
}

export function SpecifierFamilyBadge({ record }: { record: SpecifierRecord }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2 text-xs font-bold text-[color:var(--clinical-accent)]">
      <Tags className="h-3.5 w-3.5" aria-hidden />
      {record.familyLabel}
    </span>
  );
}

export function DiagnosisChips({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="inline-flex min-h-7 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2 text-xs font-semibold text-[color:var(--text-muted)]"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

export function SpecifierSafetyNote({
  compact = false,
  id,
  className,
}: {
  compact?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <aside
      id={id}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-sm leading-5 text-[color:var(--text-muted)]",
        compact ? "px-3 py-2.5" : "p-4",
        className,
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--info)]" aria-hidden />
      <p>{SPECIFIERS_SAFETY_NOTE}</p>
    </aside>
  );
}

export { SectionHeading } from "@/components/ui/section-heading";
// ── Catalog additions (small stylistic upgrades borrowed from the Specifiers v2 design) ──

type CategoryTone = { color: string; background: string; borderColor: string };

// Categorical (taxonomy) palette drawn from existing tokens — never semantic status.
// Reuses the repo's `--type-*` categorical chips + tone tokens so it stays theme-aware.
const categoryPalette: CategoryTone[] = [
  {
    color: "var(--type-document)",
    background: "var(--type-document-soft)",
    borderColor: "var(--type-document-border)",
  },
  { color: "var(--type-table)", background: "var(--type-table-soft)", borderColor: "var(--type-table-border)" },
  { color: "var(--type-source)", background: "var(--type-source-soft)", borderColor: "var(--type-source-border)" },
  { color: "var(--type-service)", background: "var(--type-service-soft)", borderColor: "var(--type-service-border)" },
  { color: "var(--type-form)", background: "var(--type-form-soft)", borderColor: "var(--type-form-border)" },
  {
    color: "var(--clinical-accent-hover)",
    background: "var(--clinical-accent-soft)",
    borderColor: "var(--clinical-accent-border)",
  },
  {
    color: "var(--tone-rose)",
    background: "color-mix(in srgb, var(--tone-rose) 12%, transparent)",
    borderColor: "color-mix(in srgb, var(--tone-rose) 32%, transparent)",
  },
  {
    color: "var(--tone-indigo)",
    background: "color-mix(in srgb, var(--tone-indigo) 12%, transparent)",
    borderColor: "color-mix(in srgb, var(--tone-indigo) 32%, transparent)",
  },
  {
    color: "var(--tone-purple)",
    background: "color-mix(in srgb, var(--tone-purple) 12%, transparent)",
    borderColor: "color-mix(in srgb, var(--tone-purple) 32%, transparent)",
  },
  { color: "var(--type-search)", background: "var(--type-search-soft)", borderColor: "var(--type-search-border)" },
];

const categoryOrder = [
  "ndv",
  "psy",
  "bip",
  "dep",
  "anx",
  "ocd",
  "trm",
  "dis",
  "som",
  "eat",
  "eli",
  "slp",
  "sxd",
  "gen",
  "imp",
  "sub",
  "ncg",
  "per",
  "par",
  "icd",
];

export function categoryTone(categoryId: string): CategoryTone {
  const known = categoryOrder.indexOf(categoryId);
  const index = known >= 0 ? known : Array.from(categoryId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return categoryPalette[index % categoryPalette.length];
}

/** Strip the leading "1. " ordinal from a category name for compact chips. */
export function categoryShortName(name: string) {
  return name.replace(/^\s*\d+\.\s*/, "");
}

export function CategoryTag({ categoryId, name, className }: { categoryId: string; name: string; className?: string }) {
  const tone = categoryTone(categoryId);
  const style: CSSProperties = { color: tone.color, background: tone.background, borderColor: tone.borderColor };
  return (
    <span
      className={cn("inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 text-2xs font-bold", className)}
      style={style}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.color }} aria-hidden />
      {categoryShortName(name)}
    </span>
  );
}

const sourceStatusMeta: Record<
  SpecifierSourceStatus,
  { label: string; icon: ComponentType<{ className?: string }>; className: string }
> = {
  // Grey, not green: this status says the SOURCE was checked, never that a named clinician
  // signed the entry off, so it must not look like a sign-off (audit S6, 13 Oct 2026).
  "source-verified": {
    label: "Source checked, not signed off",
    icon: Info,
    className: "border-[color:var(--border)] bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
  },
  "source-needs-formal-review": {
    label: "Review due",
    icon: ShieldAlert,
    className: "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
  },
  "source-not-applicable": {
    label: "Source n/a",
    icon: Minus,
    className: "border-[color:var(--border)] bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
  },
};

export function ReviewStatusBadge({ status, className }: { status: SpecifierSourceStatus; className?: string }) {
  const meta = sourceStatusMeta[status] ?? sourceStatusMeta["source-needs-formal-review"];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 text-2xs font-bold",
        meta.className,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </span>
  );
}

export function DsmBadge({ label = "DSM-5-TR" }: { label?: string }) {
  return (
    <span className="inline-flex min-h-6 items-center gap-1.5 rounded-md border border-[color:var(--info-border)] bg-[color:var(--info-soft)] px-2 text-2xs font-bold text-[color:var(--info)]">
      <Info className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

/** Compact 2×2-style reference tile (Specifiers v2 look). */
export function QuickTile({
  icon: Icon,
  label,
  body,
  tone = "default",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  body: string;
  tone?: "default" | "accent" | "info" | "success";
}) {
  const toneClass =
    tone === "accent"
      ? "border-[color:var(--clinical-accent-border)] text-[color:var(--clinical-accent)]"
      : tone === "info"
        ? "border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-[color:var(--info)]"
        : tone === "success"
          ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]"
          : "border-[color:var(--border)] text-[color:var(--text-muted)]";
  const bodyClass =
    tone === "info"
      ? "text-[color:var(--info)]"
      : tone === "success"
        ? "text-[color:var(--success)]"
        : "text-[color:var(--text-muted)]";
  return (
    <div className={cn("rounded-lg border bg-[color:var(--surface)] p-4", toneClass)}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="text-2xs font-extrabold uppercase tracking-label">{label}</span>
      </div>
      <p className={cn("text-xs font-medium leading-5", bodyClass)}>{body}</p>
    </div>
  );
}

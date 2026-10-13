"use client";

import { buttonFaceClass } from "@/components/ui/button-face";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  GitCompareArrows,
  ListFilter,
  Scale,
  ShieldCheck,
} from "lucide-react";

import { DsmPageHeader } from "@/components/dsm/dsm-page-header";
import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import { inPageActionRowClass, inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";
import { dsmSearchHref } from "@/lib/app-modes";
import { cn, codeText, metadataPill, pageContainer } from "@/components/ui-primitives";

export type DsmDifferentialConsideration = {
  id: string;
  title: string;
  fullText: string;
  rationale: string;
  group: "course" | "substance-medical" | "context" | "overlap";
  matchedDiagnosis?: {
    slug: string;
    title: string;
    icdCode: string;
    category: string;
    coreFeatures: string[];
  };
};

const groups = [
  { id: "all", label: "All considerations" },
  { id: "course", label: "Course & threshold" },
  { id: "substance-medical", label: "Substance / medical" },
  { id: "context", label: "Context & development" },
  { id: "overlap", label: "Clinical overlap" },
] as const;

type GroupId = (typeof groups)[number]["id"];

/**
 * Ids and labels carried over from `dsmDifferentialSections` in the pill rail
 * this replaces. Three of the four declared anchors existed nowhere in the DOM,
 * so this route drew a one-item "Filters" rail; they are wired in below.
 *
 * `dsm-differential-considerations` and `dsm-differential-clarify` live inside
 * the `{selected ? …}` panel, so they resolve only once a consideration is
 * selected — which is every render that has any considerations at all, and none
 * of the empty-state renders. `useInPageSectionNav` drops what is not there.
 */
export const dsmDifferentialNavSections: readonly PageSection[] = [
  { id: "dsm-differential-overview", label: "Overview", icon: Scale },
  { id: "dsm-differential-filters", label: "Filters", icon: ListFilter },
  { id: "dsm-differential-considerations", label: "Considerations", icon: CircleHelp },
  { id: "dsm-differential-clarify", label: "Clarify / review", icon: ShieldCheck },
];

export function DsmDifferentialConsiderationsPage({
  diagnosis,
  considerations,
}: {
  diagnosis: { slug: string; title: string; icdCode: string; category: string };
  considerations: DsmDifferentialConsideration[];
}) {
  const { sections, activeId, selectSection } = useInPageSectionNav(dsmDifferentialNavSections);
  const [activeGroup, setActiveGroup] = useState<GroupId>("all");
  const [selectedId, setSelectedId] = useState(considerations[0]?.id ?? "");
  const visible = useMemo(
    () => considerations.filter((item) => activeGroup === "all" || item.group === activeGroup),
    [activeGroup, considerations],
  );
  const selected = considerations.find((item) => item.id === selectedId) ?? visible[0] ?? considerations[0];

  function selectGroup(group: GroupId) {
    setActiveGroup(group);
    const first = considerations.find((item) => group === "all" || item.group === group);
    if (first) setSelectedId(first.id);
  }

  const comparisonHref = selected?.matchedDiagnosis
    ? `/dsm/compare?ids=${encodeURIComponent(`${diagnosis.slug},${selected.matchedDiagnosis.slug}`)}`
    : `/dsm/compare?ids=${encodeURIComponent(diagnosis.slug)}`;

  return (
    <>
      <InPageNavHeader
        back={{ href: dsmSearchHref, label: "DSM-5" }}
        title={diagnosis.title}
        sections={sections}
        activeId={activeId}
        onSelectSection={selectSection}
        actionsNoun="consideration set"
        actionsDescription="Choose how to use these differential considerations."
        testIdPrefix="dsm-differential"
        actions={
          <div className="grid gap-2">
            <Link href={`/dsm/diagnoses/${diagnosis.slug}`} className={inPageActionRowClass}>
              <BookOpenCheck className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Diagnosis record
            </Link>
          </div>
        }
      />
      <div data-testid="dsm-differential-considerations-page" className="min-h-full bg-[color:var(--background)] pb-8">
        <DsmPageHeader
          eyebrow="Differential considerations"
          title={diagnosis.title}
          description="Review the supplied alternatives by course, threshold, context, and exclusion. The list is not ranked and does not replace a complete assessment."
          code={diagnosis.icdCode}
          category={diagnosis.category}
          breadcrumb={false}
        />

        <div className={cn(pageContainer, "space-y-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-8")}>
          <section
            id="dsm-differential-overview"
            className={cn(
              inPageAnchor,
              "rounded-xl border border-[color:var(--info-border)] bg-[color:var(--info-soft)]/40 p-3 sm:flex sm:items-center sm:justify-between sm:gap-4",
            )}
          >
            <div className="flex items-start gap-2.5">
              <Scale className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--info)]" aria-hidden />
              <div>
                <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">
                  Structured review aid · not ranked
                </h2>
                <p className="mt-0.5 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                  Each item is taken from the supplied local diagnosis record. Open matched records to review their
                  complete criteria.
                </p>
              </div>
            </div>
            <span className={cn("mt-3 inline-flex sm:mt-0", metadataPill)}>{considerations.length} considerations</span>
          </section>

          <section
            id="dsm-differential-filters"
            aria-labelledby="dsm-differential-filters-title"
            className={cn(inPageAnchor, "grid gap-2")}
          >
            <h2
              id="dsm-differential-filters-title"
              className="inline-flex items-center gap-2 text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]"
            >
              <ListFilter className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
              Review lens
            </h2>
            <div className="answer-suggestion-row-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              {groups.map((group) => {
                const count = considerations.filter((item) => group.id === "all" || item.group === group.id).length;
                if (count === 0) return null;
                const active = activeGroup === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectGroup(group.id)}
                    className={cn(
                      "inline-flex min-h-tap shrink-0 items-center rounded-lg border px-3 text-xs font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                      active
                        ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                        : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)]",
                    )}
                  >
                    {group.label} · {count}
                  </button>
                );
              })}
            </div>
          </section>

          {selected ? (
            <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
              <section
                id="dsm-differential-considerations"
                aria-label="Differential consideration list"
                className={cn(
                  inPageAnchor,
                  "overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--e2)]",
                )}
              >
                <div className="border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2.5 text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                  {visible.length} {visible.length === 1 ? "consideration" : "considerations"}
                </div>
                <div className="divide-y divide-[color:var(--border)]">
                  {visible.map((item, index) => {
                    const active = item.id === selected.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        aria-pressed={active}
                        className={cn(
                          "group grid min-h-[4.5rem] w-full grid-cols-[2rem_minmax(0,1fr)_1.25rem] items-start gap-2.5 px-3 py-3 text-left transition focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]",
                          active
                            ? "bg-[color:var(--clinical-accent-soft)]/60"
                            : "hover:bg-[color:var(--surface-subtle)]",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-7 w-7 place-items-center rounded-lg border text-2xs font-extrabold",
                            active
                              ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                              : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]",
                          )}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-extrabold leading-5 text-[color:var(--text-heading)]">
                            {item.title}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                            {item.rationale}
                          </span>
                        </span>
                        <ChevronRight
                          className={cn(
                            "mt-1 h-4 w-4 text-[color:var(--decoration-soft)]",
                            active && "text-[color:var(--clinical-accent)]",
                          )}
                          aria-hidden
                        />
                      </button>
                    );
                  })}
                </div>
              </section>

              <article className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--e2)] lg:sticky lg:top-20">
                <header className="border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-4">
                  <p className="text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--clinical-accent)]">
                    Differential consideration
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold leading-tight text-[color:var(--text-heading)]">
                    {selected.title}
                  </h2>
                  {selected.matchedDiagnosis ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={cn(metadataPill, codeText)}>{selected.matchedDiagnosis.icdCode}</span>
                      <span className={metadataPill}>{selected.matchedDiagnosis.category}</span>
                    </div>
                  ) : null}
                </header>

                <div className="grid gap-4 p-4 sm:p-5">
                  <section aria-labelledby="why-consider-title">
                    <div className="flex items-center gap-2">
                      <CircleHelp className="h-5 w-5 text-[color:var(--clinical-accent)]" aria-hidden />
                      <h3 id="why-consider-title" className="text-sm font-extrabold text-[color:var(--text-heading)]">
                        Why consider it
                      </h3>
                    </div>
                    <p className="mt-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2.5 text-sm font-medium leading-6 text-[color:var(--text-heading)]">
                      {selected.rationale}
                    </p>
                  </section>

                  <section aria-labelledby="features-favour-title">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-[color:var(--success)]" aria-hidden />
                      <h3
                        id="features-favour-title"
                        className="text-sm font-extrabold text-[color:var(--text-heading)]"
                      >
                        Criteria and features to review
                      </h3>
                    </div>
                    {selected.matchedDiagnosis?.coreFeatures.length ? (
                      <ul className="mt-2 grid gap-2">
                        {selected.matchedDiagnosis.coreFeatures.map((feature) => (
                          <li
                            key={feature}
                            className="flex items-start gap-2 text-sm font-medium leading-6 text-[color:var(--text-muted)]"
                          >
                            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[color:var(--success)]" aria-hidden />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                        No matching structured diagnosis record was identified. Review the supplied consideration
                        exactly as written: {selected.fullText}
                      </p>
                    )}
                  </section>

                  <section id="dsm-differential-clarify" aria-labelledby="clarify-title" className={inPageAnchor}>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-[color:var(--info)]" aria-hidden />
                      <h3 id="clarify-title" className="text-sm font-extrabold text-[color:var(--text-heading)]">
                        Questions to clarify
                      </h3>
                    </div>
                    <ul className="mt-2 grid gap-2 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                      <li>Which documented criteria and exclusions are met for each possibility?</li>
                      <li>What timeline, course, and functional change best distinguishes the alternatives?</li>
                      <li>
                        Are substance, medication, medical, developmental, and contextual explanations adequately
                        assessed?
                      </li>
                    </ul>
                  </section>

                  <div className="flex flex-col gap-2 border-t border-[color:var(--border)] pt-4 sm:flex-row">
                    {selected.matchedDiagnosis ? (
                      <Link
                        href={`/dsm/diagnoses/${selected.matchedDiagnosis.slug}`}
                        className="inline-flex min-h-tap flex-1 items-center justify-center gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-sm font-extrabold text-[color:var(--clinical-accent)]"
                      >
                        Open diagnosis record
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    ) : null}
                    <Link href={comparisonHref} className={cn(buttonFaceClass({ variant: "primary" }), "flex-1")}>
                      <GitCompareArrows className="h-4 w-4" aria-hidden />
                      Add to comparison
                    </Link>
                  </div>
                </div>
              </article>
            </div>
          ) : (
            <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-8 text-center shadow-[var(--shadow-inset)]">
              <h2 className="text-lg font-extrabold text-[color:var(--text-heading)]">
                No differential considerations supplied
              </h2>
              <p className="mt-1 text-sm font-medium text-[color:var(--text-muted)]">
                Return to the diagnosis record to review the available criteria and specifiers.
              </p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

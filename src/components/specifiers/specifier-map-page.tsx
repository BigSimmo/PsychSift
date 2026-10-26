"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, CheckCircle2, GitCompareArrows, Tags, Waypoints } from "lucide-react";
import { useState } from "react";

import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import {
  SpecifierMapNavHeader,
  specifierMapSteps,
  useSpecifierMapNavigation,
} from "@/components/specifiers/specifier-map-nav-header";
import {
  DiagnosisChips,
  SpecifierFamilyBadge,
  SpecifierPageShell,
  SpecifierSafetyNote,
  specifierCard,
} from "@/components/specifiers/specifier-ui";
import { cn, eyebrowText, primaryControl } from "@/components/ui-primitives";
import { PageHeader } from "@/components/ui/page-header";
import { findSpecifier, specifierFamilies, specifierRecords } from "@/lib/specifiers";

export function SpecifierMapPage({ initialSlug }: { initialSlug?: string }) {
  return (
    <SpecifierMapNavHeader>
      <SpecifierMapPageContent initialSlug={initialSlug} />
    </SpecifierMapNavHeader>
  );
}

function SpecifierMapPageContent({ initialSlug }: { initialSlug?: string }) {
  const [selectedSlug, setSelectedSlug] = useState(findSpecifier(initialSlug ?? "")?.slug ?? specifierRecords[0].slug);
  const selected = findSpecifier(selectedSlug) ?? specifierRecords[0];
  const { activeId, selectSection } = useSpecifierMapNavigation();

  return (
    <SpecifierPageShell>
      <PageHeader
        className="border-b border-[color:var(--border)] pb-4 sm:pb-5"
        title="Find the right specifier"
        description="Choose a clinical role, then select a specifier."
      />

      <nav aria-label="Choose a specifier role">
        <ol className="grid gap-2.5 md:grid-cols-3">
          {specifierMapSteps.map((step, index) => {
            const active = activeId === step.id;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => selectSection(step.id)}
                  aria-current={active ? "true" : undefined}
                  data-testid={`specifier-map-jump-${step.id}`}
                  className={cn(
                    "group grid min-h-specifier-map-jump w-full grid-cols-[var(--spacing-specifier-map-step-number)_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3.5 py-3 text-left shadow-[var(--shadow-inset)] transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                    active
                      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)]",
                  )}
                >
                  <span
                    className={cn(
                      "nums grid h-9 w-9 place-items-center rounded-full text-sm font-extrabold",
                      active
                        ? "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                        : "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">{step.label}</span>
                    <span className="mt-1 block text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                      {step.description}
                    </span>
                  </span>
                  <ArrowDown
                    className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] transition group-hover:text-[color:var(--clinical-accent)] motion-reduce:transition-none"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_var(--spacing-specifier-map-aside)]">
        <section className="grid min-w-0 gap-4" aria-label="Specifier families">
          {specifierFamilies
            .filter((family) => family.id !== "all")
            .map((family) => {
              const records = specifierRecords.filter((record) => record.family === family.id);
              return (
                <section key={family.id} id={family.id} className={cn(specifierCard, inPageAnchor, "overflow-hidden")}>
                  <div className="flex items-center gap-2.5 border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-3">
                    <Waypoints className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                    <div>
                      <h2 className="text-base font-extrabold text-[color:var(--text-heading)]">{family.label}</h2>
                      <p className="nums mt-0.5 text-2xs font-semibold text-[color:var(--text-muted)]">
                        {records.length} options
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-px bg-[color:var(--border)] sm:grid-cols-2">
                    {records.map((record) => {
                      const active = selected.slug === record.slug;
                      return (
                        <button
                          key={record.slug}
                          type="button"
                          onClick={() => setSelectedSlug(record.slug)}
                          aria-pressed={active}
                          className={cn(
                            "group flex min-h-[4.5rem] w-full items-center gap-3 px-4 py-3 text-left transition motion-reduce:transition-none focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]",
                            active
                              ? "bg-[color:var(--clinical-accent-soft)]"
                              : "bg-[color:var(--surface)] hover:bg-[color:var(--surface-subtle)]",
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-9 w-9 shrink-0 place-items-center rounded-lg border",
                              active
                                ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                                : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--clinical-accent)]",
                            )}
                          >
                            <Tags className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">
                              {record.shortName}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                              {record.clinicalSignal}
                            </span>
                          </span>
                          {active ? (
                            <CheckCircle2
                              className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]"
                              aria-hidden
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
        </section>

        <aside aria-label="Selected specifier" className="grid content-start gap-4 xl:sticky xl:top-20">
          <section className="overflow-hidden rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] shadow-[var(--e2)]">
            <div className="border-b border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-4 py-3">
              <p className={cn(eyebrowText, "!text-[color:var(--clinical-accent)]")}>Selected specifier</p>
              <h2 className="mt-1 text-xl font-extrabold text-[color:var(--text-heading)]">{selected.shortName}</h2>
            </div>
            <div className="grid gap-4 p-4">
              <p className="text-sm font-medium leading-6 text-[color:var(--text-muted)]">{selected.summary}</p>
              <SpecifierFamilyBadge record={selected} />
              <DiagnosisChips values={selected.appliesTo} />
              <div className="border-t border-[color:var(--border)] pt-3">
                <p className={eyebrowText}>Deciding question</p>
                <p className="mt-1.5 text-sm font-semibold leading-6 text-[color:var(--text-heading)]">
                  {selected.decisionQuestion}
                </p>
              </div>
              <div className="grid gap-2">
                <Link href={`/specifiers/${selected.slug}`} className={cn(primaryControl)}>
                  Open full guide
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href={`/specifiers/compare?a=${selected.slug}`}
                  className="inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text)]"
                >
                  <GitCompareArrows className="h-4 w-4" aria-hidden />
                  Compare
                </Link>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <SpecifierSafetyNote />
    </SpecifierPageShell>
  );
}

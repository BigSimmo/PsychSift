"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, GitCompareArrows, Network, Waypoints } from "lucide-react";
import { useState } from "react";

import {
  FormulationPageShell,
  FormulationSafetyNote,
  MechanismDomainChips,
  formulationCard,
} from "@/components/formulation/formulation-ui";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { InformationPageHeader } from "@/components/information-page-shell";
import {
  findFormulationMechanismSummary,
  formulationDomainGroups,
  formulationMechanismIndex,
} from "@/lib/formulation-mechanism-index";

export function FormulationMapPage({ initialId }: { initialId?: string }) {
  const initial =
    findFormulationMechanismSummary(initialId ?? "") ??
    findFormulationMechanismSummary("rumination") ??
    formulationMechanismIndex[0];
  const [selectedId, setSelectedId] = useState(initial.id);
  const selected = findFormulationMechanismSummary(selectedId) ?? initial;

  return (
    <FormulationPageShell>
      <InformationPageHeader
        className="border-b border-[color:var(--border)] pb-5"
        eyebrow="Formulation architecture"
        title="Mechanism map"
        subtitle="Browse mechanisms by the part of the formulation they help explain. This map groups shared domains; it does not assert causation or replace a case-specific sequence."
      />

      <section
        aria-label="Formulation reasoning pathway"
        className="grid gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] p-3 sm:grid-cols-[minmax(9rem,1fr)_auto_minmax(9rem,1fr)_auto_minmax(9rem,1fr)_auto_minmax(9rem,1fr)] sm:items-center"
      >
        {["Pattern and context", "Meaning or threat", "Coping response", "Maintaining consequence"].map(
          (label, index) => (
            <div key={label} className="contents">
              <div className="flex min-h-12 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-extrabold text-[color:var(--text-heading)] shadow-[var(--shadow-inset)]">
                <span className="nums grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent)] text-xs text-[color:var(--clinical-accent-contrast)]">
                  {index + 1}
                </span>
                {label}
              </div>
              {index < 3 ? (
                <ArrowRight
                  className="hidden h-4 w-4 justify-self-center text-[color:var(--clinical-accent)] sm:block"
                  aria-hidden
                />
              ) : null}
            </div>
          ),
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="grid min-w-0 gap-4 md:grid-cols-2" aria-label="Mechanisms grouped by formulation domain">
          {formulationDomainGroups.map((group) => {
            const mechanisms = formulationMechanismIndex.filter((mechanism) =>
              mechanism.domains.some((domain) => group.domains.includes(domain as never)),
            );
            return (
              <div key={group.id} className={cn(formulationCard, "overflow-hidden")}>
                <div className="border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <Waypoints className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                    <div>
                      <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">{group.label}</h2>
                      <p className="mt-0.5 text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                        {group.description}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-2xs font-semibold text-[color:var(--text-muted)]">
                    {group.domains.map((domain) => (
                      <span key={domain}>{domain}</span>
                    ))}
                  </div>
                </div>
                <div className="grid divide-y divide-[color:var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                  {mechanisms.map((mechanism, index) => {
                    const active = selected.id === mechanism.id;
                    return (
                      <button
                        key={mechanism.id}
                        type="button"
                        onClick={() => setSelectedId(mechanism.id)}
                        aria-pressed={active}
                        className={cn(
                          "group flex min-h-[5.25rem] w-full items-center gap-3 border-b border-[color:var(--border)] px-4 py-3 text-left transition focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)] sm:[&:nth-child(even)]:border-l",
                          active
                            ? "bg-[color:var(--clinical-accent-soft)]"
                            : "bg-[color:var(--surface)] hover:bg-[color:var(--surface-subtle)]",
                          index >= mechanisms.length - 2 && "sm:border-b-0",
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
                          <Network className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">
                            {mechanism.name}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                            {mechanism.formulationUse}
                          </span>
                        </span>
                        {active ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <aside aria-label="Selected mechanism" className="grid content-start gap-4 xl:sticky xl:top-20">
          <section className="overflow-hidden rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] shadow-[var(--e2)]">
            <div className="border-b border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-4 py-3">
              <p className={cn(eyebrowText, "!text-[color:var(--clinical-accent)]")}>Selected mechanism</p>
              <h2 className="mt-1 text-xl font-extrabold text-[color:var(--text-heading)]">{selected.name}</h2>
            </div>
            <div className="grid gap-4 p-4">
              <p className="text-sm font-medium leading-6 text-[color:var(--text-muted)]">{selected.summary}</p>
              <MechanismDomainChips values={selected.domains} />
              <div className="border-t border-[color:var(--border)] pt-3">
                <p className={eyebrowText}>Core process</p>
                <p className="mt-1.5 text-sm font-semibold leading-6 text-[color:var(--text-heading)]">
                  {selected.coreProcess}
                </p>
              </div>
              <div className="border-t border-[color:var(--border)] pt-3">
                <p className={eyebrowText}>Maintaining cycle</p>
                <p className="mt-1.5 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                  {selected.maintainingCycles[0]}
                </p>
              </div>
              <div className="grid gap-2">
                <Link
                  href={`/formulation/${selected.id}`}
                  className="inline-flex min-h-tap items-center justify-center gap-2 rounded-lg bg-[color:var(--command)] px-3 text-sm font-semibold text-[color:var(--command-contrast)]"
                >
                  Open full guide
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href={`/formulation/compare?a=${selected.id}`}
                  className="inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text)]"
                >
                  <GitCompareArrows className="h-4 w-4" aria-hidden />
                  Compare
                </Link>
                <Link
                  href={`/formulation/builder?mechanism=${selected.id}`}
                  className="inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text)]"
                >
                  Use in formulation
                </Link>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <FormulationSafetyNote />
    </FormulationPageShell>
  );
}

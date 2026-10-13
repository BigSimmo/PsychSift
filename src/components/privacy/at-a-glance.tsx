"use client";

import { ArrowUpRight } from "lucide-react";

import { privacyToneText } from "@/components/privacy/tone";
import { cn, searchFocusRing } from "@/components/ui-primitives";
import { PRIVACY_AT_A_GLANCE, type PrivacySectionId } from "@/lib/privacy-page-content";

/**
 * The answer layer.
 *
 * Every fact here used to be reachable only by opening the right accordion
 * section and reading a paragraph — which is a poor trade for a reader who came
 * to the page with one question ("where does my question go?"). Each tile is a
 * real button rather than a static stat, so the summary layer doubles as the
 * navigation layer: read the fact, tap it, land on the prose that qualifies it.
 */
export function PrivacyAtAGlance({ onOpenSection }: { onOpenSection: (id: PrivacySectionId) => void }) {
  return (
    <section aria-labelledby="privacy-at-a-glance-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 id="privacy-at-a-glance-heading" className="text-xs font-semibold text-[color:var(--text-muted)]">
          At a glance
        </h2>
        <p className="text-3xs font-medium text-[color:var(--text-muted)]">Select a fact for the detail</p>
      </div>
      <ul
        data-testid="privacy-at-a-glance-grid"
        className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--border)] shadow-[var(--shadow-inset)] sm:grid-cols-2 lg:grid-cols-3"
      >
        {PRIVACY_AT_A_GLANCE.map((fact) => (
          <li
            key={fact.label}
            className="min-w-0 bg-[color:var(--surface-raised)] sm:last:col-span-2 lg:last:col-span-3"
          >
            <button
              type="button"
              onClick={() => onOpenSection(fact.sectionId)}
              data-print-keep
              className={cn(
                "group relative flex min-h-tap h-full w-full min-w-0 items-start gap-2.5 overflow-hidden bg-[color:var(--surface-raised)] px-3 py-3 text-left",
                "transition duration-[var(--duration-fast)] hover:bg-[color:var(--surface-subtle)] sm:px-4 sm:py-3.5",
                searchFocusRing,
                "focus-ring-contained",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-[color:var(--text-muted)]">{fact.label}</span>
                <span
                  className={cn(
                    "mt-1 block text-sm font-semibold leading-5 tracking-display",
                    fact.tone === "neutral" ? "text-[color:var(--text-heading)]" : privacyToneText[fact.tone],
                  )}
                >
                  {fact.value}
                </span>
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="mt-0.5 size-icon-xs shrink-0 text-[color:var(--decoration-soft)] transition-colors group-hover:text-[color:var(--clinical-accent)]"
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

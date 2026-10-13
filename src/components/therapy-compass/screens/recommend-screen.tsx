"use client";

import { useId } from "react";
import { Check, Copy, Search, Shield, Sparkles } from "lucide-react";

import { cardPadding, cardSurface } from "@/components/card-recipes";
import { PageHeader } from "@/components/ui/page-header";
import { cn, pageContainer } from "@/components/ui-primitives";
import { Button } from "@/components/ui/button";

import { useTcBindings } from "../bindings";
import { RECOMMEND_CONSTRAINTS } from "../data/select";
import { RecommendScenarioControl } from "../recommend-scenario-control";
import { RecommendScenarioFields } from "../recommend-scenario-fields";
import { CompactResultRow } from "../therapy-card";
import { EmptyState, LoadingState } from "../ui";
import { useClipboard } from "../use-clipboard";

export function RecommendScreen() {
  const b = useTcBindings();
  const { copied, copy } = useClipboard();
  const ranked = b.recommendations;
  const top = ranked[0];
  const desktopIdPrefix = useId();

  const copyShortlist = () =>
    copy(
      [
        "Recommendation shortlist",
        b.recQuery.trim() ? `Situation: ${b.recQuery.trim()}` : "",
        RECOMMEND_CONSTRAINTS.filter((c) => b.isConstraintActive(c.key)).length
          ? `Constraints: ${RECOMMEND_CONSTRAINTS.filter((c) => b.isConstraintActive(c.key))
              .map((c) => c.label)
              .join(", ")}`
          : "",
        "",
        ...ranked.map((r, i) => `${i + 1}. ${r.therapy.name}`),
      ]
        .filter(Boolean)
        .join("\n"),
      "shortlist",
    );

  const matchLabel = b.loading
    ? "Ranking clinical matches…"
    : `${ranked.length} ranked ${ranked.length === 1 ? "match" : "matches"}`;

  const scenarioBindings = {
    recQuery: b.recQuery,
    setRecQuery: b.setRecQuery,
    isConstraintActive: b.isConstraintActive,
    isConstraintInferred: b.isConstraintInferred,
    toggleConstraint: b.toggleConstraint,
  };

  return (
    <section data-screen-label="Recommend" className={pageContainer}>
      <PageHeader
        className="mb-5 sm:mb-6"
        title="Recommend"
        description="Rank catalogue therapies against a clinical scenario — advisory only."
      />

      <RecommendScenarioControl
        {...scenarioBindings}
        idPrefix="tc-mobile"
        loading={b.loading}
        matchCount={ranked.length}
      />

      <form
        data-therapy-recommend-composer
        className={cn(cardSurface, cardPadding.compact, "mb-6 hidden sm:mb-8 sm:block sm:p-4")}
        onSubmit={(event) => event.preventDefault()}
      >
        <RecommendScenarioFields {...scenarioBindings} idPrefix={desktopIdPrefix} />
      </form>

      {b.loading && !top ? (
        <LoadingState label="Ranking clinical matches…" />
      ) : !top ? (
        <EmptyState
          icon={Sparkles}
          title="No ranked matches"
          body="Add a presentation, setting or caution, or widen the constraints. Ranking stays inside the therapy catalogue."
        />
      ) : (
        <>
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base-minus font-semibold text-[color:var(--text-heading)]">
                Ranked clinical matches
              </div>
              <p className="mt-0.5 text-xs font-semibold text-[color:var(--text-muted)]" aria-live="polite">
                {matchLabel}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                icon={copied === "shortlist" ? Check : Copy}
                onClick={copyShortlist}
                disabled={!ranked.length}
              >
                {copied === "shortlist" ? "Copied" : "Copy shortlist"}
              </Button>
              <Button variant="secondary" icon={Search} onClick={b.goSearch}>
                Refine in catalogue
              </Button>
            </div>
          </div>
          {/* Compact ranked rows (Clinical audit, 13 Oct 2026, item 12), the
              same row Therapy search uses: one hairline card, the whole row
              opens the record, and Favourite, Compare and Sheet stay as small
              buttons. The Avoid / modify warning shows in full, never cut. */}
          <ol
            data-testid="therapy-recommend-list"
            className="m-0 list-none divide-y divide-[color:var(--border)] overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-0"
          >
            {ranked.map(({ therapy, reasons }, index) => (
              <CompactResultRow
                key={therapy.slug}
                therapy={therapy}
                rank={index + 1}
                featured={index === 0}
                query={b.recQuery}
                whyMatched={reasons.join(" · ") || undefined}
              />
            ))}
          </ol>

          <div className="mt-5 flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
            <Shield aria-hidden="true" className="size-icon-sm text-[color:var(--decoration-soft)]" />
            Ranking is source-grounded and advisory. Confirm fit, cautions and review status before clinical use.
          </div>
        </>
      )}
    </section>
  );
}

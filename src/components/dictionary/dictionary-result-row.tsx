import Link from "next/link";
import { ArrowRight, BookOpenText, CaseUpper, Check, GitCompareArrows, Layers3 } from "lucide-react";

import { stretchedRowLinkClass } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { dictionaryCompareHref, dictionaryKindLabel, type DictionarySearchHit } from "@/lib/dictionary";

// One group, one card: the rows sit inside a hairline card the page draws, so
// a row carries no card of its own and no coloured side bar. Colour is spent
// once per row, on the category tag, and only in the current area's tint, so
// it marks what kind of thing the row is without competing with the title.
const categoryTag =
  "rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-1.5 py-0.5 text-3xs font-extrabold text-[color:var(--clinical-accent)]";
const neutralTag =
  "rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1.5 py-0.5 text-3xs font-bold text-[color:var(--text-muted)]";

// Rows are divided by a hairline, never boxed. 48 px is the floor for a row
// that is itself a link target. `relative` is added at each row, where the
// stretched-link contract test can see it.
const rowShell =
  "flex min-h-12 min-w-0 items-start gap-3 border-b border-[color:var(--border)] px-3 py-3.5 last:border-b-0 sm:px-4 sm:py-4";

// The small area-tinted mark at the left of each row. Hidden at
// phone widths, where its 44 px is better spent on the definition and on
// keeping "Source linked" and "Add to compare" on one line.
const rowIcon =
  "mt-0.5 hidden size-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] sm:grid";

type TitleTag = "h2" | "h3";

export function DictionaryResultRow({
  hit,
  compareWith,
  titleAs: Title = "h2",
}: {
  hit: DictionarySearchHit;
  compareWith?: string;
  /** `h3` when the row sits under a group heading (a letter or a kind). */
  titleAs?: TitleTag;
}) {
  if (hit.type === "abbreviation") {
    const primary = hit.senses[0];
    return (
      <article className={cn("relative", rowShell)}>
        <span className={rowIcon} aria-hidden="true">
          <CaseUpper className="size-icon-sm" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Title className="text-base font-extrabold leading-5 text-[color:var(--text-heading)] sm:text-lg">
                  {hit.abbreviation}
                </Title>
                <span className={categoryTag}>Abbreviation</span>
                {hit.senses.length > 1 ? <span className={neutralTag}>{hit.senses.length} meanings</span> : null}
              </div>
              <p className="mt-1 text-sm font-semibold text-[color:var(--text)]">
                {hit.senses.map((entry) => entry.term).join(" · ")}
              </p>
              <p className="mt-1 text-sm leading-5 text-[color:var(--text-muted)]">
                {hit.senses.length > 1
                  ? "Choose the meaning that fits the clinical or service context."
                  : primary?.definition}
              </p>
            </div>
            {primary && hit.senses.length === 1 ? (
              <Link
                href={`/dictionary/${primary.slug}`}
                aria-label={`Open ${primary.term}`}
                className={cn(
                  "grid min-h-tap min-w-tap shrink-0 place-items-center rounded-lg text-[color:var(--clinical-accent)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10 sm:min-w-10",
                  stretchedRowLinkClass,
                )}
              >
                <ArrowRight className="size-icon-sm" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          <div className="mt-3 grid gap-2 border-t border-[color:var(--border)] pt-2.5">
            {hit.senses.map((entry) => (
              <div key={entry.slug} className="flex min-w-0 items-center gap-2">
                <Link
                  href={`/dictionary/${entry.slug}`}
                  className="relative z-10 min-h-tap min-w-0 flex-1 rounded-md py-2 text-sm font-bold text-[color:var(--clinical-accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10"
                >
                  {entry.term}
                  <span className="mt-0.5 block text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                    {dictionaryKindLabel(entry.kind)} · {entry.definition}
                  </span>
                </Link>
                <Link
                  href={dictionaryCompareHref([compareWith ?? "", entry.slug])}
                  aria-label={`Add ${entry.term} to comparison`}
                  className="relative z-10 inline-flex min-h-tap shrink-0 items-center gap-1 rounded-md px-2 text-2xs font-bold text-[color:var(--text-muted)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10"
                >
                  <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Add to compare</span>
                </Link>
              </div>
            ))}
          </div>
          <SourceLine label={hit.reason} />
        </div>
      </article>
    );
  }

  if (hit.type === "topic") {
    return (
      <article className={cn("relative", rowShell, "items-center")}>
        <span className={cn(rowIcon, "mt-0")} aria-hidden="true">
          <Layers3 className="size-icon-sm" aria-hidden="true" />
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Title className="text-base font-extrabold leading-5 text-[color:var(--text-heading)] sm:text-lg">
                {hit.topic.title}
              </Title>
              <span className={categoryTag}>Topic</span>
            </div>
            <p className="mt-1 text-sm leading-5 text-[color:var(--text-muted)]">{hit.topic.description}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--text-muted)]">
              <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
              {hit.topic.entrySlugs.length} governed terms
            </p>
          </div>
          <Link
            href={`/dictionary/topics/${hit.topic.slug}`}
            aria-label={`Open ${hit.topic.title}`}
            className={cn(
              "grid min-h-tap min-w-tap place-items-center rounded-lg text-[color:var(--clinical-accent)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10 sm:min-w-10",
              stretchedRowLinkClass,
            )}
          >
            <ArrowRight className="size-icon-sm" aria-hidden="true" />
          </Link>
        </div>
      </article>
    );
  }

  const { entry } = hit;
  return (
    <article className={cn("relative", rowShell)}>
      <span className={rowIcon} aria-hidden="true">
        <BookOpenText className="size-icon-sm" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Title className="text-base font-extrabold leading-5 text-[color:var(--text-heading)] sm:text-lg">
                {entry.term}
              </Title>
              <span className={categoryTag}>{dictionaryKindLabel(entry.kind)}</span>
            </div>
            {entry.aliases.length ? (
              <p className="mt-1 text-xs font-semibold text-[color:var(--text-muted)]">
                Also known as {entry.aliases.map((alias) => alias.value).join(" · ")}
              </p>
            ) : null}
            <p className="mt-1.5 text-sm leading-5 text-[color:var(--text)] sm:text-base-minus sm:leading-6">
              {entry.definition}
            </p>
          </div>
          <Link
            href={`/dictionary/${entry.slug}`}
            aria-label={`Open ${entry.term}`}
            className={cn(
              "grid min-h-tap min-w-tap shrink-0 place-items-center rounded-lg text-[color:var(--clinical-accent)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10 sm:min-w-10",
              stretchedRowLinkClass,
            )}
          >
            <ArrowRight className="size-icon-sm" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <SourceLine label={hit.reason} />
          <Link
            href={dictionaryCompareHref([compareWith ?? "", entry.slug])}
            className="relative z-10 inline-flex min-h-tap items-center gap-1 text-2xs font-bold text-[color:var(--text-muted)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-10"
          >
            <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
            Add to compare
          </Link>
        </div>
      </div>
    </article>
  );
}

function SourceLine({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs font-semibold text-[color:var(--text-muted)]">
      <span className="grid h-4 w-4 place-items-center rounded-full border border-[color:var(--success)] text-[color:var(--success)]">
        <Check className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden="true" />
      </span>
      Source linked<span aria-hidden="true">·</span>
      {label}
    </span>
  );
}

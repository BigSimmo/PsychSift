"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  GitCompareArrows,
  Info,
  Link2,
  ListChecks,
  Printer,
  Scale,
} from "lucide-react";

import { inPageActionRowClass } from "@/components/in-page-nav/in-page-nav-classes";
import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import { type PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";
import {
  InformationPageFooter,
  InformationPageHeader,
  InformationPageShell,
} from "@/components/information-page-shell";
import { cn } from "@/components/ui-primitives";
import {
  dictionaryEntrySources,
  dictionaryKindLabel,
  findDictionaryEntry,
  findDictionaryTopic,
} from "@/lib/dictionary";
import { type DictionaryEntry } from "@/lib/dictionary-data";

const sections = [
  { id: "dictionary-meaning", label: "Meaning", icon: Info },
  { id: "dictionary-context", label: "Use and context", icon: ListChecks },
  { id: "dictionary-distinctions", label: "Distinctions", icon: Scale },
  { id: "dictionary-sources", label: "Sources and review", icon: FileText },
  { id: "dictionary-related", label: "Related entries", icon: Link2 },
] as const satisfies readonly PageSection[];

/* Tailwind's `sm`: from here up every section's content is always shown. */
const sectionsAlwaysOpenQuery = "(min-width: 40rem)";

function subscribeSectionsAlwaysOpen(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(sectionsAlwaysOpenQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/**
 * True where the section toggles are inert. The content is `sm:block` there, so
 * a toggle still announcing "collapsed", and still flipping that state on Enter,
 * told desktop screen-reader users the visible text was hidden.
 */
function useSectionsAlwaysOpen(): boolean {
  return useSyncExternalStore(
    subscribeSectionsAlwaysOpen,
    () => typeof window.matchMedia === "function" && window.matchMedia(sectionsAlwaysOpenQuery).matches,
    () => false,
  );
}

export function DictionaryTermPage({ entry }: { entry: DictionaryEntry }) {
  const router = useRouter();
  const sectionNav = useInPageSectionNav(sections);
  const topic = findDictionaryTopic(entry.topicSlug);
  const sources = dictionaryEntrySources(entry);
  const abbreviation = entry.aliases.find((alias) => alias.kind === "abbreviation")?.value;
  const [openSections, setOpenSections] = useState(new Set(["dictionary-meaning"]));
  const toggleSection = (id: string) =>
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <InPageNavHeader
        back={{ href: "/dictionary/search", label: "Back to results" }}
        title={entry.term}
        sections={sectionNav.sections}
        activeId={sectionNav.activeId}
        onSelectSection={sectionNav.selectSection}
        primaryAction={{
          label: "Compare term",
          icon: GitCompareArrows,
          onClick: () => router.push(`/dictionary/compare?a=${entry.slug}`),
        }}
        actionsTitle="Entry actions"
        actionsDescription="Continue with this governed dictionary entry."
        actionsNoun="entry"
        testIdPrefix="dictionary-entry"
        actions={
          <div className="grid gap-1">
            <Link href={`/dictionary/compare?a=${entry.slug}`} className={inPageActionRowClass}>
              <GitCompareArrows className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
              Compare with another term
            </Link>
            <Link href="/dictionary/sources" className={inPageActionRowClass}>
              <FileText className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
              How source checking works
            </Link>
            <button type="button" onClick={() => window.print()} className={inPageActionRowClass}>
              <Printer className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
              Print entry
            </button>
          </div>
        }
      />

      <InformationPageShell width="bleed" gap={false} testId="dictionary-term-main">
        <div className="mx-auto grid w-full max-w-[78rem] lg:grid-cols-[minmax(0,1fr)_19rem]">
          {/* A `div`, not a `main`: `InformationPageShell` already renders the
              route's `<main>`, and a nested one is a duplicate landmark. */}
          <div className="min-w-0 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
            <InformationPageHeader
              eyebrow={`${dictionaryKindLabel(entry.kind)} · Australian terminology`}
              title={entry.term}
            />
            <div className="mt-4 grid grid-cols-[0.1875rem_minmax(0,1fr)] overflow-hidden rounded-r-lg border border-l-0 border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]/45">
              <span className="bg-[color:var(--clinical-accent)]" aria-hidden="true" />
              <div className="px-4 py-4 sm:px-5">
                <p className="text-xs font-extrabold text-[color:var(--text-heading)]">Definition</p>
                <p className="mt-1.5 text-base leading-7 text-[color:var(--text)] sm:text-lg sm:leading-8">
                  {entry.definition}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {topic ? (
                <Link
                  href={`/dictionary/topics/${topic.slug}`}
                  className="inline-flex min-h-tap items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 py-2 text-xs font-semibold text-[color:var(--clinical-accent)]"
                >
                  Topic: {topic.title}
                </Link>
              ) : null}
              {abbreviation ? (
                <span className="inline-flex min-h-8 items-center rounded-md border border-[color:var(--tone-purple-border)] bg-[color:var(--tone-purple-soft)] px-2.5 text-xs font-bold text-[color:var(--tone-purple)]">
                  Abbreviation: {abbreviation}
                </span>
              ) : null}
              {entry.aliases
                .filter((alias) => alias.kind !== "abbreviation")
                .slice(0, 1)
                .map((alias) => (
                  <span
                    key={alias.value}
                    className="inline-flex min-h-8 items-center rounded-md border border-[color:var(--border)] px-2.5 text-xs font-semibold text-[color:var(--text-muted)]"
                  >
                    Also known as {alias.value}
                  </span>
                ))}
            </div>
            <div
              data-testid="dictionary-source-status-summary"
              className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[color:var(--border)] pb-4 text-xs font-semibold text-[color:var(--text-muted)]"
            >
              <span className="inline-flex items-center gap-1.5 text-[color:var(--success)]">
                <span className="grid h-5 w-5 place-items-center rounded-full border border-current">
                  <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                </span>
                Source linked
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {sources.length} covered {sources.length === 1 ? "source" : "sources"}
              </span>
            </div>

            <div className="grid">
              <EntrySection
                id="dictionary-meaning"
                label="Meaning"
                icon={<Info className="size-icon-sm" aria-hidden="true" />}
                open={openSections.has("dictionary-meaning")}
                onToggle={() => toggleSection("dictionary-meaning")}
              >
                <p>{entry.meaning}</p>
                {entry.aliases.length ? (
                  <p className="mt-3 text-sm">
                    <strong>Also known as:</strong> {entry.aliases.map((alias) => alias.value).join(" · ")}
                  </p>
                ) : null}
              </EntrySection>
              <EntrySection
                id="dictionary-context"
                label="Use and context"
                icon={<ListChecks className="size-icon-sm" aria-hidden="true" />}
                open={openSections.has("dictionary-context")}
                onToggle={() => toggleSection("dictionary-context")}
                summary="Practical use, documentation and context"
              >
                <ul className="grid gap-3">
                  {entry.context.map((item) => (
                    <li key={item} className="grid grid-cols-[0.5rem_minmax(0,1fr)] gap-2">
                      <span
                        className="mt-2 h-1.5 w-1.5 rounded-full bg-[color:var(--clinical-accent)]"
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </EntrySection>
              <EntrySection
                id="dictionary-distinctions"
                label="Distinctions"
                icon={<Scale className="size-icon-sm" aria-hidden="true" />}
                open={openSections.has("dictionary-distinctions")}
                onToggle={() => toggleSection("dictionary-distinctions")}
                summary={
                  entry.distinctions.length
                    ? `${entry.distinctions.length} nearby terms are explicitly distinguished`
                    : "Related terms are not automatically synonyms"
                }
              >
                {entry.distinctions.length ? (
                  <div className="grid border-y border-[color:var(--border)]">
                    {entry.distinctions.map((distinction) => {
                      const related = findDictionaryEntry(distinction.slug);
                      return (
                        <Link
                          key={distinction.slug}
                          href={`/dictionary/${distinction.slug}`}
                          className="grid min-h-tap grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[color:var(--border)] py-3 last:border-b-0"
                        >
                          <span>
                            <strong className="block text-sm text-[color:var(--text-heading)]">
                              {related?.term ?? distinction.slug}
                            </strong>
                            <span className="mt-0.5 block text-sm leading-5 text-[color:var(--text-muted)]">
                              {distinction.summary}
                            </span>
                          </span>
                          <ArrowRight className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <p>
                    These related entries share a topic but may describe different kinds of finding, context or clinical
                    task. Open each definition before treating the terms as interchangeable.
                  </p>
                )}
              </EntrySection>
              <EntrySection
                id="dictionary-sources"
                label="Sources and review"
                icon={<FileText className="size-icon-sm" aria-hidden="true" />}
                open={openSections.has("dictionary-sources")}
                onToggle={() => toggleSection("dictionary-sources")}
                summary={`${sources.length} authoritative ${sources.length === 1 ? "source" : "sources"}; source checking is not clinical approval`}
              >
                <p>
                  Source checking confirms that the published wording is supported by the cited material. It does not
                  mean specialist clinical approval; new wording remains approval pending.
                </p>
                <ul className="mt-3 grid gap-2">
                  {sources.map((source) => (
                    <li key={source.id}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-tap items-center gap-2 text-sm font-semibold text-[color:var(--clinical-accent)] hover:underline sm:min-h-10"
                      >
                        {source.organisation}: {source.title}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              </EntrySection>
              <EntrySection
                id="dictionary-related"
                label="Related entries"
                icon={<BookOpen className="size-icon-sm" aria-hidden="true" />}
                open={openSections.has("dictionary-related")}
                onToggle={() => toggleSection("dictionary-related")}
                summary={`${entry.relatedSlugs.length} other entries from the same collection`}
              >
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {entry.relatedSlugs.map((slug) => {
                    const related = findDictionaryEntry(slug);
                    return related ? (
                      <Link
                        key={slug}
                        href={`/dictionary/${slug}`}
                        className="group grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
                      >
                        <span>
                          <strong className="block text-sm text-[color:var(--text-heading)] group-hover:text-[color:var(--clinical-accent)]">
                            {related.term}
                          </strong>
                          <span className="mt-1 block text-2xs text-[color:var(--text-muted)]">
                            {dictionaryKindLabel(related.kind)}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                      </Link>
                    ) : null;
                  })}
                </div>
              </EntrySection>
            </div>
          </div>

          <aside aria-label="Entry details" className="hidden border-l border-[color:var(--border)] px-6 py-7 lg:block">
            <h2 className="text-xs font-extrabold uppercase tracking-kicker text-[color:var(--text-muted)]">
              Entry details
            </h2>
            <dl className="mt-3 grid gap-3 text-sm">
              <RailDetail label="Entry type" value={dictionaryKindLabel(entry.kind)} />
              <RailDetail label="Topic" value={topic?.title ?? entry.topicSlug} />
              <RailDetail label="Region" value="Australian terminology" />
            </dl>
            <h2 className="mt-8 text-xs font-extrabold uppercase tracking-kicker text-[color:var(--text-muted)]">
              Covered sources
            </h2>
            <div className="mt-2 grid">
              {sources.map((source) => (
                <a
                  key={source.id}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="border-b border-[color:var(--border)] py-3 text-sm font-semibold text-[color:var(--clinical-accent)]"
                >
                  <span className="block">{source.organisation}</span>
                  <span className="mt-0.5 block text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                    {source.title}
                  </span>
                </a>
              ))}
            </div>
            <h2 className="mt-8 text-xs font-extrabold uppercase tracking-kicker text-[color:var(--text-muted)]">
              Review
            </h2>
            <dl className="mt-3 grid gap-3 text-sm">
              <RailDetail label="Checked on" value={entry.review.checkedOn} />
              <RailDetail label="Next source review" value={entry.review.dueOn} />
            </dl>
            <Link
              href="/dictionary/sources"
              className="mt-5 inline-flex min-h-tap items-center gap-1 text-sm font-semibold text-[color:var(--clinical-accent)] sm:min-h-10"
            >
              Review method
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </aside>
        </div>
        <InformationPageFooter>Reference terminology · Not patient-specific guidance</InformationPageFooter>
      </InformationPageShell>
    </>
  );
}

function EntrySection({
  id,
  label,
  icon,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const alwaysOpen = useSectionsAlwaysOpen();
  return (
    <section id={id} className="break-inside-avoid border-b border-[color:var(--border)] py-1 sm:py-5">
      <button
        type="button"
        onClick={alwaysOpen ? undefined : onToggle}
        // Out of the tab order where it cannot change anything, and reporting
        // the content as shown, because there it always is.
        tabIndex={alwaysOpen ? -1 : undefined}
        aria-expanded={open || alwaysOpen}
        aria-controls={`${id}-content`}
        className="grid min-h-tap w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 py-2 text-left sm:pointer-events-none sm:min-h-0 sm:py-0"
      >
        <span className="text-[color:var(--clinical-accent)]">{icon}</span>
        <span>
          <span className="block text-base font-extrabold text-[color:var(--text-heading)]">{label}</span>
          {summary ? (
            <span className="mt-0.5 block text-xs text-[color:var(--text-muted)] sm:hidden">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn("h-5 w-5 text-[color:var(--text-muted)] transition sm:hidden", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <div
        id={`${id}-content`}
        className={cn(
          "pb-4 pl-8 text-sm leading-6 text-[color:var(--text)] sm:block sm:pb-0 sm:pl-8 sm:pt-3 print:block print:pl-0",
          !open && "hidden sm:block",
        )}
      >
        {children}
      </div>
    </section>
  );
}

function RailDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[color:var(--border)] pb-2">
      <dt className="text-xs font-semibold text-[color:var(--text-muted)]">{label}</dt>
      <dd className="text-right text-xs font-bold text-[color:var(--text)]">{value}</dd>
    </div>
  );
}

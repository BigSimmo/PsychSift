"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  GitCompareArrows,
  Link2,
  Printer,
  Share2,
  Target,
  Users,
} from "lucide-react";

import {
  CompareCatalogPicker,
  CompareEmptyState,
  ComparePickerShell,
  CompareSlotStrip,
  assignCompareId,
  firstEmptySlot,
  padCompareIds,
  pairCompareHref,
  useComparePicker,
  type CompareSlot,
  type CompareStarterChip,
} from "@/components/compare";
import {
  InformationPageFooter,
  InformationPageHeader,
  InformationPageShell,
} from "@/components/information-page-shell";
import {
  dictionaryComparisonPair,
  dictionaryEntrySources,
  dictionaryKindLabel,
  findDictionaryEntry,
  searchDictionary,
  type DictionarySearchHit,
} from "@/lib/dictionary";
import { dictionarySource, type DictionaryEntry } from "@/lib/dictionary-data";

const COMPARE_PATH = "/dictionary/compare";

const STARTER_CHIPS: CompareStarterChip[] = [
  {
    id: "mse-mmse",
    label: "MSE vs MMSE",
    href: pairCompareHref(COMPARE_PATH, "mental-state-examination", "mini-mental-state-examination"),
  },
  {
    id: "delirium-dementia",
    label: "Delirium vs dementia",
    href: pairCompareHref(COMPARE_PATH, "delirium", "dementia"),
  },
  {
    id: "mood-affect",
    label: "Mood vs affect",
    href: pairCompareHref(COMPARE_PATH, "mood", "affect"),
  },
];

const comparisonSections = [
  { id: "meaning", label: "Meaning", icon: BookOpen },
  { id: "purpose", label: "Purpose and scope", icon: Target },
  { id: "context", label: "Clinical context", icon: Users },
  { id: "relationships", label: "Names and relationships", icon: Link2 },
  { id: "sources", label: "Sources", icon: FileText },
] as const;

export function DictionaryComparePage({ a, b }: { a: DictionaryEntry | null; b: DictionaryEntry | null }) {
  const router = useRouter();
  const picker = useComparePicker(!a || !b, a ? 1 : 0);
  const [shareStatus, setShareStatus] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const pair = a && b ? dictionaryComparisonPair(a.slug, b.slug) : null;
  const pairSources = (pair?.sourceRefs ?? []).flatMap((reference) => {
    const source = dictionarySource(reference.sourceId);
    return source ? [source] : [];
  });
  const catalogItems = useMemo(
    () =>
      searchDictionary({
        q: picker.query,
        view: "definitions",
        topics: [],
        kinds: [],
        sources: [],
        sort: picker.query ? "relevance" : "az",
      })
        .filter((hit): hit is Extract<DictionarySearchHit, { type: "entry" }> => hit.type === "entry")
        .slice(0, 12)
        .map((hit) => ({
          id: hit.entry.slug,
          title: hit.entry.term,
          snippet: hit.entry.definition,
          tag: dictionaryKindLabel(hit.entry.kind),
        })),
    [picker.query],
  );
  const slots: CompareSlot[] = [
    {
      id: a?.slug ?? null,
      label: "A",
      title: a ? shortName(a) : "Choose term",
      subtitle: a?.term ?? "Search the governed dictionary",
    },
    {
      id: b?.slug ?? null,
      label: "B",
      title: b ? shortName(b) : "Choose term",
      subtitle: b?.term ?? "Search the governed dictionary",
    },
  ];

  function pushPair(left: string | null, right: string | null) {
    router.push(pairCompareHref(COMPARE_PATH, left, right));
  }

  function choose(id: string) {
    const next = assignCompareId(padCompareIds([a?.slug, b?.slug], 2), picker.activeSlot, id);
    const entry = findDictionaryEntry(id);
    const label = picker.activeSlot === 0 ? "A" : "B";
    setAnnouncement(entry ? `${shortName(entry)} added as ${label}` : `${id} added as ${label}`);
    const empty = firstEmptySlot(next);
    if (empty === null) picker.close();
    else picker.setActiveSlot(empty);
    pushPair(next[0], next[1]);
  }

  return (
    <InformationPageShell width="bleed" gap={false} testId="dictionary-compare-main">
      <div className="mx-auto w-full max-w-[78rem] px-4 py-5 sm:px-6 sm:py-7">
        <InformationPageHeader
          className="border-b border-[color:var(--border)] pb-5"
          eyebrow="Dictionary comparison"
          title="Compare terms"
          actions={
            <div className="hidden flex-wrap gap-2 sm:flex">
              <button
                type="button"
                onClick={() => picker.openSlot(a ? 1 : 0)}
                className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border)] px-3 text-sm font-semibold sm:min-h-10"
              >
                <GitCompareArrows className="size-icon-sm" aria-hidden="true" />
                Change terms
              </button>
              {a && b ? (
                <Link
                  href={pairCompareHref(COMPARE_PATH, b.slug, a.slug)}
                  className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border)] px-3 text-sm font-semibold sm:min-h-10"
                >
                  Swap
                </Link>
              ) : null}
              {a || b ? (
                <Link
                  href={COMPARE_PATH}
                  className="inline-flex min-h-tap items-center rounded-lg border border-[color:var(--border)] px-3 text-sm font-semibold sm:min-h-10"
                >
                  Clear
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border)] px-3 text-sm font-semibold sm:min-h-10"
              >
                <Printer className="size-icon-sm" aria-hidden="true" />
                Print
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const canShare = typeof navigator.share === "function";
                    if (canShare) await navigator.share({ title: "Dictionary comparison", url: window.location.href });
                    else await navigator.clipboard.writeText(window.location.href);
                    setShareStatus(canShare ? "Share opened" : "Link copied");
                  } catch {
                    setShareStatus("Share cancelled");
                  }
                }}
                className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border)] px-3 text-sm font-semibold sm:min-h-10"
              >
                <Share2 className="size-icon-sm" aria-hidden="true" />
                Share
              </button>
              <span className="sr-only" aria-live="polite">
                {shareStatus}
              </span>
            </div>
          }
        />

        <CompareSlotStrip
          slots={slots}
          activeIndex={picker.open ? picker.activeSlot : null}
          onSelectSlot={picker.openSlot}
          swapHref={a && b ? pairCompareHref(COMPARE_PATH, b.slug, a.slug) : undefined}
          changeLabel="Change terms"
          onChange={() => picker.openSlot(a ? 1 : 0)}
        />

        <ComparePickerShell
          open={picker.open}
          onClose={picker.close}
          title="Change comparison"
          description="Choose two source-linked entries"
          phone={picker.phone}
          onDone={picker.close}
          onReset={() => pushPair(null, null)}
          id="dictionary-compare-picker"
          testId="dictionary-compare-picker"
        >
          <CompareCatalogPicker
            items={catalogItems}
            query={picker.query}
            onQueryChange={picker.setQuery}
            selectedIds={[a?.slug, b?.slug]}
            maxCount={2}
            activeSlot={picker.activeSlot}
            onActiveSlotChange={picker.setActiveSlot}
            onChoose={choose}
            onDone={picker.close}
            onReset={() => pushPair(null, null)}
            hideActions={picker.phone}
            searchPlaceholder="Search term or abbreviation"
            emptyHint="No matching terms."
            announcement={announcement}
            filterLocally={false}
            title="Choose two terms"
            titleId="dictionary-compare-picker-title"
            starters={STARTER_CHIPS}
          />
        </ComparePickerShell>

        {a && b ? (
          <div className="mt-5">
            <section
              aria-label="Comparison at a glance"
              className="grid gap-3 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]/35 p-4 sm:grid-cols-[9rem_1fr_1fr] sm:items-start"
            >
              <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">At a glance</h2>
              <p className="text-sm leading-5">
                <strong className="text-[color:var(--clinical-accent)]">A · {shortName(a)}</strong>
                <span className="mt-1 block">{a.comparison.purpose}.</span>
              </p>
              <p className="text-sm leading-5">
                <strong className="text-[color:var(--info)]">B · {shortName(b)}</strong>
                <span className="mt-1 block">{b.comparison.purpose}.</span>
              </p>
              <div className="sm:col-span-2 sm:col-start-2">
                <p className="text-xs font-semibold text-[color:var(--text-muted)]">
                  {pair?.summary ??
                    "No curated relationship summary is published for this pair; the stored fields below are aligned without interpretation."}
                </p>
                {pairSources.length ? (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--text-muted)]">
                    <span className="font-semibold">Relationship source{pairSources.length === 1 ? "" : "s"}:</span>
                    {pairSources.map((source) => (
                      <Link
                        key={source.id}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                      >
                        {source.title}
                      </Link>
                    ))}
                  </p>
                ) : null}
              </div>
            </section>

            <div className="mt-4 hidden sm:block">
              {comparisonSections.map((section) => (
                <DesktopComparisonSection key={section.id} section={section} a={a} b={b} />
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:hidden">
              {comparisonSections.map((section, index) => (
                <PhoneComparisonSection key={section.id} section={section} a={a} b={b} defaultOpen={index === 0} />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[color:var(--border)] pt-4 text-xs font-semibold text-[color:var(--text-muted)]">
              <span className="inline-flex items-center gap-1 text-[color:var(--success)]">
                <Check className="h-4 w-4" aria-hidden="true" />
                Both source linked
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {
                  new Set(
                    [...a.sourceRefs, ...b.sourceRefs, ...(pair?.sourceRefs ?? [])].map(
                      (reference) => reference.sourceId,
                    ),
                  ).size
                }{" "}
                covered sources
              </span>
            </div>
          </div>
        ) : (
          <CompareEmptyState
            icon={BookOpen}
            title={a || b ? "Choose the second term" : "Choose two terms"}
            description="Definitions stay separate and only stored catalogue fields are aligned."
            actionLabel="Choose terms"
            onAction={() => picker.openSlot(a ? 1 : 0)}
            chips={STARTER_CHIPS}
          />
        )}
      </div>
      <InformationPageFooter>
        Comparison aligns governed catalogue fields only · It does not create clinical guidance
      </InformationPageFooter>
    </InformationPageShell>
  );
}

function shortName(entry: DictionaryEntry) {
  return entry.aliases.find((alias) => alias.kind === "abbreviation")?.value ?? entry.term;
}

function sectionValue(sectionId: string, entry: DictionaryEntry) {
  if (sectionId === "meaning") return entry.meaning;
  if (sectionId === "purpose") return `${entry.comparison.purpose}. ${entry.comparison.scope}`;
  if (sectionId === "context") return entry.comparison.clinicalContext;
  if (sectionId === "relationships")
    return `${entry.aliases.map((alias) => alias.value).join(", ") || "No governed aliases"}. Related: ${entry.relatedSlugs.map((slug) => findDictionaryEntry(slug)?.term ?? slug).join(", ")}.`;
  return `${dictionaryEntrySources(entry).length} covered ${dictionaryEntrySources(entry).length === 1 ? "source" : "sources"}; source linked ${entry.review.checkedOn}.`;
}

function DesktopComparisonSection({
  section,
  a,
  b,
}: {
  section: (typeof comparisonSections)[number];
  a: DictionaryEntry;
  b: DictionaryEntry;
}) {
  const Icon = section.icon;
  return (
    <section className="grid grid-cols-[13rem_1fr_1fr] border-t border-[color:var(--border)] py-4">
      <h2 className="flex items-start gap-2 pr-4 text-base font-extrabold text-[color:var(--text-heading)]">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[color:var(--border)]">
          <Icon className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
        </span>
        {section.label}
      </h2>
      <p className="border-l border-[color:var(--border)] px-5 text-sm leading-6">
        <strong className="mb-1 block text-xs text-[color:var(--clinical-accent)]">A · {shortName(a)}</strong>
        {sectionValue(section.id, a)}
      </p>
      <p className="border-l border-[color:var(--border)] px-5 text-sm leading-6">
        <strong className="mb-1 block text-xs text-[color:var(--info)]">B · {shortName(b)}</strong>
        {sectionValue(section.id, b)}
      </p>
    </section>
  );
}

function PhoneComparisonSection({
  section,
  a,
  b,
  defaultOpen,
}: {
  section: (typeof comparisonSections)[number];
  a: DictionaryEntry;
  b: DictionaryEntry;
  defaultOpen: boolean;
}) {
  const Icon = section.icon;
  return (
    <details
      open={defaultOpen}
      className="source-print rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
    >
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold">
        <Icon className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
        <span className="flex-1">{section.label}</span>
        <ChevronDown className="h-4 w-4 text-[color:var(--text-muted)]" aria-hidden="true" />
      </summary>
      <div className="grid gap-3 border-t border-[color:var(--border)] p-3">
        <p className="border-l-2 border-[color:var(--clinical-accent)] pl-3 text-sm leading-5">
          <strong className="mb-1 block text-xs text-[color:var(--clinical-accent)]">A · {shortName(a)}</strong>
          {sectionValue(section.id, a)}
        </p>
        <p className="border-l-2 border-[color:var(--info)] pl-3 text-sm leading-5">
          <strong className="mb-1 block text-xs text-[color:var(--info)]">B · {shortName(b)}</strong>
          {sectionValue(section.id, b)}
        </p>
      </div>
    </details>
  );
}

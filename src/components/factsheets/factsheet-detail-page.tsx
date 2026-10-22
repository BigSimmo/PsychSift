"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  Clock,
  Globe,
  HeartHandshake,
  Printer,
  Share2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  categoryTheme,
  FACTSHEET_CRISIS_CONTACTS,
  FACTSHEET_DEMO_NOTICE,
  FACTSHEET_EMERGENCY_NUMBER,
  FACTSHEET_MEDLITE_URGENT_HELP,
  factsheetDetailHref,
  printBlocks,
  relatedFactsheets,
  sameTopicFactsheets,
  type Factsheet,
} from "@/components/factsheets/factsheets-data";
import { factsheetGlyph } from "@/components/factsheets/factsheets-icons";
import { FactsheetNavHeader, factsheetBodySectionId } from "@/components/factsheets/factsheet-nav-header";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { InformationPageHeader, InformationPageShell } from "@/components/information-page-shell";
import { cn, primaryControl, toneDanger, toneWarning } from "@/components/ui-primitives";
import {
  readSavedRegistrySlugs,
  savedFactsheetsStorageKey,
  subscribeSavedRegistrySlugs,
  writeSavedRegistrySlugs,
} from "@/lib/saved-registry-storage";

function accentBorder(accent: string) {
  return `color-mix(in srgb, ${accent} 35%, var(--surface))`;
}

const readingLevelOptions = [
  { value: "easy", label: "Easy read" },
  { value: "standard", label: "Standard" },
];

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-bold tracking-tight text-[color:var(--text-heading)]">{children}</h2>;
}

export function FactsheetDetailPage({ factsheet }: { factsheet: Factsheet }) {
  const theme = categoryTheme(factsheet.category);
  const [readingLevel, setReadingLevel] = useState<"easy" | "standard">("easy");
  const [saved, setSaved] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [copied, setCopied] = useState(false);
  // The print sheet is portaled to <body> so print can isolate it from the shell
  // chrome; the portal is client-only, gated behind a mount flag. useSyncExternalStore
  // is the lint-safe way to flip false→true on hydration without setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const related = relatedFactsheets(factsheet.slug);
  const moreInTopic = sameTopicFactsheets(factsheet.slug);
  const blocks = printBlocks(factsheet, readingLevel);

  useEffect(() => {
    const refresh = () => setSaved(readSavedRegistrySlugs(savedFactsheetsStorageKey).includes(factsheet.slug));
    refresh();
    return subscribeSavedRegistrySlugs(refresh);
  }, [factsheet.slug]);

  function toggleSaved() {
    const current = readSavedRegistrySlugs(savedFactsheetsStorageKey);
    const next = current.includes(factsheet.slug)
      ? current.filter((slug) => slug !== factsheet.slug)
      : [factsheet.slug, ...current];
    if (!writeSavedRegistrySlugs(savedFactsheetsStorageKey, next)) {
      setSaveNotice("Save failed. Check browser storage permissions and try again.");
      return;
    }
    const nowSaved = next.includes(factsheet.slug);
    setSaved(nowSaved);
    setSaveNotice(nowSaved ? "Factsheet saved." : "Factsheet removed from saved items.");
  }

  function downloadPdf() {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.add("factsheets-printing");
    const cleanup = () => root.classList.remove("factsheets-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <InformationPageShell testId="factsheet-detail-page" width="bleed" className="factsheet-screen">
        {/* Section index, disclosure and segment track now come from the sibling
            that owns the table. Reading level stays a page-level view mode
            rather than an action, so it rides the `mode` slot and stays out of
            the row reserved for verbs. */}
        <FactsheetNavHeader
          factsheet={factsheet}
          readingLevel={readingLevel}
          readingLevelOptions={readingLevelOptions}
          onReadingLevelChange={(value) => setReadingLevel(value === "standard" ? "standard" : "easy")}
          onDownload={downloadPdf}
          actions={() => (
            // Deliberately does not close the sheet: saving is a state change
            // you want to see reflected on the control you just pressed. The
            // live region lives here too — `Sheet` makes the page subtree inert,
            // so a background status would never reach assistive technology while
            // the modal is open (including the denied-storage failure path).
            <>
              <button
                type="button"
                onClick={toggleSaved}
                aria-pressed={saved}
                className={cn(
                  "flex min-h-tap w-full items-center gap-2.5 rounded-lg border px-3 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                  saved
                    ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text)] hover:border-[color:var(--border-strong)]",
                )}
              >
                <Bookmark className="h-4 w-4 shrink-0" aria-hidden="true" fill={saved ? "currentColor" : "none"} />
                {saved ? "Saved" : "Save"}
              </button>
              <span aria-live="polite" className="sr-only">
                {saveNotice}
              </span>
            </>
          )}
        />

        <div className="mx-auto grid max-w-reading gap-8 px-4 py-6 pb-4 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_16.5rem] lg:items-start lg:px-8">
          <article className="min-w-0">
            {/* hero band */}
            <div className="rounded-2xl border border-[color:var(--border)] p-6" style={{ background: theme.hero }}>
              <InformationPageHeader
                eyebrow={factsheet.category}
                title={factsheet.brand ? `${factsheet.title} ${factsheet.brand}` : factsheet.title}
                subtitle={factsheet.summary}
                badges={
                  <>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--text-muted)]">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      Updated {factsheet.reviewedOn}
                    </span>
                    <span className="text-xs font-semibold text-[color:var(--text-muted)]">{factsheet.readTime}</span>
                  </>
                }
              />
            </div>

            {/* kind-specific body */}
            <div className="mt-6">
              <FactsheetBody factsheet={factsheet} readingLevel={readingLevel} theme={theme} />
            </div>

            {/* sources */}
            <section id="factsheet-sources" className={cn(inPageAnchor, "mt-7")}>
              <Heading>Where this information comes from</Heading>
              <div className="mt-3 grid gap-2">
                {factsheet.sources.map((source) => {
                  const rowClass =
                    "flex items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3.5 py-3";
                  const inner = (
                    <>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] font-mono text-xs font-bold text-[color:var(--text-muted)]">
                        {source.n}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-[color:var(--text-heading)]">{source.title}</p>
                        <p className="text-xs text-[color:var(--text-muted)]">
                          {source.org} · {source.year}
                        </p>
                      </div>
                      <span className="rounded-md bg-[color:var(--surface-inset)] px-2 py-0.5 text-2xs font-bold text-[color:var(--text-muted)]">
                        {source.tag}
                      </span>
                      {/* Only advertise an outbound link when a verifiable URL exists. */}
                      {source.url ? (
                        <ArrowUpRight
                          className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)]"
                          aria-hidden="true"
                        />
                      ) : null}
                    </>
                  );
                  return source.url ? (
                    <a
                      key={source.n}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        rowClass,
                        "transition hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                      )}
                    >
                      {inner}
                    </a>
                  ) : (
                    <div key={source.n} className={rowClass}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* official translated information */}
            {factsheet.translatedResources?.length ? (
              <section id="factsheet-translated" className={cn(inPageAnchor, "mt-7")}>
                <Heading>Official translated information</Heading>
                <p className={cn("mt-1 text-xs leading-5", "text-[color:var(--text-muted)]")}>
                  Official translated information, published by the organisation named in each link — we never translate
                  anything ourselves.
                </p>
                <div className="mt-3 grid gap-2">
                  {factsheet.translatedResources.map((resource) => (
                    <a
                      key={resource.url}
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3.5 py-3 transition hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]">
                        <Globe className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-[color:var(--text-heading)]">{resource.title}</p>
                        <p className="text-xs text-[color:var(--text-muted)]">{resource.language}</p>
                      </div>
                      <ArrowUpRight
                        className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)]"
                        aria-hidden="true"
                      />
                    </a>
                  ))}
                </div>
              </section>
            ) : null}

            {/* more in topic */}
            {moreInTopic.length ? (
              <section
                id="factsheet-more-in-topic"
                className={cn(inPageAnchor, "mt-7 border-t border-[color:var(--border)] pt-6")}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Heading>More in {factsheet.category}</Heading>
                  <Link
                    href={`/factsheets/search?category=${encodeURIComponent(factsheet.category)}`}
                    className="inline-flex min-h-tap shrink-0 items-center text-sm font-semibold text-[color:var(--clinical-accent)] transition hover:text-[color:var(--clinical-accent-hover)]"
                  >
                    See all
                  </Link>
                </div>
                {/* minmax(0,1fr): an auto grid track grew to the cards' min-content
                    width and pushed them 33px past a 320px screen. */}
                <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
                  {moreInTopic.map((sheet) => {
                    const sheetTheme = categoryTheme(sheet.category);
                    return (
                      <Link
                        key={sheet.slug}
                        href={factsheetDetailHref(sheet.slug)}
                        className="group flex items-center gap-3.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 py-3 transition hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                      >
                        <span
                          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
                          style={{ backgroundColor: sheetTheme.soft, color: sheetTheme.accent }}
                        >
                          {factsheetGlyph(sheet.icon, "h-5 w-5")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-[color:var(--text-heading)] group-hover:text-[color:var(--clinical-accent)]">
                            {sheet.title}
                          </span>
                          <span className="line-clamp-2 text-xs text-[color:var(--text-muted)]">{sheet.summary}</span>
                          {/* On a phone the read time sits under the summary, so it
                              does not take width from the title. */}
                          <span className="mt-0.5 block text-2xs font-bold text-[color:var(--text-muted)] sm:hidden">
                            {sheet.readTime}
                          </span>
                        </span>
                        <span className="hidden shrink-0 text-xs font-bold text-[color:var(--text-muted)] sm:inline">
                          {sheet.readTime}
                        </span>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] transition group-hover:text-[color:var(--clinical-accent)]"
                          aria-hidden="true"
                        />
                      </Link>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {/* related */}
            <section
              id="factsheet-related"
              className={cn(inPageAnchor, "mt-7 border-t border-[color:var(--border)] pt-6")}
            >
              <Heading>Related sheets</Heading>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((sheet) => {
                  const sheetTheme = categoryTheme(sheet.category);
                  return (
                    <Link
                      key={sheet.slug}
                      href={factsheetDetailHref(sheet.slug)}
                      className="group flex items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3.5 transition hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                    >
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                        style={{ backgroundColor: sheetTheme.soft, color: sheetTheme.accent }}
                      >
                        {factsheetGlyph(sheet.icon, "h-5 w-5")}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-[color:var(--text-heading)] group-hover:text-[color:var(--clinical-accent)]">
                          {sheet.title}
                        </span>
                        <span className="block text-xs text-[color:var(--text-muted)]">{sheet.category}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>

            <div className="mt-6 border-t border-[color:var(--border)] pt-3.5">
              <p className="text-xs font-bold text-[color:var(--warning)]">{FACTSHEET_DEMO_NOTICE}</p>
              <p className="mt-1.5 text-xs leading-5 text-[color:var(--text-muted)]">
                This sheet is general information, not personal medical advice. Always follow the instructions from your
                own doctor or pharmacist.
              </p>
            </div>
          </article>

          {/* sidebar */}
          {/* Clears the shell header and the page's own sticky header. `lg:top-4`
              alone pinned it under both, and the header out-paints it at `z-30`
              regardless of DOM order. `--inpage-sticky-header-height` is the
              header's live measured height, published by `useInPageChromeMetrics`,
              so this self-corrects for the ~10px the reading-level control adds
              on `medRich` sheets instead of hard-coding either case. */}
          <aside className="grid gap-0 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)] lg:sticky lg:top-[calc(var(--shell-header-h)+var(--inpage-sticky-header-height,4.75rem)+1rem)]">
            <div className="p-4">
              <p className="text-2xs font-bold uppercase tracking-label text-[color:var(--text-muted)]">For</p>
              <p className="mt-1 text-sm font-bold text-[color:var(--text-heading)]">{factsheet.audience}</p>
            </div>
            <div className="border-t border-[color:var(--border)] p-4">
              <p className="text-2xs font-bold uppercase tracking-label text-[color:var(--text-muted)]">Last updated</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-[color:var(--text-heading)]">
                <Clock className="h-3.5 w-3.5 text-[color:var(--text-muted)]" aria-hidden="true" />
                {factsheet.reviewedOn}
              </p>
            </div>
            {/* "On this page" used to live here as a plain `<li>` list built by
                `tocFor` — display strings with no anchors behind them, so it
                read as a table of contents and navigated nowhere. The header's
                section disclosure now owns that job at every width, with the
                labels derived from what this sheet actually renders, so a second
                inert copy would be the same decoration twice. */}
            <div className="grid gap-2 border-t border-[color:var(--border)] p-4">
              <button type="button" onClick={copyLink} className={cn(primaryControl, "px-3 shadow-[var(--e0)]")}>
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? "Link copied" : "Share sheet"}
              </button>
              <button
                type="button"
                onClick={downloadPdf}
                className="inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text)] transition hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
                Print
              </button>
              <span aria-live="polite" className="sr-only">
                {copied ? "Link copied to clipboard" : ""}
              </span>
            </div>
          </aside>
        </div>
      </InformationPageShell>

      {/* Print-only clean A4 sheet, portaled to <body> so print can remove every
          other body subtree from layout flow (see globals.css factsheets-printing
          rules) — otherwise the hidden shell chrome paginates into blank pages. */}
      {mounted
        ? createPortal(
            <div className="factsheet-print-portal">
              <FactsheetPrintSheet factsheet={factsheet} blocks={blocks} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** "You're not alone" crisis-contact callout shared by the condition and therapy bodies. */
function FactsheetSupportCallout({
  as: Tag,
  support,
  theme,
}: {
  as: "div" | "section";
  support?: string;
  theme: ReturnType<typeof categoryTheme>;
}) {
  return (
    <Tag
      id="factsheet-support"
      className={cn(inPageAnchor, "flex gap-3.5 rounded-2xl border p-5")}
      style={{ backgroundColor: theme.soft, borderColor: accentBorder(theme.accent) }}
    >
      <span
        className="grid h-tap w-tap shrink-0 place-items-center rounded-xl text-[color:var(--clinical-accent-contrast)]"
        style={{ backgroundColor: theme.accent }}
      >
        <HeartHandshake className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-base font-bold text-[color:var(--text-heading)]">You’re not alone</p>
        <p className="mt-1.5 max-w-[60ch] text-pretty text-sm leading-6 text-[color:var(--text)]">
          {/* Numbers come from the shared constant, not a second copy:
              the printed handout builds its crisis line from the same
              source, so the two cannot drift into different advice. */}
          {support ? `${support} ` : ""}In Australia you can call{" "}
          {FACTSHEET_CRISIS_CONTACTS.map((contact, index) => (
            <span key={contact.number}>
              <strong className="font-bold">
                {contact.name} {contact.number}
              </strong>
              {index < FACTSHEET_CRISIS_CONTACTS.length - 1 ? ", " : ", or "}
            </span>
          ))}
          <strong className="font-mono">{FACTSHEET_EMERGENCY_NUMBER}</strong> in an emergency.
        </p>
      </div>
    </Tag>
  );
}

function FactsheetBody({
  factsheet,
  readingLevel,
  theme,
}: {
  factsheet: Factsheet;
  readingLevel: "easy" | "standard";
  theme: ReturnType<typeof categoryTheme>;
}) {
  switch (factsheet.kind) {
    case "medRich":
      return (
        <div className="flex flex-col gap-6">
          <div
            id="factsheet-at-a-glance"
            className={cn(inPageAnchor, "rounded-2xl border p-5")}
            style={{ backgroundColor: theme.soft, borderColor: accentBorder(theme.accent) }}
          >
            <p className="text-2xs font-bold uppercase tracking-label" style={{ color: theme.accent }}>
              At a glance
            </p>
            <div className="mt-3.5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
              {factsheet.keyFacts.map((fact) => (
                <div key={fact.k} className="flex flex-col gap-0.5">
                  <span className="text-xs text-[color:var(--text-muted)]">{fact.k}</span>
                  <span className="text-base-minus font-bold text-[color:var(--text-heading)]">{fact.v}</span>
                </div>
              ))}
            </div>
          </div>
          <section id="factsheet-what" className={inPageAnchor}>
            <Heading>What is {factsheet.title.toLowerCase()}?</Heading>
            <p className="mt-2 max-w-[66ch] text-pretty text-base leading-7 text-[color:var(--text)]">
              {readingLevel === "easy" ? factsheet.whatEasy : factsheet.whatStandard}
            </p>
          </section>
          <section id="factsheet-howto" className={inPageAnchor}>
            <Heading>How to take it</Heading>
            <div className="mt-3 flex flex-col gap-3">
              {factsheet.howto.map((step) => (
                <div key={step.n} className="flex items-start gap-3.5">
                  <span
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-inset)] font-mono text-xs font-bold"
                    style={{ color: theme.accent }}
                  >
                    {step.n}
                  </span>
                  <span className="max-w-[64ch] text-pretty text-base-minus leading-6 text-[color:var(--text)]">
                    {step.t}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section id="factsheet-side-effects" className={inPageAnchor}>
            <Heading>Side effects</Heading>
            <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[color:var(--warning)]" aria-hidden="true" />
                  <span className="text-sm font-bold text-[color:var(--text-heading)]">
                    Common — often ease in weeks
                  </span>
                </div>
                <ul className="grid gap-2">
                  {factsheet.sideCommon.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm leading-5 text-[color:var(--text)]">
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--decoration-soft)]"
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={cn("rounded-2xl border p-4", toneDanger)}>
                <div className="mb-3 flex items-center gap-2">
                  <TriangleAlert className="h-4 w-4 shrink-0 text-[color:var(--danger)]" aria-hidden="true" />
                  <span className="text-sm font-bold text-[color:var(--danger)]">Serious — tell your doctor</span>
                </div>
                <ul className="grid gap-2">
                  {factsheet.sideSerious.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm leading-5 text-[color:var(--danger)]">
                      <span
                        className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--danger)]"
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
          <div
            id="factsheet-urgent"
            className={cn(
              inPageAnchor,
              "flex gap-3.5 rounded-2xl border border-[color:var(--danger-border)] bg-[color:var(--surface)] p-5",
            )}
          >
            <span className="grid h-tap w-tap shrink-0 place-items-center rounded-xl bg-[color:var(--danger-solid)] text-[color:var(--danger-solid-contrast)]">
              <Zap className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-base font-bold text-[color:var(--danger)]">When to get urgent help</p>
              <p className="mt-1.5 max-w-[60ch] text-pretty text-sm leading-6 text-[color:var(--text)]">
                {factsheet.urgentHelp}
              </p>
            </div>
          </div>
        </div>
      );
    case "medLite":
      return (
        <div className="flex flex-col gap-5">
          <div
            id="factsheet-timing"
            className={cn(inPageAnchor, "flex gap-3.5 rounded-2xl border p-4")}
            style={{ backgroundColor: theme.soft, borderColor: accentBorder(theme.accent) }}
          >
            <Clock className="mt-0.5 h-5 w-5 shrink-0" style={{ color: theme.accent }} aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-[color:var(--text-heading)]">How long it takes</p>
              <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">{factsheet.timing}</p>
            </div>
          </div>
          {factsheet.sections.map((section, index) => (
            <section
              key={section.heading}
              id={factsheetBodySectionId(index)}
              className={cn(inPageAnchor, "border-l-[3px] pl-4")}
              style={{ borderColor: theme.accent }}
            >
              <h2 className="text-lg-minus font-bold text-[color:var(--text-heading)]">{section.heading}</h2>
              <p className="mt-1.5 max-w-[64ch] text-pretty text-base-minus leading-7 text-[color:var(--text)]">
                {section.body}
              </p>
            </section>
          ))}
          {/* medLite has no `urgentHelp` field, but both medicine-overview
              sheets name emergency-grade symptoms. Mirrors the medRich urgent
              block so a reader on either sheet gets the same route out. */}
          <div
            id="factsheet-urgent"
            className={cn(
              inPageAnchor,
              "flex gap-3.5 rounded-2xl border border-[color:var(--danger-border)] bg-[color:var(--surface)] p-5",
            )}
          >
            <span className="grid h-tap w-tap shrink-0 place-items-center rounded-xl bg-[color:var(--danger-solid)] text-[color:var(--danger-solid-contrast)]">
              <TriangleAlert className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-base font-bold text-[color:var(--danger)]">When to get urgent help</p>
              <p className="mt-1.5 max-w-[60ch] text-pretty text-sm leading-6 text-[color:var(--text)]">
                {FACTSHEET_MEDLITE_URGENT_HELP}
              </p>
            </div>
          </div>
        </div>
      );
    case "condition":
      return (
        <div className="flex flex-col gap-6">
          <section id="factsheet-plain-terms" className={inPageAnchor}>
            <Heading>In plain terms</Heading>
            <p className="mt-2 max-w-[66ch] text-pretty text-base leading-7 text-[color:var(--text)]">
              {factsheet.intro}
            </p>
          </section>
          <section id="factsheet-signs" className={inPageAnchor}>
            <Heading>Signs to look for</Heading>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {factsheet.signs.map((sign) => (
                <div
                  key={sign}
                  className="flex items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 py-3"
                >
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
                    style={{ backgroundColor: theme.soft, color: theme.accent }}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-sm leading-5 text-[color:var(--text)]">{sign}</span>
                </div>
              ))}
            </div>
          </section>
          <section id="factsheet-why" className={inPageAnchor}>
            <Heading>Why it happens</Heading>
            <p className="mt-2 max-w-[66ch] text-pretty text-base leading-7 text-[color:var(--text)]">
              {factsheet.why}
            </p>
          </section>
          <section id="factsheet-helps" className={inPageAnchor}>
            <Heading>What helps</Heading>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {factsheet.helps.map((help) => (
                <div
                  key={help.title}
                  className="flex flex-col gap-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
                >
                  <span
                    className="grid h-10 w-10 place-items-center rounded-lg"
                    style={{ backgroundColor: theme.soft, color: theme.accent }}
                  >
                    {factsheetGlyph(help.icon, "h-5 w-5")}
                  </span>
                  <p className="text-sm font-bold text-[color:var(--text-heading)]">{help.title}</p>
                  <p className="text-pretty text-xs leading-5 text-[color:var(--text-muted)]">{help.body}</p>
                </div>
              ))}
            </div>
          </section>
          <FactsheetSupportCallout as="div" support={factsheet.support} theme={theme} />
        </div>
      );
    case "therapy":
      return (
        <div className="flex flex-col gap-6">
          <section id="factsheet-what-it-is" className={inPageAnchor}>
            <Heading>What it is</Heading>
            <p className="mt-2 max-w-[66ch] text-pretty text-base leading-7 text-[color:var(--text)]">
              {factsheet.intro}
            </p>
          </section>
          <section id="factsheet-how-it-works" className={inPageAnchor}>
            <Heading>How it works</Heading>
            <div className="mt-3.5">
              {factsheet.steps.map((step, index) => (
                <div key={step.n} className="flex gap-3.5">
                  <div className="flex flex-col items-center">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-sm font-bold"
                      style={{ backgroundColor: theme.soft, color: theme.accent }}
                    >
                      {step.n}
                    </span>
                    {index < factsheet.steps.length - 1 ? (
                      <span className="my-1 w-0.5 flex-1 bg-[color:var(--border)]" aria-hidden="true" />
                    ) : null}
                  </div>
                  <div className="pb-5">
                    <p className="text-base-minus font-bold text-[color:var(--text-heading)]">{step.h}</p>
                    <p className="mt-1 max-w-[60ch] text-pretty text-sm leading-6 text-[color:var(--text-muted)]">
                      {step.t}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section id="factsheet-what-to-expect" className={inPageAnchor}>
            <Heading>What to expect</Heading>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {factsheet.expect.map((item) => (
                <div
                  key={item.k}
                  className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3.5"
                >
                  <p className="text-xs text-[color:var(--text-muted)]">{item.k}</p>
                  <p className="mt-1 text-base-minus font-bold text-[color:var(--text-heading)]">{item.v}</p>
                </div>
              ))}
            </div>
          </section>
          <FactsheetSupportCallout as="section" support={factsheet.support} theme={theme} />
        </div>
      );
    case "procedure":
      return (
        <div className="flex flex-col gap-6">
          <section id="factsheet-why-it-matters" className={inPageAnchor}>
            <Heading>Why it matters</Heading>
            <p className="mt-2 max-w-[66ch] text-pretty text-base leading-7 text-[color:var(--text)]">
              {factsheet.why}
            </p>
          </section>
          <section id="factsheet-prepare" className={inPageAnchor}>
            <Heading>How to prepare</Heading>
            <div className="mt-3 flex flex-col gap-2.5">
              {factsheet.prepare.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 py-3"
                >
                  <span
                    className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-[1.5px]"
                    style={{ borderColor: theme.accent, color: theme.accent }}
                  >
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                  <span className="text-sm leading-6 text-[color:var(--text)]">{item}</span>
                </div>
              ))}
            </div>
          </section>
          <section id="factsheet-timeline" className={inPageAnchor}>
            <Heading>Step by step</Heading>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {factsheet.timeline.map((step) => (
                <div
                  key={step.t}
                  className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
                >
                  <p className="text-2xs font-bold uppercase tracking-label" style={{ color: theme.accent }}>
                    {step.t}
                  </p>
                  <p className="mt-2 text-pretty text-sm leading-6 text-[color:var(--text)]">{step.d}</p>
                </div>
              ))}
            </div>
          </section>
          {/* The act-now list sits above the prose callout, and in the danger
              tone rather than warning: it is the one thing on a monitoring
              sheet a reader must be able to find by scanning. Matches the
              medRich "Serious — tell your doctor" list idiom. */}
          {factsheet.warningSigns ? (
            <div id="factsheet-warning-signs" className={cn(inPageAnchor, "rounded-2xl border p-5", toneDanger)}>
              <div className="mb-3 flex items-center gap-2">
                <TriangleAlert className="h-4 w-4 shrink-0 text-[color:var(--danger)]" aria-hidden="true" />
                <span className="text-sm font-bold text-[color:var(--danger)]">{factsheet.warningSigns.heading}</span>
              </div>
              <ul className="grid gap-2">
                {factsheet.warningSigns.items.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm leading-5 text-[color:var(--danger)]">
                    <span
                      className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--danger)]"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div
            id="factsheet-staying-safe"
            className={cn(inPageAnchor, "flex gap-3.5 rounded-2xl border p-5", toneWarning)}
          >
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--warning)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-[color:var(--warning)]">Staying safe between tests</p>
              <p className="mt-1.5 max-w-[60ch] text-pretty text-sm leading-6 text-[color:var(--text)]">
                {factsheet.safe}
              </p>
            </div>
          </div>
        </div>
      );
  }
}

function FactsheetPrintSheet({ factsheet, blocks }: { factsheet: Factsheet; blocks: ReturnType<typeof printBlocks> }) {
  return (
    /* Colours here are deliberate LIGHT-theme literals, not tokens: the print
       stylesheet forces a white ground but does NOT force light token values,
       so var(--danger-text) would print the dark-theme colour for a reader in
       dark mode. Keep these pinned to the light values in globals.css. */
    <div
      className="factsheet-print-sheet"
      style={{ maxWidth: "720px", margin: "0 auto", padding: "8px", color: "#111", fontFamily: "var(--font-sans)" }}
    >
      <div
        style={{
          border: "1.5px solid #a3190f",
          background: "#fef3f2",
          color: "#a3190f",
          fontSize: "12px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          padding: "6px 10px",
          borderRadius: "6px",
          marginBottom: "12px",
        }}
      >
        Sample — not for clinical use
      </div>
      <div style={{ borderBottom: "2px solid var(--clinical-accent)", paddingBottom: "12px", marginBottom: "18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--clinical-accent)",
            }}
          >
            {factsheet.category} · Patient information
          </span>
          <span style={{ fontSize: "12px", color: "#555" }}>
            Updated {factsheet.reviewedOn} · {factsheet.readTime}
          </span>
        </div>
        <h1 style={{ margin: "10px 0 6px", fontSize: "26px", fontWeight: 700, color: "#111" }}>
          {factsheet.title}
          {factsheet.brand ? <span style={{ color: "#555", fontWeight: 500 }}> {factsheet.brand}</span> : null}
        </h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.55, color: "#333" }}>{factsheet.summary}</p>
      </div>
      {blocks.map((block, index) => (
        <div key={`${block.heading}-${index}`} style={{ marginBottom: "16px", breakInside: "avoid" }}>
          {block.kind === "prose" ? (
            <>
              <h2 style={{ margin: "0 0 5px", fontSize: "16px", fontWeight: 700, color: "#111" }}>{block.heading}</h2>
              <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.6, color: "#222" }}>{block.body}</p>
            </>
          ) : null}
          {block.kind === "list" ? (
            <>
              <h2 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700, color: "#111" }}>{block.heading}</h2>
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {block.items.map((item, itemIndex) => (
                  <li
                    key={itemIndex}
                    style={{ fontSize: "13.5px", lineHeight: 1.5, color: "#222", marginBottom: "3px" }}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {block.kind === "facts" ? (
            <>
              <h2 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700, color: "#111" }}>{block.heading}</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <tbody>
                  {block.items.map((fact) => (
                    <tr key={fact.k}>
                      <th
                        scope="row"
                        style={{
                          padding: "5px 8px",
                          border: "1px solid #ddd",
                          color: "#555",
                          width: "40%",
                          textAlign: "left",
                          fontWeight: 400,
                        }}
                      >
                        {fact.k}
                      </th>
                      <td style={{ padding: "5px 8px", border: "1px solid #ddd", fontWeight: 600, color: "#111" }}>
                        {fact.v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {block.kind === "sources" ? (
            <>
              <h2 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700, color: "#111" }}>Sources</h2>
              {block.items.map((source) => (
                <div key={source.n} style={{ fontSize: "12px", color: "#333", marginBottom: "2px" }}>
                  {source.n}. {source.title} — {source.org} ({source.year})
                  {source.url ? (
                    <>
                      {" "}
                      — <span style={{ color: "#555", wordBreak: "break-all" }}>{source.url}</span>
                    </>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
        </div>
      ))}
      <p
        style={{
          marginTop: "18px",
          paddingTop: "10px",
          borderTop: "1px solid #ddd",
          fontSize: "12px",
          color: "#666",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: "#a3190f" }}>{FACTSHEET_DEMO_NOTICE}</strong> This sheet is general information, not
        personal medical advice. Always follow the instructions from your own doctor or pharmacist. In an emergency call
        000.
      </p>
    </div>
  );
}

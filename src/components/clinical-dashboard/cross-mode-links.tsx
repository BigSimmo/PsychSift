"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Layers, Search, type LucideIcon } from "lucide-react";

import { cn, eyebrowText, semanticChipTone, sourceCard, type SemanticChipTone } from "@/components/ui-primitives";
import { logCrossModeLinkOpen } from "@/components/clinical-dashboard/source-actions";
import { shouldRunUniversalAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches-state";
import { useMedicationCatalog } from "@/components/clinical-dashboard/use-medication-catalog";
import { useUniversalSearch } from "@/components/clinical-dashboard/use-universal-search";
import { appModeIcons } from "@/lib/app-mode-icons";
import { appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { APP_MODE_ACCENT } from "@/lib/category-identity";
import {
  buildCrossModeLinksForThread,
  buildCrossModeLinksFromUniversalSearch,
  crossModeUniversalExcludedDomains,
  type CrossModeDifferentialCatalog,
  type CrossModeLink,
  type CrossModeLinkBadge,
} from "@/lib/cross-mode-links";
import { useRegistryRecords } from "@/lib/use-registry-records";

function badgeChipTone(tone: CrossModeLinkBadge["tone"]): SemanticChipTone | null {
  if (!tone) return null;
  return tone === "clinical" ? "info" : tone;
}

// Both trailing controls on a card are the same 48px square so neither reads as
// the primary one. `w-tap`/`h-tap` resolve to --spacing-tap (48px); the smoke
// suite asserts that floor on every link and button inside the rail at 320px.
const cardActionControl =
  "grid h-tap w-tap shrink-0 place-items-center rounded-md border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--cat-border)] hover:bg-[color:var(--cat-soft)] hover:text-[color:var(--cat-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

type CrossModeLinksVariant = "card" | "compact" | "responsive-compact" | "line";

// The ceiling on one library strip once both halves have contributed.
//
// Four, which is what the catalogue half alone allowed before the widened lookup
// existed. Five was set while this block was still a collapsed disclosure, where
// an extra row cost nothing until the reader opened it. It is open at every
// width now (owner decision, 2026-09-07), so every row is unconditional height
// on the answer surface, between the governed caution and the follow-ups.
// Holding the old ceiling keeps this change about reach rather than about size.
//
// The cap only binds when the catalogue half filled the strip on its own, and a
// question naming four medication, service, form or differential records is
// already well served. The common answer names none of them, which is where the
// widened reach earns its place and where this number never applies.
const crossModeStripMaxLinks = 4;

type CrossModeLinkCardProps = {
  link: CrossModeLink;
  Icon: LucideIcon;
  query: string;
  onModeSearch: (mode: AppModeId, query: string) => void;
};

function CrossModeLinkCard({ link, Icon, query, onModeSearch }: CrossModeLinkCardProps) {
  const extraBadge = link.badges[0] ?? null;

  return (
    <article
      role="listitem"
      data-category-accent={APP_MODE_ACCENT[link.modeId]}
      className={cn(sourceCard, "relative flex min-h-12 min-w-0 items-center gap-2.5 px-2.5 py-1.5", "md:max-w-full")}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[color:var(--cat-border)] bg-[color:var(--cat-soft)] text-[color:var(--cat-accent)]">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <Link
        href={link.detailHref}
        onClick={() => logCrossModeLinkOpen(query, link)}
        className={cn(
          "inline-flex min-h-tap min-w-0 items-center text-sm font-semibold leading-5 text-[color:var(--text-heading)] transition hover:text-[color:var(--cat-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
          // Phone: the whole row opens the record (audit D07, 2026-10-13). The title link
          // stretches over the card, so a tap anywhere on the row lands on it.
          "max-sm:after:absolute max-sm:after:inset-0 max-sm:after:content-['']",
        )}
      >
        <span className="truncate">{link.title}</span>
      </Link>
      {/* Hidden below sm for the same reason as the badge under it: the card now
          carries two 48px actions, and at 320px the chip plus both of them
          leave the title nothing to truncate into. The accent-tinted icon tile
          still carries the mode, and both action labels name it in full. */}
      <span className="hidden min-h-6 shrink-0 items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-wash)] px-2 text-2xs font-semibold text-[color:var(--text-muted)] sm:inline-flex">
        {link.modeLabel}
      </span>
      {extraBadge ? (
        // Decorative on narrow screens — hidden below sm so the title keeps room.
        <span
          className={cn(
            "hidden shrink-0 items-center rounded-full border px-1.5 py-0.5 text-2xs font-semibold sm:inline-flex",
            semanticChipTone(badgeChipTone(extraBadge.tone)),
          )}
        >
          {extraBadge.label}
        </span>
      ) : null}
      {/* Two signposted actions rather than one magnifying glass that had to
          stand for both (from sm up; a phone shows the open arrow alone). The glass alone did not say whether it searched or
          opened, and the only route to the record itself was the title text. */}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          // Re-runs the query inside the target mode. It must not emit a
          // cross_mode_link_open (a detail-page open) — only the title link and
          // the open control beside it do. Otherwise every "Search in …" click
          // would corrupt retrieval-quality/click telemetry.
          onClick={() => {
            onModeSearch(link.modeId, link.modeSearchQuery);
          }}
          aria-label={`Search ${link.title} in ${link.modeLabel}`}
          title={`Search in ${link.modeLabel}`}
          // Phone shows one icon only, the open arrow (audit D07, 2026-10-13): two
          // unlabelled squares read as the same thing at that size. From sm up both stay.
          className={cn(cardActionControl, "max-sm:hidden")}
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
        </button>
        <Link
          href={link.detailHref}
          // Same destination and same telemetry as the title link above: this is
          // a detail-page open, so it does emit cross_mode_link_open.
          onClick={() => logCrossModeLinkOpen(query, link)}
          aria-label={`Open ${link.title}`}
          title="Open page"
          // Above the stretched title link, so it stays its own tap target and focus stop.
          className={cn(cardActionControl, "relative")}
        >
          <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      </span>
    </article>
  );
}

// Compact one-line variant of the card: a small rectangle with the entity
// name and mode label linking to the reference, plus a square trailing
// button that re-runs the search inside that mode. Used where vertical
// space matters (e.g. the documents search page).
function CrossModeLinkChip({ link, Icon, query, onModeSearch }: CrossModeLinkCardProps) {
  return (
    <article
      role="listitem"
      data-category-accent={APP_MODE_ACCENT[link.modeId]}
      className="flex shrink-0 items-stretch overflow-hidden rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--cat-border)] hover:shadow-[var(--e1)]"
    >
      <Link
        href={link.detailHref}
        onClick={() => logCrossModeLinkOpen(query, link)}
        className="inline-flex min-h-tap min-w-0 items-center gap-2 px-2.5 transition hover:text-[color:var(--cat-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)] md:min-h-compact-meta"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[color:var(--cat-border)] bg-[color:var(--cat-soft)] text-[color:var(--cat-accent)]">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="max-w-[13rem] truncate text-xs font-semibold text-[color:var(--text-heading)]">
          {link.title}
        </span>
        <span className="shrink-0 text-2xs font-semibold uppercase tracking-label text-[color:var(--text-muted)]">
          {link.modeLabel}
        </span>
      </Link>
      <button
        type="button"
        // Matches the card variant: the search button re-runs the query in the
        // target mode, so it must not emit a cross_mode_link_open (a detail-page
        // open) — only the title link above does. Otherwise every "Search in …"
        // click would corrupt retrieval-quality/click telemetry.
        onClick={() => onModeSearch(link.modeId, link.modeSearchQuery)}
        aria-label={`Search ${link.title} in ${link.modeLabel}`}
        className="grid min-h-tap w-tap shrink-0 place-items-center border-l border-[color:var(--border)] text-[color:var(--text-muted)] transition hover:bg-[color:var(--cat-soft)] hover:text-[color:var(--cat-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)] md:min-h-compact-meta md:w-compact-meta"
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
      </button>
    </article>
  );
}

// Self-contained cross-mode links surface: owns the catalog fetching (same
// owner-scoped APIs the modes use; fixtures in demo mode), entity matching,
// and the strip. Mount it under any search-results surface and pass the
// query thread (oldest first) — it renders nothing until an entity matches.
export function CrossModeLinksSection({
  queries,
  enabled = true,
  onModeSearch,
  variant = "card",
  universalMode,
}: {
  queries: Array<string | null | undefined>;
  enabled?: boolean;
  // Defaults to navigating to the target mode with the search pre-run.
  onModeSearch?: (mode: AppModeId, query: string) => void;
  variant?: CrossModeLinksVariant;
  /**
   * Opt in to the cross-entity lookup that reaches DSM, Formulation, Specifiers,
   * Therapy, Dictionary and Tools, naming the mode the surface belongs to.
   *
   * Off by default, and that default is load-bearing. A surface that already
   * mounts `UniversalSearchAlsoMatches` (every mode but Answer) would otherwise
   * run the same query against the same endpoint twice and print the results in
   * two panels — the duplication removed on 2026-08-26. Pass it only from a
   * surface that mounts no other cross-mode panel, and pass `undefined` while a
   * generation is in flight so the lookup never races the answer stream.
   */
  universalMode?: AppModeId;
}) {
  const router = useRouter();
  const services = useRegistryRecords("service", { enabled, view: "search" });
  const forms = useRegistryRecords("form", { enabled, view: "search" });
  // fields=index keeps this to the ~30 KB identity slice of the catalog.
  const medications = useMedicationCatalog(undefined, { enabled, fields: "index" });
  const [differentials, setDifferentials] = useState<CrossModeDifferentialCatalog | null>(null);
  useEffect(() => {
    // Dynamic import keeps the cross-mode catalog out of the dashboard bundle.
    // cross-mode-differentials.ts now loads a precomputed ~53 KB index (not the
    // full ~1.2 MB differentials snapshot); the catalog is loaded once per session.
    if (!enabled || differentials) return;
    let cancelled = false;
    import("@/lib/cross-mode-differentials").then((module) => {
      if (!cancelled) setDifferentials(module.crossModeDifferentialCatalog());
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, differentials]);

  // Memo on the thread's contents, not the (per-render) array identity.
  const queriesKey = queries.filter((value): value is string => Boolean(value?.trim())).join("\u0000");
  const links = useMemo(() => {
    if (!enabled || !queriesKey) return [];
    return buildCrossModeLinksForThread(queriesKey.split("\u0000"), {
      medications: medications.data?.records ?? [],
      services: services.records,
      forms: forms.records,
      differentials: differentials ?? undefined,
    });
  }, [enabled, queriesKey, medications.data, services.records, forms.records, differentials]);

  const telemetryQuery = queriesKey.split("\u0000").at(-1) ?? "";
  // The newest turn, not the turn the catalogue links came from. The catalogue
  // path walks back through the thread on purpose, because a follow-up often
  // drops the entity name; the cross-entity lookup follows the question on
  // screen instead, which is the same query `ClinicalDashboard` already gives
  // the sibling "Also matches" tray on this mode.
  const universalQuery = universalMode ? telemetryQuery : "";
  // Read during render rather than in an effect, which is safe here only because
  // it changes no markup: the universal half starts empty on the server and on
  // the first client paint either way, and this value reaches nothing but the
  // hook's `enabled`. A restored answer thread sitting on an unsubmitted shared
  // home must not fetch, which is the rule this helper owns.
  const universalSubmitted =
    Boolean(universalMode) &&
    shouldRunUniversalAlsoMatches(
      universalMode ?? "answer",
      typeof window === "undefined" ? null : window.location.search,
      universalQuery,
    );
  const universal = useUniversalSearch({
    query: universalQuery,
    enabled: enabled && universalSubmitted,
    contextMode: universalMode ?? "answer",
    excludeDomains: crossModeUniversalExcludedDomains,
    limitPerDomain: 2,
  });
  const universalLinks = useMemo(() => {
    // `universal.query !== universalQuery` is the stale guard: the hook keeps the
    // previous query's groups while the next request is in flight, and a card
    // answering the prior question is exactly the guess this surface must not make.
    if (!universalMode || universal.query !== universalQuery) return [];
    return buildCrossModeLinksFromUniversalSearch(universalQuery, universal.groups, {
      existing: links,
      // Whatever the catalogue half left unused, up to the strip's ceiling.
      maxTotal: Math.max(0, crossModeStripMaxLinks - links.length),
    });
  }, [universalMode, universal.query, universal.groups, universalQuery, links]);

  const allLinks = universalLinks.length > 0 ? [...links, ...universalLinks] : links;

  if (allLinks.length === 0) return null;
  const handleModeSearch =
    onModeSearch ??
    ((mode: AppModeId, query: string) => {
      router.push(appModeHomeHref(mode, { query, focus: true, run: true }));
    });

  return (
    <CrossModeLinksStrip links={allLinks} onModeSearch={handleModeSearch} query={telemetryQuery} variant={variant} />
  );
}

/**
 * One line, opened on demand — the answer thread's variant (owner decision,
 * 2026-08-26, "direction B").
 *
 * Under an answer this block used to be a permanently expanded rail sitting
 * directly above a second, near-identical panel of mode matches. Two panels
 * asking the same question ("where else does this appear") read as one panel
 * repeated. This is the single row that replaced them: it closes the answer's
 * evidence/safety stack and collapses to give the space back before the
 * follow-up conversation begins.
 *
 * The header carries the label, a rule and the count — no preview of the record
 * names (owner decision, 2026-09-07). The names were there to tell a closed line
 * what it held, and the line rests open, so they were repeating the cards
 * directly beneath them.
 */
function CrossModeLinksLine({
  links,
  onModeSearch,
  query,
}: {
  links: CrossModeLink[];
  onModeSearch: (mode: AppModeId, query: string) => void;
  query: string;
}) {
  // Open on arrival, and still collapsible — the hybrid the owner asked for on
  // 2026-09-07, after seeing both ends of it. Closed-by-default hid the matches
  // behind a tap nobody had a reason to take, since a closed tray cannot show
  // what it holds. No toggle at all put four unconditional rows into the
  // answer's evidence stack with no way to put them away. One control, already
  // open, gives the reader the matches for free and the space back on request.
  const [open, setOpen] = useState(true);
  // `useId`, not a constant: two of these can mount at once (the answer thread
  // and a historical turn), and a duplicate id is a DOM-integrity failure the
  // smoke audit fails on.
  const panelId = useId();
  const countLabel = links.length === 1 ? "1 match" : `${links.length} matches`;
  return (
    <section
      aria-label="Related pages in other modes"
      data-testid="cross-mode-links"
      className={cn(
        // The recessed tray from `UniversalSearchAlsoMatches` — the "Also
        // matches" panel on the mode search pages — so the two cross-surface
        // suggestion panels read as one system rather than two inventions.
        // Border only, no `--shadow-inset`: card-recipes.ts records that pairing
        // a bevel with a border puts two edge treatments on one surface.
        "min-w-0 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-1.5 forced-colors:border sm:p-2",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="cross-mode-links-line-trigger"
        className={cn(
          "flex min-h-12 w-full items-center gap-2.5 rounded-xl px-2 text-left transition-colors hover:bg-[color:var(--surface)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
        )}
      >
        {/* Quiet mark, not a second brand block: the glyph carries the accent and
            the tile is a hairline on the tray's own ground, so the eye lands on
            the label rather than on a saturated square. */}
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--clinical-accent)] forced-colors:border"
          aria-hidden
        >
          <Layers className="size-icon-md" aria-hidden />
        </span>
        <span className={cn(eyebrowText, "shrink-0 text-[color:var(--text-heading)]")}>Also in your library</span>
        {/* Label, rule, count — the same editorial section-header device the
            "Also matches" tray uses, and now at every width. A preview of the
            first three record names used to take the rule's place from sm up;
            it earned that room while the line rested closed and had no other
            way to say what it held. Resting open, it was naming the cards
            immediately below it. */}
        <span className="h-px min-w-3 flex-1 bg-[color:var(--border)] forced-colors:bg-[CanvasText]" aria-hidden />
        {/* The visible count is decorative — it is dropped entirely below sm, and
            `hidden` hides it from assistive tech as well as from the eye. This
            tray has no live region to carry the number, so without the sr-only
            copy the count would never reach a screen reader at any width, and
            the closed control would announce as a door onto an unknown. */}
        <span
          className="hidden shrink-0 text-2xs font-medium tabular-nums text-[color:var(--text-muted)] sm:inline"
          aria-hidden
        >
          {countLabel}
        </span>
        <span className="sr-only">{countLabel}</span>
        <span
          className={cn(
            "-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[color:var(--text-muted)] transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden
        >
          <ChevronDown className="size-icon-md" aria-hidden="true" />
        </span>
      </button>
      {/* Always mounted, hidden with `display: none` when closed. Rendering it
          only while open left `aria-controls` pointing at nothing for the whole
          time the line was collapsed — a broken ARIA reference, which is what
          the smoke suite's DOM-integrity audit caught.

          Every display utility lives in the open branch, and that is load-bearing.
          `hidden` sitting beside a `md:flex` in one class list does NOT collapse
          this rail from 768px up: both are display utilities of equal specificity
          and Tailwind emits the `md:` rule later, inside a media query, so
          `display: flex` won. The panel then sat open on every desktop while its
          own trigger reported `aria-expanded="false"`. (The same mechanic is used
          deliberately in `universal-search-also-matches.tsx`, where the panel is
          meant to be always-open from sm up and the header is made inert to
          match. This one is a real disclosure at every width.) */}
      <div
        id={panelId}
        role="list"
        className={cn(
          "cross-mode-links-rail min-w-0",
          open ? "mt-1.5 grid gap-1.5 md:flex md:max-w-full md:flex-wrap md:gap-2" : "hidden",
        )}
        data-testid="cross-mode-links-rail"
      >
        {links.map((link) => (
          <CrossModeLinkCard
            key={`${link.modeId}:${link.slug}`}
            link={link}
            Icon={appModeIcons[link.modeId]}
            query={query}
            onModeSearch={onModeSearch}
          />
        ))}
      </div>
    </section>
  );
}

export function CrossModeLinksStrip({
  links,
  onModeSearch,
  query = "",
  variant = "card",
}: {
  links: CrossModeLink[];
  onModeSearch: (mode: AppModeId, query: string) => void;
  // The search text that produced the links; used only for click telemetry.
  query?: string;
  variant?: CrossModeLinksVariant;
}) {
  if (links.length === 0) return null;

  if (variant === "line") {
    return <CrossModeLinksLine links={links} onModeSearch={onModeSearch} query={query} />;
  }

  const compact = variant === "compact";
  const responsiveCompact = variant === "responsive-compact";
  const LinkItem = compact ? CrossModeLinkChip : CrossModeLinkCard;

  return (
    <section
      aria-label="Related pages in other modes"
      className={cn(
        "border-t border-[color:var(--border)] pt-2.5",
        compact ? "md:flex md:items-center md:gap-3" : "max-w-[68ch]",
      )}
      data-testid="cross-mode-links"
    >
      <p className={cn(eyebrowText, compact ? "mb-2 shrink-0 md:mb-0" : "mb-2")}>
        Also in your library
        {links.length > 1 ? (
          <span className="font-medium normal-case tracking-normal text-[color:var(--text-muted)]">
            {" "}
            · {links.length} matches
          </span>
        ) : null}
      </p>

      {responsiveCompact ? (
        // Both rails stay mounted so SSR and the first paint agree; `hidden` /
        // `md:hidden` use `display: none`, which removes the inactive rail from
        // the accessibility tree. Keep distinct test ids so phone vs wide
        // selectors do not double-count links.
        <>
          <div
            role="list"
            tabIndex={links.length > 1 ? 0 : undefined}
            aria-label={links.length > 1 ? "Related library matches; scroll horizontally for more" : undefined}
            className="cross-mode-links-rail polished-scroll flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 md:hidden"
            data-testid="cross-mode-links-rail"
          >
            {links.map((link) => (
              <CrossModeLinkChip
                key={`${link.modeId}:${link.slug}`}
                link={link}
                Icon={appModeIcons[link.modeId]}
                query={query}
                onModeSearch={onModeSearch}
              />
            ))}
          </div>
          <div
            role="list"
            className="cross-mode-links-rail hidden min-w-0 gap-1.5 md:flex md:max-w-full md:flex-wrap md:gap-2"
            data-testid="cross-mode-links-card-rail"
          >
            {links.map((link) => (
              <CrossModeLinkCard
                key={`${link.modeId}:${link.slug}`}
                link={link}
                Icon={appModeIcons[link.modeId]}
                query={query}
                onModeSearch={onModeSearch}
              />
            ))}
          </div>
        </>
      ) : (
        <div
          role="list"
          tabIndex={compact && links.length > 1 ? 0 : undefined}
          aria-label={compact && links.length > 1 ? "Related library matches; scroll horizontally for more" : undefined}
          className={cn(
            "cross-mode-links-rail",
            compact
              ? "polished-scroll flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 md:pb-0"
              : "grid min-w-0 gap-1.5 md:flex md:max-w-full md:flex-wrap md:gap-2",
          )}
          data-testid="cross-mode-links-rail"
        >
          {links.map((link) => (
            <LinkItem
              key={`${link.modeId}:${link.slug}`}
              link={link}
              Icon={appModeIcons[link.modeId]}
              query={query}
              onModeSearch={onModeSearch}
            />
          ))}
        </div>
      )}
    </section>
  );
}

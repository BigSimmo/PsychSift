"use client";

import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import { useModeBandShown } from "@/components/mode-band/mode-band-shown";
import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";
import { BrowserPrintButton } from "@/components/ui/print-output";

/**
 * The mode's in-page headers: one for the essentials card, one for the section
 * pages.
 *
 * Both live here because `tests/mode-nav-addon-slot.dom.test.tsx` pins one
 * claimant FILE per mode — every route that claims the phone header's addon
 * slot registers that claim in its mode's `*-nav-header.tsx` sibling, so the
 * set of pages competing for the single collapse owner can be read off a list
 * of files rather than discovered by grepping every page component. The card
 * briefly mounted `InPageNavHeader` itself and turned that test red.
 *
 * The section pages carried the shared `ModeNav` rail until the owner pointed
 * out what it was doing: the mode pill already opens On Call's nine pages, and
 * the rail listed the same nine underneath it. Two controls, one job, and
 * nothing at all helping a reader move around the page in front of them —
 * Contacts runs to six groups and several screens.
 *
 * The bar is back, but pointed the other way: it lists the CURRENT PAGE's
 * groups, and cross-page navigation keeps its one home in the mode pill. Same
 * component, opposite job — which is the distinction
 * `tests/on-call-section-page-wiring.dom.test.tsx` pins, because "On Call has a
 * rail again" is the sentence that would quietly undo the whole correction.
 *
 * `back` targets `/on-call`, the mode's dashboard. It used to target
 * `consolidatedModeSearchPath("on-call")` because `/on-call` was a redirect stub
 * that rendered nothing to land on; it is now the mode home, and that helper
 * throws for a mode outside the consolidated map.
 *
 * The card's print control sits in its actions sheet, following
 * `DictionaryTermPage` — the one place every converted information page keeps
 * its print row.
 */
export function OnCallCardNavHeader() {
  // Under the work-mode band (work-mode redesign, owner request 6 Oct 2026)
  // the band already names the page and its round back button returns to
  // On Call, so a second bar would say both again. The card keeps its own
  // "Print card" button on the page.
  const underBand = useModeBandShown();
  if (underBand) return null;
  return (
    <InPageNavHeader
      back={{ href: "/on-call", label: "On Call" }}
      title="Pocket card"
      testIdPrefix="on-call-card"
      actionsTitle="Card actions"
      actionsDescription="Print the numbers flagged for this card."
      actionsNoun="card"
      actions={
        <div className="grid gap-1">
          <BrowserPrintButton label="Print card" />
        </div>
      }
    />
  );
}

/**
 * The header for the mode's single-purpose tools — Who to call now, Check
 * these, First night, Calendar. Like the card, each is reached by an action
 * from the home, so each keeps the back arrow to `/on-call`. Kept in this file
 * for the same one-claimant reason as the two headers around it.
 */
export function OnCallToolNavHeader({ title, testIdPrefix }: { title: string; testIdPrefix: string }) {
  // A tool page the work-mode band draws (Who to call now) already has the
  // band's title and its round back button, so the bar would repeat both.
  // Pages that keep their own header (`band: false`) still get it.
  const underBand = useModeBandShown();
  if (underBand) return null;
  return <InPageNavHeader back={{ href: "/on-call", label: "On Call" }} title={title} testIdPrefix={testIdPrefix} />;
}

/** The prefix `InPageNavHeader` composes this mode's header testids from. */
export const ON_CALL_SECTION_HEADER_PREFIX = "on-call-section";

/**
 * The three testids that header renders, written out rather than composed.
 *
 * Two records outside React read them as plain text — the mockup ledger's gate
 * scans this directory for testid literals, and the boards spec names them —
 * and an interpolated `${prefix}-detail-header` is invisible to both.
 * `tests/on-call-section-header-testids.test.ts` pins each one against the
 * prefix and against the suffixes `InPageNavHeader` actually emits, so the two
 * cannot drift apart quietly.
 */
export const ON_CALL_SECTION_HEADER_TEST_IDS = {
  header: "on-call-section-detail-header",
  sectionTrigger: "on-call-section-section-trigger",
  sectionRail: "on-call-section-section-rail",
  sectionOverflow: "on-call-section-section-overflow",
  sectionSheetBack: "on-call-section-section-sheet-back",
} as const;

/**
 * The section pages' header: the page's own groups, as a bar, and nothing else.
 *
 * `sections` are the page's groups, declared by `onCallPageSections` and
 * narrowed by `useInPageSectionNav` to the ones actually rendered. Two is the
 * floor — one group is a heading, not navigation — so a page with nothing to
 * group by (Teaching) renders NO header at all rather than an empty band.
 *
 * NO TITLE, deliberately. The mode pill directly above names the current page
 * on its main line, with a small teal "On Call" beneath it, and on a phone this
 * bar is portaled into that same pill's collapse row. Painting "Contacts" here
 * put the word twice in one 96px block — the duplication the owner flagged
 * three times across this redesign.
 *
 * NO ACTIONS EITHER. Page tools (add, bulk verify, pocket card, order) live
 * in the in-page More control beside the list. The universal header trailing
 * slot is Search my work, and on the home a Needs you bell — not a second
 * ellipsis. A row drawn for one ellipsis costs the 48px this redesign spent
 * three passes recovering.
 *
 * NO BACK CONTROL, also deliberately. Every page in this mode is a destination
 * in the mode pill's own list — the hub included, as "Tonight" — so an arrow
 * pointing at the hub described a parent-child hierarchy that does not exist.
 * It also put a control that leaves the page at the head of a row whose entire
 * job is moving around INSIDE the page. The way out is the pill that got you
 * here.
 *
 * `OnCallCardNavHeader` above keeps its arrow: the pocket card is reached by
 * an action ("Print the pocket card") as well as by the pill, and backing out
 * of an action is what an arrow is for.
 */
export function OnCallSectionNavHeader({ title, sections }: { title: string; sections: readonly PageSection[] }) {
  const { sections: resolved, activeId, selectSection } = useInPageSectionNav(sections);

  if (resolved.length === 0) return null;

  return (
    <InPageNavHeader
      title={title}
      titleHidden
      sections={resolved}
      activeId={activeId}
      onSelectSection={selectSection}
      // The bar Therapy already ships, pointed at THIS PAGE's groups instead of
      // the mode's routes. It replaced a bordered pill that named the current
      // group and hid the others behind a tap: the pill answered "where am I",
      // which the page's own sticky headings already answered, and answered
      // nothing about where else you could go. The bar answers both at a
      // glance, which is the whole reason a 3am hub has navigation at all.
      rail={{
        label: "Sections of this page",
        // Bare single words, no glyph, no badge — see the profile's own note in
        // `mode-nav-bands.ts` for the measurements the bands are cut from. It
        // is NOT `extended`: sharing Therapy's profile is exactly how a retune
        // for one surface silently moved another's bands (PR #2686).
        density: "wordmark-five",
        // On Call's teal, on the bar's active underline. The same attribute is
        // on the mode pill directly above it, and both read one token, so the
        // two cannot end up different greens.
        modeIdentity: "on-call",
      }}
      // Phone only: this bar is portaled INTO the universal header's own
      // collapse slot, so a solid surface painted a second panel inside a glass
      // one and the two rows read as two objects with a seam between them.
      // Transparent lets one material carry both, and the bar's own top rule is
      // the only edge the block needs.
      className="max-sm:border-b-0 max-sm:bg-transparent"
      testIdPrefix={ON_CALL_SECTION_HEADER_PREFIX}
    />
  );
}

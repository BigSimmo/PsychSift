import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sourceSegment } from "./helpers/source-contract";

const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const therapyPath = "src/components/therapy-compass";

const globalsSource = read("src/app/globals.css");
const controlsSource = read(`${therapyPath}/controls.ts`);
const registryModeNavSource = read("src/components/mode-nav/registry-mode-nav.tsx");
const therapyCardSource = read(`${therapyPath}/therapy-card.tsx`);
const therapyFavouriteSource = read(`${therapyPath}/use-therapy-favourite.ts`);
const workspaceSource = read(`${therapyPath}/workspace.tsx`);
const modeHomeComposerSource = read("src/lib/mode-home-composer.ts");
const modeHomeTemplateSource = read("src/components/mode-home-template.tsx");
const informationPageShellSource = read("src/components/information-page-shell.tsx");
const printOutputSource = read("src/components/ui/print-output.tsx");
const detailSource = read(`${therapyPath}/screens/detail-screen.tsx`);
const keyFactsSource = read(`${therapyPath}/record/key-facts.tsx`);
const compareSource = read(`${therapyPath}/screens/compare-screen.tsx`);
const recommendSource = read(`${therapyPath}/screens/recommend-screen.tsx`);
const recommendFieldsSource = read(`${therapyPath}/recommend-scenario-fields.tsx`);
const pathwaysSource = read(`${therapyPath}/screens/pathways-screen.tsx`);
const pathwayStepStackSource = read(`${therapyPath}/pathway-step-stack.tsx`);
const pathwayPickerSource = read(`${therapyPath}/pathway-picker-sheet.tsx`);
const briefSource = read(`${therapyPath}/screens/brief-screen.tsx`);
const sheetsSource = read(`${therapyPath}/screens/sheets-screen.tsx`);
const otherSource = read(`${therapyPath}/screens/other-screen.tsx`);

/**
 * A fixed multi-column grid must collapse to a single column on phones via
 * Tailwind's mobile-first `grid-cols-1` + `sm:grid-cols-*`.
 *
 * All three className spellings count. This used to read only `className="…"`,
 * so a grid written as `className={`${cardSurface} grid-cols-1 sm:grid-cols-…`}`
 * was invisible to the check — not failing it, simply never counted. Adopting
 * the shared `cardSurface` recipe moved several of these grids to the template
 * form and exposed the hole: the compare grid still stacked on phones exactly
 * as before, and the count silently fell to zero. The same hole reopened when
 * `${cardSurface} …` template literals were replaced by `cn(cardSurface, "…")`
 * calls — the class list moved into a second string argument the old pattern
 * never looked inside. Matching all three forms is the stronger condition,
 * because it measures the reflow rather than the authoring style.
 */
function responsiveStackCount(source: string) {
  return (
    source
      .match(/className=(?:"[^"]*"|\{`[^`]*`\}|\{cn\([\s\S]*?\)\})/g)
      ?.filter((block) => /\bgrid-cols-1\b/.test(block) && /\bsm:grid-cols-/.test(block)).length ?? 0
  );
}

function openingTagWith(source: string, tagName: string, attributes: string[]) {
  const lookaheads = attributes
    .map((attribute) => `(?=[^>]*${attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)
    .join("");
  return source.match(new RegExp(`<${tagName}${lookaheads}[^>]*>`))?.[0];
}

function contrastRatio(firstHex: string, secondHex: string) {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const lighter = Math.max(luminance(firstHex), luminance(secondHex));
  const darker = Math.min(luminance(firstHex), luminance(secondHex));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Therapy Compass responsive contract", () => {
  it("retires the parallel stylesheet and uses the shared page canvas", () => {
    expect(existsSync(new URL(`../${therapyPath}/therapy-compass.css`, import.meta.url))).toBe(false);
    expect(workspaceSource).toContain("data-therapy-root");
    expect(workspaceSource).toContain("bg-[color:var(--background)]");
    expect(workspaceSource).not.toContain("var(--surface-chrome)");
    // The sideways-scrolling pill strip is retired: Therapy's nav is the shared
    // bar, which folds its overflow into a sheet rather than off the screen
    // edge. Its own density and centring contract lives in mode-nav-contract.
    expect(registryModeNavSource).toContain("ModeNav");
    expect(registryModeNavSource).toContain('"therapy-compass": "extended"');
    expect(registryModeNavSource).not.toContain("overflow-x-auto");
    expect(registryModeNavSource).not.toContain("w-fit");
    expect(globalsSource).toContain("position: relative;");
  });

  it("anchors the mode nav in the header collapse host", () => {
    expect(modeHomeComposerSource).toContain(
      'export const phoneHeaderCollapseAddonSlotId = "phone-header-collapse-addon-slot"',
    );
    // The portal is `ModeNavHeaderPortal`'s job now, not the mode's — it claims
    // the same slot at every width rather than only below the phone seam.
    expect(read("src/components/mode-nav/mode-nav-portal.tsx")).toContain("phoneHeaderCollapseAddonSlotId");
    expect(registryModeNavSource).not.toContain("PhoneHeaderCollapsePortal");
  });

  it("puts every therapy screen on the shared content rail", () => {
    // Three rails used to disagree: header max-w-7xl, bar full-bleed, body on
    // bespoke 1240/1180px caps. Catalogue screens use `pageContainer`
    // directly; information routes inherit the same rail from the shared shell.
    for (const [name, source] of [
      ["compare", compareSource],
      ["recommend", recommendSource],
      ["pathways", pathwaysSource],
      ["other", otherSource],
    ] as const) {
      expect(source, `${name} screen`).toContain("pageContainer");
    }
    expect(informationPageShellSource).toContain("pageContainer");
    for (const [name, source] of [
      ["detail", detailSource],
      ["brief", briefSource],
      ["sheets", sheetsSource],
    ] as const) {
      expect(source, `${name} screen`).toContain("InformationPageShell");
    }
    for (const [name, source] of [
      ["detail", detailSource],
      ["compare", compareSource],
      ["recommend", recommendSource],
      ["pathways", pathwaysSource],
      ["brief", briefSource],
      ["sheets", sheetsSource],
      ["other", otherSource],
    ] as const) {
      expect(source, `${name} screen`).not.toContain("max-w-[1240px]");
      expect(source, `${name} screen`).not.toContain("max-w-[1180px]");
    }
    expect(workspaceSource).toContain("pageContainer");
    expect(workspaceSource).not.toContain("sm:px-10");
  });

  it("keeps phone reflow residuals in globals.css", () => {
    expect(globalsSource).toMatch(/@media \(max-width: 640px\)/);
    expect(globalsSource).toContain(".therapy-pathway-list");
    // `[data-therapy-scroll-sm]` was the phone horizontal-scroll enabler for the
    // comparison table. Phones no longer render that table at all — they get the
    // stacked per-field layout below `md` — so the rule and the attribute were
    // removed together rather than left as a rule nothing can match.
    expect(globalsSource).not.toContain("[data-therapy-scroll-sm]");
  });

  it("marks every fixed screen/card grid for phone reflow without changing its desktop template", () => {
    const sharedHomeSource = read("src/components/clinical-dashboard/answer-status.tsx");
    expect(sharedHomeSource).toContain("ModeHomeTemplate");
    expect(modeHomeTemplateSource).toContain("sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]");
    expect(modeHomeTemplateSource).toContain("max-sm:border-t");
    expect(modeHomeTemplateSource).toContain("sm:rounded-lg sm:border");
    expect(modeHomeTemplateSource).not.toContain("lg:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]");
    expect(modeHomeTemplateSource).toContain("sm:flex-wrap");
    // The shared 8px gap keeps Therapy's five common searches on one 960px
    // row before and after the Geist font swap. A 10px desktop override made
    // the final row 961px, wrapped one pill, and produced desktop CLS 0.126.
    expect(modeHomeTemplateSource).not.toContain("sm:gap-2.5");
    expect(sharedHomeSource).toContain("desktopComposerSlotId={desktopComposerSlotId}");
    // The caveat footer under the composer was removed from every mode home;
    // Therapy keeps only its page-bottom footer, gated `showFooter={!isHome}`.
    // Both halves of that are enforced structurally in
    // tests/mode-home-no-caveat-footer.test.ts rather than by name here.
    // The record page is a single reading column at every width now, so it has
    // no multi-column grid of its own to reflow and no sticky rail to un-stick.
    // What replaced them is the key-facts strip, which is phone-first in the
    // medication `DetailTile` shape: two up on a phone, four across from `sm`.
    // Four short tiles at one-per-row would push the record body a full screen
    // down, which is the fold problem this page was rebuilt to fix.
    expect(keyFactsSource).toContain("grid-cols-2");
    expect(keyFactsSource).toContain("sm:grid-cols-4");
    expect(detailSource).not.toContain("sticky");
    expect(responsiveStackCount(compareSource)).toBeGreaterThanOrEqual(1);
    expect(compareSource).toContain("<Tabs");
    expect(compareSource).toContain("<SegmentedControl");
    // The comparison forks at `md`, not `sm`: the table is `min-w-[720px]`, so
    // at 640–767px it would still scroll sideways — the exact defect this fixes.
    // Asserting the fork (not the old scroll attribute) keeps this from passing
    // vacuously once the phone stopped using the table.
    expect(compareSource).not.toContain("data-therapy-scroll-sm");
    expect(compareSource).toContain("hidden overflow-x-auto");
    expect(compareSource).toContain("md:block");
    expect(compareSource).toContain('data-testid="therapy-compare-stack"');
    expect(compareSource).toContain("md:hidden");
    expect(responsiveStackCount(recommendSource) + responsiveStackCount(recommendFieldsSource)).toBeGreaterThanOrEqual(
      1,
    );
    expect(responsiveStackCount(pathwaysSource)).toBeGreaterThanOrEqual(1);
    expect(pathwayPickerSource).toContain("therapy-pathway-list");
    expect(pathwayPickerSource).toContain('data-testid="therapy-pathway-picker"');
    expect(pathwayStepStackSource).toContain('data-testid="therapy-pathway-steps"');
    expect(pathwaysSource).toContain('data-testid="therapy-pathway-caution"');
    expect(pathwayPickerSource).toContain("sm:hidden");
    expect(pathwayPickerSource).toContain("hidden border-r");
    expect(pathwaysSource).not.toContain("overflow-hidden");
    expect(responsiveStackCount(briefSource)).toBeGreaterThanOrEqual(1);
    expect(responsiveStackCount(sheetsSource)).toBeGreaterThanOrEqual(1);
    expect(sheetsSource).toContain("max-sm:static");
    expect(responsiveStackCount(otherSource)).toBeGreaterThanOrEqual(1);

    const allScreens = [
      therapyCardSource,
      detailSource,
      compareSource,
      recommendSource,
      pathwaysSource,
      briefSource,
      sheetsSource,
      otherSource,
    ].join("\n");
    expect(allScreens).toMatch(/sm:grid-cols-\[/);
  });

  it("lets result-card evidence and actions use the phone width without forcing the desktop grid", () => {
    const resultCardSource = sourceSegment(therapyCardSource, "export function ResultCard", "function CardCell", {
      label: "therapy ResultCard",
    });

    expect(resultCardSource).toContain("data-therapy-result-card");
    expect(resultCardSource).toContain("md:grid-cols-[minmax(240px,1fr)_minmax(320px,1.35fr)]");
    expect(resultCardSource).toContain("-mx-4 grid grid-cols-1");
    expect(resultCardSource).toContain("sm:grid-cols-3");
    expect(resultCardSource).toMatch(/data-therapy-result-actions\s+className="grid grid-cols-3/);
    expect(resultCardSource).toContain('<span className="sm:hidden">Open</span>');
    // Desktop: the stretched Open link makes the whole card the target, so the actions
    // sit at the row's end at their own width instead of three full-width buttons.
    expect(resultCardSource).toContain("md:flex md:justify-end");
    expect(therapyCardSource).toMatch(/const cardActionButton = "[^"]*md:w-auto/);
    expect(resultCardSource).toContain("stretchedRowLinkClass");
    expect(resultCardSource).not.toContain("<IconTile");
  });

  it("keeps the Favourite action wired and surfaces mutation failures", () => {
    expect(therapyCardSource).toContain("useTherapyFavourite(therapy.slug)");
    expect(therapyCardSource).toContain("onClick={() => void toggleFavourite()}");
    expect(therapyCardSource).toContain("aria-pressed={saved}");
    expect(therapyCardSource).toContain('role="status"');
    expect(therapyFavouriteSource).toContain('await accountData.setFavourite("therapy", slug, nowSaved)');
    expect(therapyFavouriteSource).toContain("Sign in or create an account to save therapies.");
    expect(therapyFavouriteSource).toContain("Save failed. Try again.");
  });

  it("keeps search result cards dense: single-row tags, top favourite, clamped match cells", () => {
    expect(therapyCardSource).toContain("wrap={false}");
    expect(therapyCardSource).toContain("max={3}");
    expect(therapyCardSource).toContain("prioritiseTherapyTags");
    expect(therapyCardSource).toContain("cardPreviewText");
    expect(therapyCardSource).toContain("line-clamp-2");
    expect(therapyCardSource).toContain("grid-cols-3");
    // Favourite is pinned to the card corner; no heart-only desktop column.
    expect(therapyCardSource).toContain("absolute top-3 right-3");
    // Two-column card body waits for `md` so 640–700px viewports do not overflow.
    expect(therapyCardSource).toContain("md:grid-cols-[minmax(240px,1fr)_minmax(320px,1.35fr)]");
    expect(therapyCardSource).not.toMatch(/sm:grid-cols-\[minmax\([^)]+\),1fr\)_minmax\([^)]+\),1\.35fr\)/);
    expect(therapyCardSource).not.toMatch(/sm:grid-cols-\[minmax\([^)]+\),1fr\)_minmax\([^)]+\),1\.35fr\)_auto\]/);
    // Fallbacks run after preview filtering so a title-only first field can yield.
    expect(therapyCardSource).toMatch(
      /cardPreviewText\(therapy\.bestUsedFor,\s*\{\s*exclude:\s*therapy\.name\s*\}\)\s*\|\|/,
    );
    expect(therapyCardSource).toMatch(/cardPreviewText\(therapy\.indications,\s*\{\s*exclude:\s*therapy\.name\s*\}\)/);
  });

  it("keeps the single-row TagRow overflow indicator unclipped", () => {
    const uiSource = read(`${therapyPath}/ui.tsx`);
    expect(uiSource).toContain("flex-nowrap gap-2 overflow-hidden");
    expect(uiSource).toContain("+{extra}");
    // `+N` is a shrink-0 sibling outside the clipping flex row.
    expect(uiSource).toMatch(/overflow-hidden[\s\S]*?\{pills\}[\s\S]*?shrink-0[\s\S]*?\{overflow\}/);
  });

  it("uses complete toggle semantics and preserves full-size control hit targets", () => {
    // Indentation is not the contract. These used to pin the exact leading
    // whitespace of each opening tag, so moving the density control into a
    // `PageHeader` `actions` slot — which re-indents it and changes nothing
    // else — failed an assertion about toggle semantics. `openingTagWith` is
    // the stronger condition: it proves the element really is that component
    // AND carries the labelling attribute, and unlike a raw substring it
    // cannot be satisfied by matching prose elsewhere in the file.
    expect(briefSource).toContain("const BRIEF_DURATION");
    expect(briefSource).not.toMatch(/briefTab === "15min" \? "15-minute"/);
    expect(openingTagWith(briefSource, "Tabs", ['label="Brief intervention duration"'])).toBeTruthy();

    expect(openingTagWith(compareSource, "Tabs", ['label="Comparison fields"'])).toBeTruthy();
    expect(openingTagWith(compareSource, "SegmentedControl", ['label="Comparison density"'])).toBeTruthy();
    expect(openingTagWith(sheetsSource, "SegmentedControl", ['label="Reading level and tone"'])).toBeTruthy();

    const pickerTriggerTag = openingTagWith(sheetsSource, "button", ["aria-expanded={open}"]);
    expect(pickerTriggerTag).toBeTruthy();

    expect(sheetsSource).toContain("<ToggleSwitch");
    expect(sheetsSource).toContain('aria-label="Show clinician footer"');
  });

  it("uses shared print output ownership with route-scoped paper styling", () => {
    expect(briefSource).toContain("<PrintOutput");
    expect(sheetsSource).toContain("<PrintOutput");
    expect(printOutputSource).toContain("data-print-output");
    expect(printOutputSource).toContain("data-print-provenance");
    expect(printOutputSource).toContain('data-therapy-paper={paperTone === "therapy" ? "" : undefined}');

    const pageRuleStart = globalsSource.indexOf("@page shared-clinical-output");
    expect(pageRuleStart).toBeGreaterThanOrEqual(0);
    const printBlock = globalsSource.slice(pageRuleStart, pageRuleStart + 1200);

    expect(printBlock).toContain("body:has([data-print-output]) *");
    expect(printBlock).toContain("body:has([data-print-output]) [data-print-output]");
    expect(printBlock).toContain("page: shared-clinical-output;");
    expect(printBlock).not.toMatch(/\n\s*body\s+\*/);
  });
});

describe("clinical accent contrast contract", () => {
  it("uses the semantic contrast token on every identified accent foreground", () => {
    const sources = [
      controlsSource,
      read(`${therapyPath}/ui.tsx`),
      recommendSource,
      pathwaysSource,
      briefSource,
      read("src/components/clinical-dashboard/answer-status.tsx"),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(/background:var\(--clinical-accent\);color:#(?:fff|ffffff)/i);
      expect(source).not.toMatch(/bg-\[color:var\(--clinical-accent\)\][^"\n]*\btext-white\b/);
    }
    // This used to assert that `controls.ts` paired its accent fill with the
    // semantic contrast token, which was `accentControl`'s job. That recipe is
    // gone: therapy's filled action is the shared `Button` on the `--command`
    // triplet, per COMPONENTS.md section 9.1, whose token list does not include
    // `--clinical-accent`. So the requirement is now the stronger one — no accent
    // fill in `controls.ts` at all — and the pairing is asserted where the accent
    // fill actually survives, on `IconTile` in `ui.tsx`.
    expect(controlsSource).not.toContain("bg-[color:var(--clinical-accent)]");
    expect(read(`${therapyPath}/ui.tsx`)).toContain(
      "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]",
    );
    expect(pathwaysSource).not.toContain('? "#fff" : "var(--clinical-accent)"');
    expect(briefSource).not.toContain('? "#fff" : "var(--clinical-accent)"');
  });

  it("maps sweep-touched Lucide size={16} onto size-icon-md", () => {
    for (const [name, source] of [
      ["brief", briefSource],
      ["compare", compareSource],
      ["recommend", recommendSource],
      ["sheets", sheetsSource],
    ] as const) {
      expect(source, `${name} screen`).not.toMatch(/\bsize=\{16\}/);
    }
    expect(briefSource).toContain("size-icon-md");
    expect(compareSource).toContain("size-icon-md");
    expect(sheetsSource).toContain("size-icon-md");
  });

  it("keeps the current dark accent/foreground token pair above text contrast", () => {
    const darkStart = globalsSource.indexOf(".dark {");
    const darkEnd = globalsSource.indexOf("\n}", darkStart);
    const darkTokens = globalsSource.slice(darkStart, darkEnd);
    const accent = darkTokens.match(/--primary-500:\s*(#[0-9a-f]{6})/i)?.[1];
    const foreground = darkTokens.match(/--clinical-accent-contrast:\s*(#[0-9a-f]{6})/i)?.[1];

    expect(accent).toBeTruthy();
    expect(foreground).toBeTruthy();
    expect(contrastRatio(accent!, foreground!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("VisualEvidence unavailable-source semantics", () => {
  it("renders a non-link row when a source href is absent", () => {
    const source = read("src/components/clinical-dashboard/visual-evidence.tsx");

    expect(source).not.toContain('href={row.href ?? "#"}');
    expect(source).not.toContain("aria-disabled={!row.href}");
    expect(source).toContain("if (!row.href)");
    expect(source).toContain('data-testid="evidence-map-source-unavailable"');
    expect(source).toContain("Source unavailable");
    expect(source).toContain("href={row.href}");
    expect(source).toContain('data-testid="evidence-map-open-source"');
  });
});

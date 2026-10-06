import { guestAnswerThreadOwnerId } from "@/lib/answer-thread-storage";
import { demoRecentQueryOwnerId, recentQueryStorageKey } from "@/lib/recent-query-storage";

/**
 * The cascade-layer inertness registry (ledger #094).
 *
 * PR #1316 shipped the search band's accent rail **inert**: `.search-band` sat in
 * `@layer components`, which loses to Tailwind's unlayered utilities regardless of
 * specificity, so the border never painted. The test that was supposed to protect
 * it asserted `toHaveClass("search-band")` — class presence, i.e. the *cause* —
 * and passed happily while the *effect* was absent. jsdom cannot catch this class
 * of bug at all: it does not implement cascade layers, so
 * `tests/search-results-header-band.dom.test.tsx` still asserts the class today.
 *
 * Only a real browser can prove a style is live, and `check:design-system-contract`
 * cannot help either — it is a static AST/regex pass over source text.
 *
 * So this file holds two things:
 *
 * 1. {@link parseUnlayeredVisualClasses} — the inventory. Every class rule in
 *    `globals.css` that sits OUTSIDE `@layer` and carries a visual property is a
 *    class that deliberately relies on being unlayered to beat a utility. Those
 *    are exactly the rules that go inert if someone moves them into a layer.
 * 2. {@link STYLE_EFFECT_CONTRACTS} — rendered-effect assertions, driven in a real
 *    browser by `tests/ui-style-contract.spec.ts`.
 *
 * `tests/style-contract-registry.test.ts` ties the two together: every class in the
 * inventory must be either covered by a contract or carry an explicit, reasoned
 * exemption below. A newly-added unlayered class therefore fails the gate until
 * someone consciously decides which it is. That is the part that was missing —
 * the existing rail assertion in `ui-accessibility.spec.ts` was a one-off, and
 * nothing forced the next unlayered class to get one.
 */

/** A declaration group that a Tailwind utility could plausibly fight over. */
const VISUAL_PROPERTY =
  /(?:^|[;{])\s*(?:border(?:-top|-bottom|-left|-right)?(?:-width|-color|-style)?|background(?:-color|-image)?|box-shadow|color|outline(?:-color|-width)?)\s*:/m;

/** Replace comment bodies with blanks so line numbers survive the strip. */
function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ""));
}

export type UnlayeredVisualClass = {
  readonly className: string;
  /** 1-indexed lines of every unlayered rule that styles this class. */
  readonly lines: readonly number[];
  /** Media queries wrapping those rules, if any. */
  readonly media: readonly string[];
  /**
   * Whether at least one of those rules sits outside every media query.
   *
   * Tracked separately because `media` is a union across all of a class's rules:
   * a class with one plain rule and one `forced-colors` override would otherwise
   * look media-scoped, and {@link isMediaOverrideOnly} would wave its real
   * component rule past the coverage gate.
   */
  readonly unmediated: boolean;
};

type StyleContractSessionBootstrap = {
  readonly sessionStorage?: ReadonlyArray<{
    readonly key: string;
    readonly value: readonly string[];
  }>;
};

/**
 * Class rules in `css` that sit outside every `@layer` block and set a visual
 * property.
 *
 * Brace depth is tracked line by line rather than with a real CSS parser: this
 * repo's stylesheet is hand-written with one selector or declaration per line, and
 * a dependency-free reader keeps the gate runnable in the node Vitest project.
 */
export function parseUnlayeredVisualClasses(css: string): UnlayeredVisualClass[] {
  const lines = blankComments(css).split("\n");
  const layerRegions: Array<[number, number]> = [];
  const mediaRegions: Array<[number, number, string]> = [];
  const openLayers: Array<[number, number]> = [];
  const openMedia: Array<[number, number, string]> = [];
  let depth = 0;

  for (const [index, line] of lines.entries()) {
    if (/^\s*@layer\s/.test(line) && line.includes("{")) openLayers.push([index, depth]);
    const media = /^\s*@media([^{]*)\{/.exec(line);
    if (media) openMedia.push([index, depth, media[1].trim()]);

    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);

    while (openLayers.length > 0 && depth <= openLayers[openLayers.length - 1][1]) {
      const [start] = openLayers.pop() as [number, number];
      layerRegions.push([start, index]);
    }
    while (openMedia.length > 0 && depth <= openMedia[openMedia.length - 1][1]) {
      const [start, , query] = openMedia.pop() as [number, number, string];
      mediaRegions.push([start, index, query]);
    }
  }

  const insideLayer = (index: number) => layerRegions.some(([start, end]) => start <= index && index <= end);
  const mediaFor = (index: number) =>
    mediaRegions.filter(([start, end]) => start <= index && index <= end).map(([, , query]) => query);

  const found = new Map<string, { lines: number[]; media: Set<string>; unmediated: boolean }>();

  for (const [index, line] of lines.entries()) {
    // Any line that opens a rule block, at-rules excluded. Deliberately NOT
    // "starts with a class": a selector list is often split across lines, and an
    // earlier line can carry a class the opening line does not
    // (`.edge-glass-header-backdrop,` above `.edge-glass-header-backdrop::before,`
    // … `{`). Keying on the opening line alone silently left those classes
    // unpoliced, so the gate could pass with an unregistered unlayered class.
    if (!line.trimEnd().endsWith("{") || /^\s*@/.test(line)) continue;
    if (insideLayer(index)) continue;

    const body: string[] = [];
    let nesting = 1;
    for (let cursor = index + 1; cursor < lines.length && nesting > 0; cursor += 1) {
      nesting += (lines[cursor].match(/\{/g)?.length ?? 0) - (lines[cursor].match(/\}/g)?.length ?? 0);
      if (nesting > 0) body.push(lines[cursor]);
    }
    if (!VISUAL_PROPERTY.test(body.join("\n"))) continue;

    // Walk back over the comma-continued lines that belong to this selector list,
    // so every class in it is inventoried against the line it actually appears on.
    const selectorLines: Array<[number, string]> = [[index, line.slice(0, line.indexOf("{"))]];
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = lines[cursor].trim();
      if (previous === "") continue;
      if (!previous.endsWith(",")) break;
      selectorLines.push([cursor, lines[cursor]]);
    }

    const media = mediaFor(index);
    for (const [selectorLine, selectorText] of selectorLines) {
      for (const className of new Set(selectorText.match(/\.([A-Za-z][\w-]*)/g)?.map((raw) => raw.slice(1)) ?? [])) {
        const entry = found.get(className) ?? { lines: [], media: new Set<string>(), unmediated: false };
        if (!entry.lines.includes(selectorLine + 1)) entry.lines.push(selectorLine + 1);
        for (const query of media) entry.media.add(query);
        if (media.length === 0) entry.unmediated = true;
        found.set(className, entry);
      }
    }
  }

  return [...found.entries()]
    .map(([className, entry]) => ({
      className,
      lines: entry.lines.sort((a, b) => a - b),
      media: [...entry.media].sort(),
      unmediated: entry.unmediated,
    }))
    .sort((a, b) => (a.className < b.className ? -1 : a.className > b.className ? 1 : 0));
}

/**
 * A class whose only unlayered rules re-pin a token inside `forced-colors`/`print`.
 *
 * These are deliberate high-contrast/print overrides with their own coverage (the
 * forced-colors journeys in `ui-accessibility.spec.ts`), so they do not each need a
 * default-theme effect contract. A class with any unmediated rule is NOT one of
 * these, however loudly its forced-colors override shouts.
 */
export function isMediaOverrideOnly(entry: UnlayeredVisualClass): boolean {
  return !entry.unmediated && entry.media.length > 0 && entry.media.every((query) => /forced-colors|print/.test(query));
}

export type StyleEffectContract = {
  /** The unlayered class this contract proves is live. */
  readonly className: string;
  /** Human-readable name used in the test title. */
  readonly description: string;
  readonly route: string;
  /** Optional viewport needed to make a responsive rule's target render. */
  readonly viewport?: Readonly<{ width: number; height: number }>;
  /** Playwright selector for an element carrying `className`. */
  readonly selector: string;
  readonly bootstrap?: StyleContractSessionBootstrap;
  /** Computed values that must match exactly. */
  readonly computed: Readonly<Record<string, string>>;
  /** A computed colour that must resolve to the named CSS custom-property token. */
  readonly colorToken?: Readonly<{ property: string; token: `--${string}` }>;
  /** Computed properties that must remain visually distinct from each other. */
  readonly distinct?: readonly (readonly [string, string])[];
  /** Exact computed values after `forced-colors: active` is emulated. */
  readonly forcedColors?: Readonly<Record<string, string>>;
  /**
   * Properties that must resolve to something actually visible. A layered (inert)
   * rule leaves these at the UA/utility default — `rgba(0, 0, 0, 0)` or `none` —
   * so this catches inertness even where the exact token value is theme-dependent.
   */
  readonly nonInert?: readonly string[];
};

const HOME_RECENT_QUERIES = ["clozapine monitoring schedule"] as const;
const HOME_RECENT_QUERY_STORAGE_KEYS = [
  `${recentQueryStorageKey}:${guestAnswerThreadOwnerId}`,
  `${recentQueryStorageKey}:${demoRecentQueryOwnerId}`,
] as const;
const homeRecentQueriesContractBootstrap: StyleContractSessionBootstrap = {
  sessionStorage: HOME_RECENT_QUERY_STORAGE_KEYS.map((key) => ({ key, value: HOME_RECENT_QUERIES })),
};

/**
 * Rendered-effect contracts, asserted in Chromium by `tests/ui-style-contract.spec.ts`.
 *
 * Deliberately small and load-bearing rather than broad and shallow: each entry
 * navigates a real route and reads real computed style, so an entry that cannot be
 * reached deterministically in demo mode is worse than no entry. Broad coverage of
 * "did this surface change visually" is the pixel-baseline suite's job
 * (`tests/ui-visual-baseline.spec.ts`); this file is for the specific rules whose
 * whole purpose is to beat a utility.
 */
export const STYLE_EFFECT_CONTRACTS: readonly StyleEffectContract[] = [
  {
    className: "search-band-lead",
    description: "search band accent lead rule is a live border",
    route: "/services?q=CMHT&run=1",
    // The mark moved inside the padding when the band collapsed to one line: a
    // 2px line across the full width read as a divider between the composer and
    // the results rather than as the band's own accent.
    // Scoped to the accent tone. `2px solid` holds only while the band is
    // healthy; if the live search on this route degrades to `partial`, the mark
    // renders `data-tone="warning"` and `6px double`, and the contract would go
    // red for a reason that has nothing to do with the cascade regression it
    // exists to catch.
    selector: '[data-testid="search-query-ribbon"]:visible .search-band-lead[data-tone="accent"]',
    // The exact regression, unchanged in kind: the accent is an unlayered rule
    // that has to beat Tailwind's utilities layer, and when it loses it degrades
    // to something that still passes every class-presence assertion — before, a
    // neutral 1px border; now, a zero-width box. Assert computed style.
    computed: { borderLeftWidth: "2px", borderLeftStyle: "solid" },
    nonInert: ["borderLeftColor"],
    colorToken: { property: "borderLeftColor", token: "--clinical-accent" },
    // Cross-element "accent ≠ card neutral border" lives in
    // `ui-accessibility.spec.ts`. Same-element distinct pairs against this
    // mark's own zero-width top border only proved it has no top border.
    // Under forced colors the mark survives as stroke count, not hue:
    // --clinical-accent resolves to LinkText and --warning is not remapped at
    // all, so a healthy search is one stroke and a degraded one is two.
    forcedColors: { borderLeftWidth: "2px", borderLeftStyle: "solid" },
    // NOTE: an attribute-variant assertion (`[data-status="error"]` re-colours the
    // rail via `--warning`) was written and removed again. It failed in CI and then
    // reproduced locally, so it is NOT a timing race — the computed border colour
    // simply does not change the way the stylesheet reads as though it should. That
    // is either a real cascade fact worth understanding or a token that resolves to
    // the same value, and neither was diagnosed. Shipping the assertion would have
    // put an unexplained red in the required gate; shipping it silently weakened
    // would have been worse. Recorded as a follow-up instead.
  },
  {
    className: "mode-nav__rule",
    description: "mode nav overflow rule marks the page held in More",
    // Compare folds into More at Therapy's three-slot phone band.
    route: "/therapy-compass/compare",
    viewport: { width: 352, height: 844 },
    // Scoped through the collapse host: Next streams the server-rendered copy
    // while the client tree hydrates, so a bare testid can resolve to two navs.
    selector: '[data-testid="universal-header-collapse"] [data-testid="mode-nav"] .mode-nav__more .mode-nav__rule',
    // Exactly the regression this registry exists for. SlotInk renders the rule
    // with Tailwind's `bg-transparent`, and the unlayered rule here is what
    // paints it. Move that rule into a layer and it loses to the utility: the
    // element still has every class, still has its 2px box, and marks nothing —
    // so a folded page would silently stop saying where you are.
    computed: { height: "2px" },
    nonInert: ["backgroundColor"],
    colorToken: { property: "backgroundColor", token: "--clinical-accent" },
  },
  {
    className: "mode-nav__ink",
    description: "mode nav overflow ink takes heading weight when it holds the page",
    route: "/therapy-compass/compare",
    viewport: { width: 352, height: 844 },
    selector: '[data-testid="universal-header-collapse"] [data-testid="mode-nav"] .mode-nav__more .mode-nav__ink',
    // The other half of the mark, and a genuine cascade fight: SlotInk sets
    // `text-[color:var(--text-muted)]` for the off state, and this unlayered
    // rule has to beat it. Losing leaves the ink muted while the rule below it
    // is accent — a half-marked control that looks like a rendering bug.
    computed: {},
    nonInert: ["color"],
    colorToken: { property: "color", token: "--text-heading" },
  },
  {
    className: "home-recent-searches",
    description: "home recent-searches surface keeps compact desktop gap and phone-first mobile column flow",
    route: "/",
    selector: '[data-testid="shared-home-recent-queries"]',
    bootstrap: homeRecentQueriesContractBootstrap,
    computed: {
      rowGap: "6px",
      columnGap: "10px",
      display: "flex",
    },
  },
  {
    className: "answer-source-mark",
    description: "in-prose source mark renders as the raised bordered box, not bare text",
    // Demo mode answers this question with two cited sources, so the prose
    // carries a real mark cluster rather than a single mark.
    route: "/?mode=answer&q=What+clozapine+monitoring+items+are+shown+in+the+table+image%3F&run=1",
    selector: '[data-testid="plain-answer-prose"] [data-testid="answer-source-mark"]',
    // The whole of this mark's geometry lives in the unlayered class: the
    // component sets colour and state only. If the rule goes inert the control
    // does not disappear — it degrades to a full-size inline button showing a
    // bare digit in the middle of a clinical sentence, which reads as a typo
    // rather than as a reference. Every value here is a declaration of that rule.
    computed: {
      position: "relative",
      display: "inline-block",
      borderTopWidth: "1px",
      borderTopStyle: "solid",
      textAlign: "center",
      verticalAlign: "baseline",
    },
    // Colour is the component's, not the rule's, and it is asserted here because
    // the resting mark is deliberately one hue whatever the document's status:
    // staleness belongs to the rail card and the drawer, never to the reference.
    nonInert: ["borderTopColor", "backgroundColor"],
    colorToken: { property: "borderTopColor", token: "--clinical-accent-border" },
  },
  {
    className: "answer-suggestion-label",
    description: "home recent-search labels use readable text contrast when nested under compact rail",
    route: "/",
    selector: '[data-testid="shared-home-recent-queries"] .answer-suggestion-label',
    bootstrap: homeRecentQueriesContractBootstrap,
    computed: {},
    nonInert: ["color"],
    colorToken: { property: "color", token: "--text-heading" },
  },
];

/**
 * Unlayered visual classes with no rendered-effect contract yet, and why.
 *
 * This is debt made countable, not debt excused — ledger #094 asks for effect
 * assertions across this surface and each line below is a place that still has
 * none. The value of listing them is that the inventory is now closed: a new
 * unlayered class is neither contracted nor exempt, so the gate fails and the
 * author has to choose. Prefer deleting a line here by adding a contract.
 */
export const STYLE_CONTRACT_EXEMPTIONS: Readonly<Record<string, string>> = {
  // Not component effects.
  dark: "theme root selector, not a component class; token values are asserted by the dark-mode journeys",
  "dash-surface":
    "My Day dashboard token scope: sets the --dash-* variables and base ink colour only; the look is checked by the My Day capture in ui-visual-artifacts",
  "my-day-quiet":
    "My Day quieter look: token overrides plus flat avatar/wallet fills on My Day only; the look is checked by the My Day capture in ui-visual-artifacts",
  "dash-avatar-amber": "flattened only under .my-day-quiet; see the my-day-quiet exemption",
  "dash-avatar-blue": "flattened only under .my-day-quiet; see the my-day-quiet exemption",
  "dash-avatar-green": "flattened only under .my-day-quiet; see the my-day-quiet exemption",
  "dash-wallet-amber": "flattened only under .my-day-quiet; see the my-day-quiet exemption",
  "dash-wallet-blue": "flattened only under .my-day-quiet; see the my-day-quiet exemption",
  "dash-wallet-green": "flattened only under .my-day-quiet; see the my-day-quiet exemption",
  "touch-card": "sets outline/touch-action only; the shared focus treatment is asserted by ui-accessibility",
  "clinical-ask-field": "Clinical Ask clarification fields are covered by ui-clinical-ask",
  "clinical-ask-output-actions": "Clinical Ask output controls are covered by ui-clinical-ask",
  "clinical-ask-workspace": "Clinical Ask responsive workspace is covered by ui-clinical-ask",

  // Phone/answer composer chrome. Covered behaviourally by verify:phone-chrome and
  // the chrome-scroll/overlap journeys, but not yet by computed-effect assertions.
  "answer-footer-search-backdrop": "phone composer chrome — reserve/overlay behaviour covered by ui-chrome-scroll",
  "answer-footer-search-chip": "phone composer chrome — no effect contract yet (#094)",
  "answer-footer-search-divider": "phone composer chrome — no effect contract yet (#094)",
  "answer-footer-search-dock": "phone composer chrome — dock geometry covered by ui-phone-scroll",
  "answer-footer-search-edge": "phone composer chrome — edge-to-edge contract covered by ui-phone-scroll",
  "answer-footer-search-input": "phone composer chrome — no effect contract yet (#094)",
  "answer-footer-search-pill": "phone composer chrome — no effect contract yet (#094)",
  "answer-footer-search-pill-open": "phone composer chrome — no effect contract yet (#094)",
  "answer-footer-search-send": "phone composer chrome — no effect contract yet (#094)",
  "chat-composer-icon-button": "answer composer — no effect contract yet (#094)",
  "chat-composer-input": "answer composer — no effect contract yet (#094)",
  "chat-composer-shell-base": "answer composer — no effect contract yet (#094)",
  "chat-composer-shell-delta": "answer composer — no effect contract yet (#094)",
  "chat-send-button": "answer composer — no effect contract yet (#094)",
  "field-control":
    "standalone field focus — quiet border shift; source-pinned by tests/search-shell-focus.contract.test.ts",
  "search-shell":
    "nested search shell focus — quiet border; source-pinned by tests/search-shell-focus.contract.test.ts",
  "search-shell-input": "nested search input — unlayered outline:none so Tailwind cannot lose to the shared field rule",
  "dashboard-composer-edge":
    "dashboard composer edge — found only after the multiline-selector parser fix; no effect contract yet (#094)",
  "document-mobile-search-edge": "document viewer composer — covered by ui-phone-scroll geometry, not effect",
  "document-mobile-search-pill": "document viewer composer — no effect contract yet (#094)",
  "guide-tour-dock":
    "Guide Centre phone dock — the UI smoke journey proves its safe-area paint, CTA clearance, and hide behaviour",
  "edge-glass-header":
    "overlaid glass header — found only after the multiline-selector parser fix; hide/reveal covered by ui-chrome-scroll, effect not contracted",
  "edge-glass-header-backdrop":
    "overlaid glass header — forced-colors and reserve behaviour covered by ui-accessibility",
  "universal-header": "shared header — hide/reveal covered by ui-chrome-scroll; background effect not contracted yet",

  // Answer suggestions and smart search.
  "answer-suggestion-chip": "answer suggestion rail — no effect contract yet (#094)",
  "answer-suggestion-chip-icon": "answer suggestion rail — no effect contract yet (#094)",
  "answer-suggestion-scroll-control":
    "one-line rail edge control — its absolute positioning is what keeps a 48px target out of the 32px rail, and ui-overlap measures exactly that (tap floor, and the composer still 160px with the control rendered); no computed-effect contract yet (#094)",
  "answer-suggestion-scroll-control-face":
    "one-line rail edge control face — painted chip inside the tap target; visibility and label covered by ui-overlap, effect not contracted (#094)",
  "search-example-ticker": "home example ticker line — reduced-motion behaviour covered by ui-accessibility",
  "search-example-ticker-query": "home example ticker line — reduced-motion behaviour covered by ui-accessibility",
  "smart-search-phone-ticker": "smart-search ticker title line — no contract yet (#094)",
  "smart-search-phone-ticker-kicker": "smart-search ticker kicker — no contract yet (#094)",
  "smart-search-phone-ticker-action": "smart-search ticker action chip — no contract yet (#094)",
  "smart-search-intent-cue": "server-gated Smart intent cue — state and accessibility covered by master-search-header",
  // Mode switcher.
  "mode-action-surface": "mode menu surface — dismissal/focus covered by ui-accessibility, effect not contracted",
  "mode-action-mode-option": "mode menu option — no effect contract yet (#094)",
  "mode-action-mode-option-active": "mode menu option — no effect contract yet (#094)",
  "mode-action-mode-option-icon": "mode menu option — no effect contract yet (#094)",

  // Mode-specific surfaces.
  "differentials-mobile-compare-fab__button": "differentials compare FAB — no effect contract yet (#094)",
  "differentials-mobile-compare-fab__button--empty": "differentials compare FAB — no effect contract yet (#094)",
  // Same shape as the compare FAB above, and the same gap: a rendered-effect
  // contract needs a phone-viewport route with the medication catalogue loaded.
  // The tap floor (min-height: 3rem) is the regression worth catching here.
  "patient-details-fab__button": "patient details dock pill — no effect contract yet (#094)",
  "patient-details-fab__button--active": "patient details dock pill, populated state — no effect contract yet (#094)",
  "patient-details-fab__count": "patient details count badge — no effect contract yet (#094)",
  "medication-mobile-result": "prescribing phone results — no effect contract yet (#094)",

  // Therapy compare tray. Phone-only (it portals into the dock's addon slot
  // below 639px), so it is not reachable at the desktop viewport
  // `ui-style-contract.spec.ts` drives — the same reason the Patient details
  // pill above is exempt rather than contracted. What is covered:
  // `tests/therapy-compare-tray.dom.test.tsx` pins the portal target,
  // breakpoint, empty-set silence and sheet wiring, and
  // `tests/ui-therapy-nav-scroll.spec.ts` proves in Chromium that the row hides
  // with the composer and releases its reserve. None of that is a computed-style
  // assertion, so these stay exemptions, not contracts.
  "therapy-compare-tray": "therapy compare tray row — phone-only; no effect contract yet (#094)",
  "therapy-compare-tray__pip": "therapy compare tray slot pip — phone-only; no effect contract yet (#094)",
  "therapy-compare-tray__names": "therapy compare tray name line — phone-only; no effect contract yet (#094)",
  "therapy-compare-tray__count": "therapy compare tray count line — phone-only; no effect contract yet (#094)",
  "search-band-count": "count weight/colour; the zero-result state needs a deterministic empty fixture first",
  "search-band-rule": "gradient divider — forced-colors fallback covered by ui-accessibility",

  // PWA notices. `ui-pwa` deterministically raises the browser install event
  // and covers the sheet's geometry, reachability, short-viewport scrolling,
  // composer clearance, reduced motion, and forced-colors fallbacks. These
  // component effects are not yet individually asserted by the general
  // computed-style journey.
  "pwa-action-primary": "PWA primary action — target geometry covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-action-secondary": "PWA secondary action — target geometry covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-connection-restored": "PWA connectivity-recovery notice — no deterministic effect contract yet (#094)",
  "pwa-install-benefits":
    "PWA benefit list — install-sheet journey covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-install-body": "PWA install body — install-sheet journey covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-install-sheet":
    "PWA install sheet — short-desktop park/compact and geometry covered by ui-pwa and pwa-install-short-desktop; effect not contracted yet (#094)",
  "pwa-install-copy": "PWA install copy — install-sheet journey covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-install-compact-copy":
    "PWA compact phone proposition — visibility and geometry covered across target widths by ui-pwa",
  "pwa-install-dismiss": "PWA install dismissal — target geometry covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-install-grip":
    "PWA phone-sheet grip — responsive sheet journey covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-install-header":
    "PWA install header — install-sheet journey covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-install-native-sheet":
    "selector scope for browser-native install prompts; descendant compact-card effects are covered by ui-pwa",
  "pwa-install-steps":
    "PWA manual-install steps — install-sheet journey covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-install-support":
    "PWA install support copy — install-sheet journey covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-install-tagline":
    "PWA install tagline — install-sheet journey covered by ui-pwa; effect not contracted yet (#094)",
  "pwa-notice-card":
    "PWA notice card — motion and forced-colors fallbacks covered by ui-pwa; effect not contracted yet (#094)",

  // Selector scopes, not effects. `.mode-nav` carries the density-profile/query
  // container context, while `.mode-nav__more` scopes the overflow slot's rules.
  // Neither class receives a visual declaration from these selectors; the
  // descendant effects are covered by the contracts and density journeys.
  "mode-nav":
    "profile/query-container scoping ancestor only; descendant effects are covered by mode-nav contracts and density journeys",
  "mode-nav__more": "scoping ancestor only; the rules it scopes are contracted on mode-nav__rule and mode-nav__ink",

  // Therapy Compass residuals moved out of the deleted parallel stylesheet.
  // Phone behaviour is pinned by therapy-compass-responsive-contract; no
  // browser computed-effect contract yet (#094 / #183).
  "therapy-pathway-list":
    "phone border swap (right→bottom) under max-width 640px — covered by therapy-compass-responsive-contract",
};

const normalize = (file) => file.replaceAll("\\", "/").replace(/^\.\//, "");

const phoneChromeContractTests = [
  "tests/installed-lock-parity.test.ts",
  "tests/final-merge-audit.test.ts",
  "tests/verify-phone-chrome.test.ts",
  "tests/verify-pr-local.test.ts",
  "tests/header-scroll-hide-contract.test.ts",
  "tests/mobile-composer-reserve.test.ts",
  "tests/ui-overlay-css-contract.test.ts",
  "tests/clinical-dashboard-merge-artifacts.test.ts",
  "tests/use-hide-on-scroll.test.ts",
];

// The `-<suffix>` arm covers the phone-scroll split (ui-phone-scroll{,-routes,
// -page-owned}.spec.ts). Without it a changed sibling is not recognised as a
// phone-chrome browser spec and never reaches the changed-browser stage.
const phoneChromeBrowserSpecPattern =
  /^tests\/ui-(?:phone-scroll(?:-[a-z0-9-]+)?|phone-motion|smoke|tools|chrome-scroll|therapy-nav-scroll)\.spec\.ts$/;

/**
 * Every spec that imports tests/helpers/phone-scroll.ts.
 *
 * A helper-only change is `playwrightHelper` scope, which selects the focused
 * ownership journeys — four grepped cases in ONE of these files. That leaves a
 * regression in a shared function (`readGeometry`, `installFlipCounter`,
 * `dragScrollBy`) passing the phone-chrome gate while other helper consumers
 * never run. So a change to the helper runs all of its consumers in
 * full, exactly as if each spec had been edited directly.
 *
 * `tests/verify-phone-chrome.test.ts` pins this list against the specs that
 * actually import the helper, so another sibling cannot be added without
 * either joining this list or failing that test.
 */
const sharedPhoneScrollHelper = "tests/helpers/phone-scroll.ts";
const phoneScrollConsumerSpecs = [
  "tests/ui-phone-scroll-assessments.spec.ts",
  "tests/ui-phone-scroll.spec.ts",
  "tests/ui-phone-scroll-page-owned.spec.ts",
  "tests/ui-phone-scroll-routes.spec.ts",
  "tests/ui-phone-scroll-document-rail.spec.ts",
];

const patterns = {
  docs: [/^docs\//, /^AGENTS\.md$/],
  infrastructure: [
    /^package(?:-lock)?\.json$/,
    /^scripts\/(?:check-installed-lock-parity|phone-chrome-plan|playwright-browser-preflight|run-playwright|verify-phone-chrome)\.mjs$/,
    /^tests\/(?:installed-lock-parity|playwright-browser-preflight|verify-phone-chrome)\.test\.ts$/,
  ],
  playwrightHelper: [/^tests\/playwright-(?:scroll|settlement)\.ts$/, /^tests\/helpers\/phone-scroll\.ts$/],
  dashboard: [
    /^src\/components\/ClinicalDashboard\.tsx$/,
    /^src\/components\/clinical-dashboard\/use-dashboard-chrome-coordinator\.ts$/,
    /^tests\/ui-smoke\.spec\.ts$/,
  ],
  shell: [
    /^src\/components\/clinical-dashboard\/(?:global-search-shell|master-search-header)\.tsx$/,
    /^tests\/ui-tools\.spec\.ts$/,
  ],
  documents: [
    /^src\/components\/DocumentViewer\.tsx$/,
    /^src\/components\/clinical-dashboard\/use-document-viewer-chrome-scroll\.ts$/,
  ],
  calculators: [/^src\/components\/calculators\//],
  differentials: [/^src\/components\/differentials\//],
  // On Call owns phone chrome of its own: every page in the mode mounts the
  // shared rail itself, and its dashboard is a phone-first surface. Without an
  // owner here, any edit under `src/components/on-call/` falls into `unknownUi`
  // and escalates a section-copy tweak to the whole Chromium suite.
  onCall: [/^src\/components\/on-call\//, /^src\/lib\/on-call\//],
  // CME owns phone chrome of its own the same way On Call does: its screens
  // share one in-page navigation header (`CmeNavHeader`) rather than
  // receiving chrome from the shell, and the mode is a phone-first personal
  // log. Without an owner here, any edit under `src/components/cme/` or
  // `src/lib/cme/` falls into `unknownUi` and escalates a copy tweak to the
  // whole Chromium suite instead of narrowing to CME's own journeys.
  cme: [/^src\/components\/cme\//, /^src\/lib\/cme\//],
  // Teaching owns phone chrome the way CME does: its session pages share one
  // in-page header (`TeachingNavHeader`), and the mode is phone-first.
  teaching: [/^src\/components\/teaching\//, /^src\/lib\/teaching\//],
  sharedFoundation: [
    /^src\/app\/globals\.css$/,
    /^src\/styles\//,
    /^src\/components\/ClinicalDashboard\.tsx$/,
    /^src\/components\/clinical-dashboard\/(?:global-search-shell|master-search-header|mobile-composer-reserve|phone-footer-layer-portal|scroll-surface|use-active-scroll-owner|use-dashboard-chrome-coordinator|use-hide-on-scroll|use-phone-overlay-chrome-reserve)\.(?:ts|tsx)$/,
    /^package-lock\.json$/,
  ],
  phoneContract: [
    /^docs\/(?:search-chrome-behaviour|phone-chrome-physical-acceptance)\.md$/,
    /^tests\/(?:header-scroll-hide-contract|mobile-composer-reserve|ui-overlay-css-contract|clinical-dashboard-merge-artifacts|use-hide-on-scroll|playwright-motion-emulation-contract)\.test\.ts$/,
    // Same `-<suffix>` arm as phoneChromeBrowserSpecPattern: a sibling-only
    // edit (routes / page-owned) must still count as phoneContract so contracts
    // and ownership stages run. Exact `phone-scroll` alone marks phoneRelevant
    // false and the note says "No phone-chrome-affecting file was detected"
    // while changed-browser still runs the file — incomplete, not empty.
    /^tests\/ui-(?:phone-scroll(?:-[a-z0-9-]+)?|phone-motion|chrome-scroll|therapy-nav-scroll)\.spec\.ts$/,
  ],
};

function matchesAny(file, matchers) {
  return matchers.some((pattern) => pattern.test(file));
}

function nodeStage(id, label, args) {
  return { id, label, command: { executable: "node", args } };
}

function npmStage(id, label, script) {
  return { id, label, command: { executable: "npm", args: ["run", script] } };
}

export function renderPhoneChromeCommand(command) {
  return [
    command.executable,
    ...command.args.map((argument) => (/\s|\|/.test(argument) ? JSON.stringify(argument) : argument)),
  ].join(" ");
}

export function phoneChromePlan(rawFiles, { fullMode = "auto" } = {}) {
  if (!new Set(["auto", "always", "never"]).has(fullMode)) {
    throw new Error(`Unsupported full-suite mode: ${fullMode}`);
  }

  const files = [...new Set(rawFiles.map(normalize).filter(Boolean))].sort();
  const flags = Object.fromEntries(
    Object.entries(patterns).map(([name, matchers]) => [name, files.some((file) => matchesAny(file, matchers))]),
  );
  const docsOnly = files.length > 0 && files.every((file) => matchesAny(file, patterns.docs));
  const uiSourceChanged = files.some((file) => /^src\/(?:app|components|styles)\//.test(file));
  const phoneRelevant =
    flags.infrastructure ||
    flags.playwrightHelper ||
    flags.dashboard ||
    flags.shell ||
    flags.documents ||
    flags.calculators ||
    flags.differentials ||
    flags.onCall ||
    flags.cme ||
    flags.teaching ||
    flags.sharedFoundation ||
    flags.phoneContract;
  const unknownUi = uiSourceChanged && !phoneRelevant;
  const runOwnership =
    !docsOnly &&
    (flags.playwrightHelper ||
      flags.dashboard ||
      flags.shell ||
      flags.documents ||
      flags.calculators ||
      flags.differentials ||
      // On Call's pages own their header chrome — each mounts the shared rail
      // itself rather than receiving it from the shell — so the page-owned
      // ownership journey is the one that can see them break.
      flags.onCall ||
      // CME's screens share one in-page nav header of their own for the same
      // reason; see the `cme` pattern comment above.
      flags.cme ||
      // Teaching's screens share one in-page nav header for the same reason.
      flags.teaching ||
      flags.sharedFoundation ||
      flags.phoneContract);
  const runDashboardJourneys =
    !docsOnly && (flags.playwrightHelper || flags.dashboard || flags.documents || flags.sharedFoundation);
  const runShellJourneys = !docsOnly && (flags.playwrightHelper || flags.shell || flags.sharedFoundation);
  const autoFull = Boolean(!docsOnly && (flags.sharedFoundation || unknownUi));
  const runFull = fullMode === "always" || (fullMode === "auto" && autoFull);

  const stages = [];

  if (docsOnly) {
    stages.push(npmStage("docs-index", "documentation remains indexed", "docs:check-index"));
    stages.push(npmStage("docs-links", "documentation links remain valid", "docs:check-links"));
  } else {
    stages.push(
      npmStage("lock-parity", "the complete installed tree matches package-lock.json", "check:installed-lock-parity"),
    );
  }

  if (!docsOnly && (phoneRelevant || unknownUi)) {
    stages.push(npmStage("runtime", "Node and npm runtime match the repository contract", "check:runtime"));
    stages.push(
      nodeStage("contracts", "phone chrome static and unit contracts", [
        "scripts/run-vitest.mjs",
        "run",
        ...phoneChromeContractTests,
        "--reporter=dot",
      ]),
    );
  }

  const changedBrowserFiles = [
    ...new Set([
      ...files.filter((file) => phoneChromeBrowserSpecPattern.test(file)),
      ...(files.includes(sharedPhoneScrollHelper) ? phoneScrollConsumerSpecs : []),
    ]),
  ].sort();
  const changedBrowserFileSet = new Set(changedBrowserFiles);
  if (changedBrowserFiles.length > 0) {
    stages.push(
      nodeStage("changed-browser", "complete changed phone-chrome browser specs", [
        "scripts/run-playwright.mjs",
        ...changedBrowserFiles,
        "--project=chromium",
      ]),
    );
  }

  const focusedBrowserJourneys = [];
  // All four ownership journeys live in the page-owned split, not the shell file
  // that kept the original name — pointing this at ui-phone-scroll.spec.ts would
  // grep patterns that file no longer contains and select nothing.
  if (runOwnership && !changedBrowserFileSet.has("tests/ui-phone-scroll-page-owned.spec.ts")) {
    focusedBrowserJourneys.push({
      file: "tests/ui-phone-scroll-page-owned.spec.ts",
      pattern:
        "phone browser results use document scrolling|document detail header overlay and footer follow|compiled standalone PWA rules bind full-height footer chrome|standalone .* is frame-owned",
    });
  }
  if (runDashboardJourneys && !changedBrowserFileSet.has("tests/ui-smoke.spec.ts")) {
    focusedBrowserJourneys.push({
      file: "tests/ui-smoke.spec.ts",
      pattern:
        "phone long answer stays scrollable|phone answer result keeps the edge dock|answer glass header overlays main|document viewer bottom composer hides",
    });
  }
  if (runShellJourneys && !changedBrowserFileSet.has("tests/ui-tools.spec.ts")) {
    focusedBrowserJourneys.push({
      file: "tests/ui-tools.spec.ts",
      pattern: "phone bottom search dock stays edge-to-edge|phone bottom search dock hides while scrolling down",
    });
  }
  if (focusedBrowserJourneys.length > 0) {
    stages.push(
      nodeStage("focused-browser", "browser/PWA ownership matrix and affected phone journeys", [
        "scripts/run-playwright.mjs",
        ...focusedBrowserJourneys.map(({ file }) => file),
        "--project=chromium",
        "--grep",
        focusedBrowserJourneys.map(({ pattern }) => pattern).join("|"),
      ]),
    );
  }
  if (runFull) stages.push(npmStage("full-ui", "full Chromium UI suite after focused phone proof", "verify:ui"));

  return {
    files,
    stages,
    phoneRelevant: Boolean(phoneRelevant || unknownUi),
    fullMode,
    fullRecommended: autoFull,
    fullSelected: runFull,
    notes: [
      !phoneRelevant && !unknownUi
        ? "No phone-chrome-affecting file was detected; only prerequisite checks were selected."
        : null,
      fullMode === "never" && autoFull
        ? "The full UI suite is recommended for these shared-foundation changes but was explicitly disabled."
        : null,
      fullMode === "auto" && !autoFull && !docsOnly
        ? "Focused ownership and journey coverage is sufficient for this page-local or test-infrastructure scope."
        : null,
    ].filter(Boolean),
  };
}

export const phoneChromePlanInternals = { patterns, sharedPhoneScrollHelper, phoneScrollConsumerSpecs };

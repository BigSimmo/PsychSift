import { defineConfig, devices } from "playwright/test";
import { stableProjectPort } from "./src/lib/local-server-utils.mjs";
import { getPlaywrightBaseUrl } from "./scripts/playwright-base-url";

process.env.PORT = process.env.PORT || String(stableProjectPort(process.cwd()));

const baseURL = getPlaywrightBaseUrl({ allowEnsure: false });

// Sandboxed CI/cloud containers often ship a preinstalled Chromium and block
// browser downloads; point this at that binary instead of the managed one.
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

// Prototype /mockups journeys live in their own advisory project so a red
// mockup can never mask a production-journey regression (PT-05). The two
// Tag-level filters keep production and prototype journeys disjoint even when
// they share a spec file. Every required browser project uses the same
// production matcher and tag exclusion.
// `phone-scroll` carries an open `-<suffix>` arm: that coverage is split across
// ui-phone-scroll{,-routes,-page-owned}.spec.ts so no single file can dominate a
// `--shard` (it was 65% of shard 1 at 267s). An exact `phone-scroll` alternative
// would silently leave the siblings uncollected, so the arm is open on purpose —
// a future ui-phone-scroll-*.spec.ts runs rather than quietly not running.
// `tests/playwright-project-isolation.test.ts` asserts every such file on disk is
// matched here.
const productionSpecPattern =
  /.*(?:adaptive-answer-ui|api-csrf-proxy|answer-progress-ui-smoke|dsm-ui-smoke|ui-(admin|smoke|stress|accessibility|clinical-ask|cme-phone|dictionary|document-canvas|tools|tools-show-all|overlap|universal-search|specifiers|sources|formulation(?:-result-cards)?|forms-section-nav|chrome-scroll|therapy-nav-scroll|therapy-pathways|mode-nav-density|on-call-(?:boards|call|now|service)|teaching|patient-number-field|phone-motion|phone-scroll(?:-[a-z0-9-]+)?|pwa|roster-team|route-coverage|style-contract|token-layer-resolution|visual-artifacts|hydration|user-journeys))\.spec\.ts/;
const mockupSpecPattern =
  /.*ui-(accessible-table-mockup|answer-chat-perfected-mockup|care-plan-mockup|document-image-status-mockup|document-top-navigation-mockup|sidebar-live-mockup|therapy-navigation-mockup|tools|tools-collapse|tools-search-mode-mockup|tools-task-directory)\.spec\.ts/;
const mockupTag = /@mockup/;

// iOS never fires `beforeinstallprompt`, so `pwa-lifecycle.tsx` shows a one-time "Add to Home
// Screen" sheet to any iPhone user agent until it is dismissed. On a fresh test context that
// sheet is always up, and on a phone it sits over the home composer's send button, so every
// iPhone-project journey that typed a question and pressed Send timed out on
// "pwa-notice-stack subtree intercepts pointer events" (release-browser-matrix, 2026-09-22 on).
// A returning user who has dismissed it once is the state these journeys are about, so the two
// iPhone projects start from that state. `ui-pwa.spec.ts` resets it to prove the sheet itself.
const IOS_INSTALL_DISMISSAL_KEY = "clinical-kb-pwa-ios-install-dismissed-at";
const iosInstallHintDismissed = {
  cookies: [],
  origins: [
    {
      origin: new URL(baseURL).origin,
      localStorage: [{ name: IOS_INSTALL_DISMISSAL_KEY, value: String(Date.now()) }],
    },
  ],
};

export default defineConfig({
  testDir: "./tests",
  testMatch:
    /.*(?:adaptive-answer-ui|api-csrf-proxy|answer-progress-ui-smoke|dsm-ui-smoke|ui-(admin|accessible-table-mockup|smoke|stress|accessibility|answer-chat-perfected-mockup|care-plan-mockup|clinical-ask|cme-phone|dictionary|document-canvas|document-image-status-mockup|document-top-navigation-mockup|sidebar-live-mockup|therapy-navigation-mockup|tools|tools-collapse|tools-show-all|tools-search-mode-mockup|tools-task-directory|overlap|universal-search|specifiers|sources|formulation(?:-result-cards)?|forms-section-nav|chrome-scroll|therapy-nav-scroll|therapy-pathways|mode-nav-density|on-call-(?:boards|call|now|service)|teaching|patient-number-field|phone-motion|phone-scroll(?:-[a-z0-9-]+)?|pwa|roster-team|route-coverage|style-contract|token-layer-resolution|visual-artifacts|hydration|user-journeys))\.spec\.ts/,
  timeout: 60_000,
  retries: 0,
  // Fail the run if a stray `test.only` is committed: otherwise it silently
  // narrows CI to that one test (and skips the whole release matrix) while the
  // required check still reports green.
  forbidOnly: !!process.env.CI,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [
        ["list"],
        ["junit", { outputFile: "test-results/playwright-junit.xml" }],
        ["json", { outputFile: "test-results/playwright-results.json" }],
      ]
    : "list",
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run ensure",
        url: `${baseURL}/api/local-project-id`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  use: {
    baseURL,
    headless: process.env.CI ? true : process.env.HEADED === "true" ? false : undefined,
    trace:
      (process.env.PLAYWRIGHT_TRACE as "off" | "on" | "retain-on-failure" | "on-first-retry" | undefined) ??
      (process.env.CI ? "on-first-retry" : "retain-on-failure"),
    screenshot: "only-on-failure",
    // Dual-mode motion validation strategy (#75JA0P):
    // 1. Suite-wide baseline: set contextOptions: { reducedMotion: "reduce" } to
    //    disable CSS/web animations suite-wide so clicks cannot land mid-transition
    //    on moving targets (preventing race conditions in ui-stress/ui-smoke).
    // 2. Dual-mode per-test coverage: motion-sensitive journeys (e.g. ui-phone-motion,
    //    ui-phone-scroll, answer-progress-ui-smoke, ui-accessibility) explicitly
    //    exercise both default motion (page.emulateMedia({ reducedMotion: "no-preference" }))
    //    and reduced motion (page.emulateMedia({ reducedMotion: "reduce" })) to guarantee
    //    neither default active transitions nor reduced-motion accessibility fallbacks freeze
    //    or blank out UI elements.
    contextOptions: { reducedMotion: "reduce" },
    // Phone PWA standalone mode emulation strategy (#71NT23):
    // Validates the phone PWA bounded scroll shell (globals.css:3755-3793) by
    // allowing phone scroll journeys to emulate `display-mode: standalone` either
    // through Chromium CDP session or the forceCompiledStandalonePhoneCss fixture.
    // In production builds the PWA worker (public/sw.js) registers in every test,
    // claims the page, and serves every subsequent navigation — bypassing route
    // interception for navigations outright, and wedging Playwright-Firefox's
    // reload path under an active route (the two ui-smoke reload hangs in matrix
    // run 4012). Page routes also cannot intercept requests made by a controlling
    // service worker. Only ui-pwa.spec.ts is meant to exercise the worker; it opts
    // back in with test.use({ serviceWorkers: "allow" }).
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      testMatch: productionSpecPattern,
      grepInvert: mockupTag,
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
      },
    },
    {
      name: "chromium-mockups",
      testMatch: mockupSpecPattern,
      grep: mockupTag,
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
      },
    },
    {
      name: "firefox",
      testMatch: productionSpecPattern,
      grepInvert: mockupTag,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testMatch: productionSpecPattern,
      grepInvert: mockupTag,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-webkit",
      testMatch: productionSpecPattern,
      grepInvert: mockupTag,
      use: { ...devices["iPhone 14"], storageState: iosInstallHintDismissed },
    },
    {
      name: "mobile-pwa-standalone",
      testMatch: productionSpecPattern,
      grepInvert: mockupTag,
      use: {
        ...devices["iPhone 14"],
        storageState: iosInstallHintDismissed,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet",
      testMatch: productionSpecPattern,
      grepInvert: mockupTag,
      use: {
        ...devices["iPad Mini"],
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
});

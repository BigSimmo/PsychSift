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
  /.*(?:answer-progress-ui-smoke|dsm-ui-smoke|ui-(smoke|stress|accessibility|caring-contacts-workspace|dictionary|document-canvas|tools|ward-(?:management|coordinator|roles)|overlap|universal-search|specifiers|formulation(?:-result-cards)?|forms-section-nav|chrome-scroll|therapy-nav-scroll|mode-nav-density|phone-motion|phone-scroll(?:-[a-z0-9-]+)?|pwa|route-coverage|style-contract|visual-artifacts|hydration))\.spec\.ts/;
const mockupSpecPattern =
  /.*ui-(caring-contact-mockup|document-top-navigation-mockup|sidebar-live-mockup|therapy-navigation-mockup|tools|tools-collapse|tools-search-mode-mockup|tools-task-directory)\.spec\.ts/;
const mockupTag = /@mockup/;

export default defineConfig({
  testDir: "./tests",
  testMatch:
    /.*(?:answer-progress-ui-smoke|dsm-ui-smoke|ui-(smoke|stress|accessibility|caring-contact-mockup|caring-contacts-workspace|dictionary|document-canvas|document-top-navigation-mockup|sidebar-live-mockup|therapy-navigation-mockup|tools|tools-collapse|tools-search-mode-mockup|tools-task-directory|ward-(?:management|coordinator|roles)|overlap|universal-search|specifiers|formulation(?:-result-cards)?|forms-section-nav|chrome-scroll|therapy-nav-scroll|mode-nav-density|phone-motion|phone-scroll(?:-[a-z0-9-]+)?|pwa|route-coverage|style-contract|visual-artifacts|hydration))\.spec\.ts/,
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
  use: {
    baseURL,
    trace: "retain-on-failure",
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
  ],
});

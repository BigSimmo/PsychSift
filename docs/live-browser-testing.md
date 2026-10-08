# Live Browser Testing Architecture & Operating Guide

## Philosophy & Core Principles

PsychSift uses **Playwright** as its default end-to-end browser testing framework. The testing philosophy is governed by six principles:

1. **Playwright is the Default**
   - Cross-browser coverage across desktop Chromium, Firefox, WebKit, and mobile viewport emulations.
   - Built-in auto-waiting on elements prevents arbitrary timer sleeps.
   - Full trace viewer recording captures DOM snapshots, action logs, network traffic, and console messages for deterministic failure replay.

2. **Execution Modes: Headed Locally, Headless in CI**
   - **Local Headed**: Run with `--headed` to visually inspect interactions as they occur.
   - **Interactive UI Mode**: Run with `--ui` for interactive step-by-step debugging, time-travel scrubbing, and locator picking.
   - **CI Headless**: CI runners run headless with zero retries on blocking tests to fail fast and loudly on real regressions.
   - **Trace on Failure**: Local and CI runs default to `trace: "retain-on-failure"`, preserving diagnostics on the first failure with zero retries. `PLAYWRIGHT_TRACE` remains an explicit override.

3. **User Journeys, Not Components**
   - Avoid testing individual UI components in full browsers; React component logic and unit behaviors belong in Vitest (`*.dom.test.tsx` in jsdom).
   - Browser suites test genuine clinician user journeys:
     1. **Login & Authentication**: Guest experience, sign-in dialog, OAuth recovery.
     2. **Core Workflow**: Search query submission, synthesized answer settlement, and citation/source inspection.
     3. **Data Submission**: Interactive clinical workspaces (statutory mental health forms, safety plans, calculators).
     4. **Error States & Recovery**: 404 navigation handling and network/API failure resilience with retry mechanisms.
   - Answer submission and recovery use synthetic `/api/answer/stream` responses, require a hydrated Answer composer, and assert completed progress plus query-specific prose. Recovery requires a failed request and visible error followed by an explicit resubmission and successful new request. Negative controls reject missing submissions, failed/unfinished answers, missing resubmissions and persistent failures; no provider is needed.
   - The guest account journey opens the phone menu when present and requires one visible, hydrated guest account action before asserting the account dialog, provider grid and accessibility results. Desktop and phone projects exercise the same account boundary.
   - **Keep Volume Tight**: 5 to 15 focused tests rather than hundreds of fragmented, brittle specs.

4. **Preview Deploy + Smoke Testing**
   - Smoke tests can run directly against live hosted preview URLs (Vercel, Netlify, Railway, or staging) in pull requests.
   - Avoids spinning up local development builds on runner machines when a hosted environment is already available.

5. **Visual Regression Sparingly**
   - Full-page pixel regression across hundreds of views causes flaky CI noise from antialiasing and subpixel font rendering differences across operating systems.
   - Visual assertions are applied sparingly to 2–3 key anchor views (Core Answer view, Statutory Form view) with explicit pixel ratio tolerances (`maxDiffPixelRatio: 0.02`), animations disabled, and carets hidden.
   - High-resolution screenshots are always attached to test artifacts for visual inspection in trace reports.

6. **Accessibility Checks in the Same Run**
   - `@axe-core/playwright` runs directly inside active user journeys.
   - Zero-overhead in-flow WCAG 2.1 AA audits catch missing accessible labels, invalid roles, contrast violations, and focus traps without requiring separate accessibility test runs.

---

## Command Reference

| Command                                   | Purpose                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `npm run test:e2e:journeys`               | Run the core user journeys suite locally in Chromium                   |
| `npm run test:e2e:ui`                     | Open Playwright interactive UI mode (`--ui`) for interactive debugging |
| `npm run test:e2e:headed`                 | Run tests in headed browser mode locally                               |
| `npm run test:e2e:preview -- --url <url>` | Run smoke tests against a live Vercel/Netlify preview deployment       |
| `npm run test:e2e:accessibility`          | Run the comprehensive accessibility test suite                         |
| `npm run test:e2e:pr`                     | Run the production PR test suite locally                               |

---

## Trace Viewer Diagnostics

When a test fails locally or in CI:

1. Locate the generated trace archive in `test-results/` (e.g. `test-results/.../trace.zip`).
2. Open the trace viewer:
   ```bash
   npx playwright show-trace test-results/.../trace.zip
   ```
3. Inspect:
   - **Action timeline**: Step-by-step progression of clicks, inputs, and navigations.
   - **DOM snapshots**: Exact rendered DOM state before and after each action.
   - **Network log**: All intercepted and completed HTTP requests, responses, and latency.
   - **Console logs**: Client-side warnings, errors, and uncaught exceptions.

---

## Preview Deploy Smoke Testing

To test a preview deployment generated by Vercel, Netlify, or staging:

```bash
# Pass URL via command line flag:
npm run test:e2e:preview -- --url https://psych-sift-pr-123.vercel.app

# Or pass via environment variable:
PREVIEW_URL=https://deploy-preview-42--psychsift.netlify.app npm run test:e2e:preview
```

The dedicated preview runner bypasses local compilation and explicitly supplies `PLAYWRIGHT_BASE_URL` and `ALLOW_PREVIEW_URL=true`. Shared Playwright configuration ignores ambient `PREVIEW_URL`, `PLAYWRIGHT_PREVIEW_URL` and `VERCEL_URL`; remote targets require that explicit opt-in and an HTTPS origin without credentials, path, query or fragment. Local targets still require the matching project identity.

Synthetic answer journeys allow navigation and assets only from the configured app origin, intercept every API request there, and block other origins (including a different port). The preview-origin regression maps a reserved `.invalid` hostname to the already validated app origin: the runner-owned local app during local verification, or the explicitly approved app during preview mode. It exercises completed synthetic output and verifies that a sibling origin is blocked. Local verification contacts no hosted preview or provider.

The manual preview workflow passes its dispatch URL through `PREVIEW_URL` and a quoted shell variable. Regression checks execute the actual step with a fake npm command and confirm that shell metacharacters remain one argument rather than executing commands.

## User Journey Release Timing Records

The initial `ui-user-journeys.spec.ts` release costs come from passing provider-free Windows runs on 8 October 2026, using Node 24.19 and Playwright 1.63.0 with the installed Firefox 1543 and WebKit 2359 binaries. Each project ran the complete final 15-test spec on one worker with zero retries. Costs sum the Playwright JSON test-result durations, exclude build/server overhead, and round that observed sum to one decimal place. They are single local observations, rather than the main-artifact medians used for the older specs.

| Release project       | Passed tests | Observed seconds | Recorded cost |
| --------------------- | ------------ | ---------------- | ------------- |
| Firefox               | 15           | 39.326           | 39.3          |
| WebKit                | 15           | 53.383           | 53.4          |
| Mobile WebKit         | 15           | 52.666           | 52.7          |
| Mobile PWA standalone | 15           | 49.952           | 50.0          |

The same final spec also passed 15/15 in Chromium (26.685 seconds summed). The measured spec's SHA256 is `ccd44ac70d55b3d85d74720427bd925ea9b3d326fef7ded6ef335c2b1a9abb42`. Earlier runs exposed the hidden desktop account-control selection on phones; those failed runs are retained separately and supply no timing records. The timing table guides grouping only: spec coverage, shard-balance checks, assertions and zero-retry policy remain intact.

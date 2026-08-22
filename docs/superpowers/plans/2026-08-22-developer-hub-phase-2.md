# Developer hub Phase 2 (repo awareness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the developer hub's four `phase: 2` panels — routes, documentation, test health, and review state — from one build-time snapshot of data the repository already keeps on disk.

**Architecture:** One TypeScript generator reads four existing sources (the site-map route walker plus `src/lib/app-modes.ts`, the `docs/` tree, `tests/flake-ledger.json`, and `docs/branch-review-records/`) and writes a single committed `data/repo-awareness-snapshot.json`. One staleness gate regenerates it in memory and fails with the fix command on any content difference. One typed reader imports that JSON so the bundler inlines it, and four Server Component routes render it under the existing `DeveloperAreaGate`. Nothing reads a file at request time, and nothing calls a network.

**Tech Stack:** Next.js 16 App Router (React 19 Server Components), TypeScript 6 strict, Vitest (`node` + `jsdom` projects), Tailwind 4 `@theme` tokens, `tsx` via `scripts/run-tsx.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-22-developer-hub-phase-2-design.md`

**Phase 1 record** (context, not requirements): `docs/superpowers/plans/2026-08-21-developer-hub-phase-1-COMPLETION.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Never read a file at request time.** The runtime Docker stage copies only `.next`, `public`, `node_modules`, four named source files, `package.json` and `next.config.ts`. `docs/` and `data/` are absent in production. Data reaches a page by `import`ing a JSON file so the bundler inlines it — never by `readFile`.
- **Pages under the development route tree are Server Components.** No `"use client"` on a page. A component that attaches an event handler needs `"use client"` as its own first line; a Server Component must never import _data_ from a `"use client"` module, because Next replaces such an export with a client-reference proxy that has no array methods. Both classes shipped past every gate in Phase 1.
- **`npm run build` is a mandatory acceptance gate, not an optional extra.** It is the only gate that catches a Server Component reading data from a client module. These routes are Dynamic, so the build does _not_ catch a serialised handler — that needs a live request.
- **The snapshot must be byte-deterministic.** No `generated_at`, no `Date.now()`, no value derived from the current time. Anything time-relative (has a quarantine expired?) is computed at render time, never stored. A non-deterministic field makes the staleness gate fail on every run, and a gate that cries wolf stops being a gate.
- **No silent row-dropping.** A malformed input fails the generator loudly and names the file. A value the renderer does not recognise is rendered as it stands under its own heading, never discarded — a page that quietly under-reports is the `#338` failure this feature exists to prevent.
- **An empty section says so in words.** "No tests are quarantined" — never a blank container, which is indistinguishable from a load failure.
- **Counts are computed once by the generator** and rendered as given, so a count and its own list cannot disagree.
- **Design tokens only.** `text-[color:var(--text-heading)]`, `border-[color:var(--border)]`, and friends. No hex literals — `eslint-rules/no-hardcoded-hex.mjs` fails the build. Tap targets are `min-h-12`; never "fix" them down to `min-h-11`.
- **Every `<button>` is wired.** A handler, a submit inside a form, or navigation. Unavailable-for-a-stated-reason uses `aria-disabled="true"` + `ignoreUnavailableActivation` + `title="… — coming soon"` + an `sr-only` note. Never native `disabled` together with `aria-disabled`.
- **Internal navigation uses `<Link>`**, never a raw anchor to an internal route.
- **Production modules must not import mockup modules.** `eslint.config.mjs` fences `src/**` off from `**/*mockup*`. A route literal plus a test that pins it is the sanctioned workaround (see `hub-panels.ts`).
- **No live GitHub read, no Supabase read, no write path.** The hub is read-only. Mutating repository state stays a command.

### Verification commands (exact)

Implementers run the **filtered** forms below, which take a shared run-coordinator lease. The controller runs the exclusive whole-suite gates.

```bash
npm run test -- tests/<file>
```

```bash
npm run typecheck:source
```

```bash
npm run lint
```

Six standing rules for every implementer:

1. Pass an explicit Bash `timeout` of `600000`. The 120 s default silently backgrounds the command and ends the turn.
2. Use `npm run test`, never `npm run test:focused`, on any task that adds a test file — `test:focused` fails closed on new test infrastructure.
3. Never pipe a gate through `tail`, `head`, or `grep`. A pipeline exits with its last command's status, so a failing gate reports success.
4. Run `npm run typecheck:source` as well as the tests. Vitest does not typecheck.
5. Never force the run-coordinator lock. "capacity is full" / "heavyweight command is active" means queue and retry, not failure.
6. Run `git rev-parse --abbrev-ref HEAD` before every commit and confirm it is this task's branch.

### Known-failing baseline — do not chase

`tests/codex-cloud-setup.test.ts` (2 failures) and `tests/design-sync-contract.test.ts` (1 failure) fail in this environment for reasons unrelated to this work.

---

## Rulings carried into this plan

Recorded so a reviewer can overturn them. Each answers something the spec left open or asserted loosely.

| #   | Ruling                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **The hub renders facts no green gate already guarantees.** This settles spec open question 2 (orphan routes: **no**) and the broken-links half of the documentation panel (**no**). `tests/route-reachability.test.ts` and `npm run docs:check-links` already guarantee both are zero; re-displaying a guaranteed zero teaches a reader nothing. |
| R2  | Following from R1, **`reachable` and `broken_links` leave the spec's data contract.** Neither was derivable without extracting a ~400-line AST walker out of a protected test, or refactoring a CI gate script that exports nothing today. Both are risk with no reader-facing payoff.                                                            |
| R3  | **Spec open question 3 (document age): no.** Per-document git dates would need a per-row preservation mechanism for the no-git case that Phase 1's single-field pattern does not cover, cost an 8.7 s `git log` walk on every generate _and_ every gate run, and invite rot inferences no policy backs. Dropped.                                  |
| R4  | **What replaces document age is `catalogued`.** `docs/README.md` says of itself that it is "not an exhaustive listing of every file". Which documents exist on disk but are absent from that curated index is a real, actionable, ungated fact — exactly what R1 asks a panel to show.                                                            |
| R5  | **The generator is wired into `docs:update` only, never `prebuild`.** `docs/site-map.md` is the precedent: generated, committed, verified by a `check:` gate, never regenerated at build. This keeps `tsx` off the Docker build path and removes the git-absent-in-Docker problem at its source rather than mitigating it.                        |
| R6  | **`expired` is not stored.** It is date arithmetic against `expires`, so storing it would break byte-determinism and fail the gate daily. Computed at render.                                                                                                                                                                                     |
| R7  | **Review outcomes are not classified.** Counting "approved" would mean string-matching free prose written by many different sessions. The panel reports total records and distinct refs, and renders each outcome verbatim.                                                                                                                       |
| R8  | **`FreshnessStamp` is less generic than the spec assumed.** Its copy is hardcoded to "Ledger content as of …". Task 1 adds an optional `label` defaulting to `"Ledger"`, so Phase 1 is untouched.                                                                                                                                                 |
| R9  | **The registry entry keeps `id: "work-in-flight"`** while its `name` becomes "Review state", per the owner's decision in spec §4.1. The id is the Phase 1 extension mechanism; renaming it would be churn with a test to update and nothing gained.                                                                                               |

---

## Data contract

`data/repo-awareness-snapshot.json`, generated and committed:

```json
{
  "version": "repo-awareness-snapshot-v1",
  "captured_revision": { "sha": "<40-char>", "committed_at": "<ISO 8601>" },
  "routes": {
    "modes": [{ "id": "answer", "label": "Answer", "home": "/", "dev_only": false }],
    "pages": [{ "path": "/dsm", "file": "src/app/(search-app)/dsm/page.tsx", "area": "product" }],
    "redirects": [{ "path": "/tools", "file": "src/app/tools/page.tsx", "target": "/" }],
    "api": [{ "path": "/api/answer", "file": "src/app/api/answer/route.ts" }],
    "counts": { "modes": 15, "pages": 0, "product_pages": 0, "mockup_pages": 0, "redirects": 0, "api": 0 }
  },
  "documentation": {
    "documents": [{ "path": "docs/testing.md", "section": "root", "catalogued": true }],
    "sections": [{ "name": "root", "documents": 0, "uncatalogued": 0 }],
    "counts": { "documents": 0, "catalogued": 0, "uncatalogued": 0, "sections": 0 }
  },
  "test_health": {
    "note": "The ledger is intentionally empty after stale entries were removed.",
    "quarantined": [
      {
        "id": "…",
        "spec": "tests/ui-smoke.spec.ts",
        "title": "…@quarantine",
        "reason": "…",
        "first_seen": "2026-08-01",
        "last_seen": "2026-08-03",
        "expires": "2026-09-01"
      }
    ],
    "counts": { "quarantined": 0 }
  },
  "review_state": {
    "records": [
      {
        "date": "2026-08-15",
        "ref": "claude/…",
        "head": "<40-char>",
        "scope": "…",
        "outcome": "…",
        "checks": "…"
      }
    ],
    "counts": { "records": 454, "refs": 0 }
  }
}
```

Rules, each inherited from a Phase 1 lesson rather than invented:

- `version` is checked at read time. A mismatch throws; it never degrades to a partial render.
- **No `generated_at`**, and no `expired` (R6).
- `captured_revision` is the last commit touching the generator's own inputs, never `HEAD` — dating the snapshot by its inputs can only understate freshness, which is the safe direction. Git is a hard requirement and the generator fails loudly without it; ruling R5 is what makes that safe.
- Every array is sorted deterministically by the generator, so a filesystem or git ordering change cannot make the gate fire spuriously.

---

## File Structure

**Created**

| Path                                                     | Responsibility                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/lib/developer-area/freshness.ts`                    | The `Freshness` type and the label-agnostic `resolveFreshnessFrom` helper.    |
| `scripts/generate-repo-awareness-snapshot.ts`            | The generator: four section builders, revision resolution, CLI entry.         |
| `scripts/check-repo-awareness-snapshot.ts`               | The staleness gate: regenerate in memory, compare content keys, name the fix. |
| `src/lib/developer-area/repo-awareness-snapshot.ts`      | Typed reader: version check, section selectors, render-time expiry.           |
| `src/components/developer-area/hub/panel-page-shell.tsx` | Shared back-link + title + freshness header for every developer sub-page.     |
| `src/app/mockups/development/routes/page.tsx`            | Routes and modes panel.                                                       |
| `src/app/mockups/development/documentation/page.tsx`     | Documentation panel.                                                          |
| `src/app/mockups/development/test-health/page.tsx`       | Test health panel.                                                            |
| `src/app/mockups/development/review-state/page.tsx`      | Review state panel.                                                           |
| `data/repo-awareness-snapshot.json`                      | Generated, committed.                                                         |
| `tests/repo-awareness-generator.test.ts`                 | Section builders and revision preservation.                                   |
| `tests/repo-awareness-gate.test.ts`                      | `compareSnapshots` behaviour.                                                 |
| `tests/repo-awareness-snapshot.test.ts`                  | Reader: version throw, selectors, expiry.                                     |
| `tests/developer-panel-page-shell.dom.test.tsx`          | The shared shell, including its freshness label.                              |
| `tests/developer-routes-page.dom.test.tsx`               | Routes page.                                                                  |
| `tests/developer-documentation-page.dom.test.tsx`        | Documentation page.                                                           |
| `tests/developer-test-health-page.dom.test.tsx`          | Test health page, including the empty state.                                  |
| `tests/developer-review-state-page.dom.test.tsx`         | Review state page.                                                            |

**Modified**

| Path                                                    | Change                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/lib/developer-area/ledger-snapshot.ts`             | Re-export `Freshness`; `resolveFreshness` delegates to the new helper.        |
| `src/components/developer-area/hub/freshness-stamp.tsx` | Optional `label` prop, defaulting to `"Ledger"`.                              |
| `src/app/mockups/development/ledger/page.tsx`           | Adopts the extracted `PanelPageShell` in place of its inline header.          |
| `src/lib/developer-area/hub-panels.ts`                  | Four entries flip to `phase: 1` with hrefs; `work-in-flight` renamed.         |
| `package.json`                                          | `snapshot:repo-awareness` and `check:repo-awareness-snapshot`; `docs:update`. |
| `docs/codebase-index.md`                                | Entries for the generator, gate, reader, shell, and four routes.              |
| `docs/site-map.md`                                      | Regenerated by `npm run docs:update`.                                         |
| `tests/developer-hub-panels.test.ts`                    | Registry assertions for the flipped entries and the rename.                   |

**Deliberately unchanged**

- `src/lib/developer-area/headers.ts` — `DEVELOPER_GATED_PATH_PREFIXES` already contains `/mockups/development`, and the gate matches by prefix, so all four new routes inherit it with no edit.
- `src/components/mode-nav/header-addon-slot.ts` — the four pages use the ledger page's plain back-link header, not `InPageNavHeader`, so none of them claims the header addon slot.

---

### Task 1: Shared freshness helper and a labelled stamp

`FreshnessStamp` reads "Ledger content as of …" in hardcoded copy, so four new pages would each claim to be showing the ledger. Give it a label, and lift the `Freshness` type out of the ledger-specific module so a second snapshot can use it without importing ledger code.

Also extract the header the ledger page already renders — back link, title, stamp — so the four new pages cannot each invent their own.

**Files:**

- Create: `src/lib/developer-area/freshness.ts`
- Create: `src/components/developer-area/hub/panel-page-shell.tsx`
- Create: `tests/developer-panel-page-shell.dom.test.tsx`
- Modify: `src/lib/developer-area/ledger-snapshot.ts`
- Modify: `src/components/developer-area/hub/freshness-stamp.tsx`
- Modify: `src/app/mockups/development/ledger/page.tsx`

**Interfaces:**

- Consumes: `LedgerSnapshot` from `@/lib/developer-area/ledger-snapshot` (existing).
- Produces:
  - `type Freshness = { contentAt: string | null; viewedAt: string; ageHours: number | null }` from `@/lib/developer-area/freshness`
  - `resolveFreshnessFrom(contentAt: string | null, now: Date): Freshness`
  - `<FreshnessStamp freshness={…} label?: string />` — `label` defaults to `"Ledger"`
  - `<PanelPageShell testId={…} title={…} freshness={…} freshnessLabel?={…}>{children}</PanelPageShell>`

- [ ] **Step 1: Write the failing tests**

Create `tests/developer-panel-page-shell.dom.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FreshnessStamp } from "@/components/developer-area/hub/freshness-stamp";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { resolveFreshnessFrom } from "@/lib/developer-area/freshness";

const NOW = new Date("2026-08-22T12:00:00.000Z");

describe("resolveFreshnessFrom", () => {
  it("reports the age in whole hours", () => {
    const freshness = resolveFreshnessFrom("2026-08-22T09:00:00.000Z", NOW);
    expect(freshness.contentAt).toBe("2026-08-22T09:00:00.000Z");
    expect(freshness.viewedAt).toBe(NOW.toISOString());
    expect(freshness.ageHours).toBe(3);
  });

  it("returns a null age for a missing content date", () => {
    expect(resolveFreshnessFrom(null, NOW).ageHours).toBeNull();
  });

  it("returns a null age for an unparseable content date rather than NaN", () => {
    // A NaN age reaching the stamp would render "NaN hours old" beside a
    // confident-looking timestamp, which is the one thing the stamp exists to
    // prevent. Guard here, not only in the formatter.
    expect(resolveFreshnessFrom("not-a-date", NOW).ageHours).toBeNull();
  });
});

describe("FreshnessStamp label", () => {
  it("says Ledger when no label is given, so Phase 1 is unchanged", () => {
    render(<FreshnessStamp freshness={resolveFreshnessFrom("2026-08-22T09:00:00.000Z", NOW)} />);
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Ledger content as of/);
  });

  it("uses the given label in both the known and unknown branches", () => {
    const { unmount } = render(
      <FreshnessStamp freshness={resolveFreshnessFrom("2026-08-22T09:00:00.000Z", NOW)} label="Repository" />,
    );
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository content as of/);
    unmount();

    render(<FreshnessStamp freshness={resolveFreshnessFrom(null, NOW)} label="Repository" />);
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository revision unknown/);
  });
});

describe("PanelPageShell", () => {
  it("renders a titled main, a back link to the hub, and the stamp", () => {
    render(
      <PanelPageShell
        testId="developer-routes"
        title="Routes and modes"
        freshness={resolveFreshnessFrom("2026-08-22T09:00:00.000Z", NOW)}
        freshnessLabel="Repository"
      >
        <p>body</p>
      </PanelPageShell>,
    );

    expect(screen.getByTestId("developer-routes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Routes and modes" })).toBeInTheDocument();
    const back = screen.getByTestId("developer-routes-back");
    expect(back).toHaveAttribute("href", "/mockups/development");
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository content as of/);
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/developer-panel-page-shell.dom.test.tsx`
Expected: FAIL — cannot resolve `@/lib/developer-area/freshness` and `@/components/developer-area/hub/panel-page-shell`.

- [ ] **Step 3: Create the freshness module**

Create `src/lib/developer-area/freshness.ts`:

```ts
/**
 * Deliberately free of any one snapshot's shape. Phase 1 kept this type inside
 * `ledger-snapshot.ts`, which made a second snapshot import ledger code to
 * describe its own age.
 */
export type Freshness = { contentAt: string | null; viewedAt: string; ageHours: number | null };

/**
 * `ageHours` is null for a missing OR unparseable content date. A NaN age would
 * reach `FreshnessStamp` and render "NaN hours old" — a confident-looking stamp
 * carrying no information, which is the failure that component exists to
 * prevent.
 */
export function resolveFreshnessFrom(contentAt: string | null, now: Date): Freshness {
  const viewedAt = now.toISOString();
  if (contentAt === null) return { contentAt, viewedAt, ageHours: null };
  const parsed = new Date(contentAt);
  if (Number.isNaN(parsed.getTime())) return { contentAt, viewedAt, ageHours: null };
  return { contentAt, viewedAt, ageHours: Math.round((now.getTime() - parsed.getTime()) / 3_600_000) };
}
```

- [ ] **Step 4: Delegate from the ledger reader**

In `src/lib/developer-area/ledger-snapshot.ts`, add the import at the top of the import block:

```ts
import { resolveFreshnessFrom, type Freshness } from "./freshness";
```

Replace the `Freshness` type declaration and `resolveFreshness` body with:

```ts
export type { Freshness };

export function resolveFreshness(snapshot: LedgerSnapshot, now: Date): Freshness {
  return resolveFreshnessFrom(snapshot.ledger_revision?.committed_at ?? null, now);
}
```

- [ ] **Step 5: Add the label to the stamp**

In `src/components/developer-area/hub/freshness-stamp.tsx`, change the import to
`import type { Freshness } from "@/lib/developer-area/freshness";`, then change the
signature and the two copy branches:

```tsx
/**
 * Unconditional by design. There is no "fresh" short-circuit that could
 * suppress it — a page that can hide its own age is the `#338` defect.
 *
 * `label` names what the content date belongs to. It defaults to "Ledger" so
 * every Phase 1 call site is unchanged; a page rendering a different snapshot
 * must pass its own, or it will claim to be showing the task ledger.
 */
export function FreshnessStamp({ freshness, label = "Ledger" }: { freshness: Freshness; label?: string }) {
```

```tsx
          {label} content as of {contentAt}
```

```tsx
<span>
  {label} revision unknown{viewedAt ? ` · viewed ${viewedAt}` : ""}
</span>
```

- [ ] **Step 6: Create the shared shell**

Create `src/components/developer-area/hub/panel-page-shell.tsx`:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { FreshnessStamp } from "@/components/developer-area/hub/freshness-stamp";
import type { Freshness } from "@/lib/developer-area/freshness";

/**
 * No `"use client"`: this renders a `<Link>` and static markup, no handlers. A
 * needless client boundary here would pull every child into the client bundle.
 */
export function PanelPageShell({
  testId,
  title,
  freshness,
  freshnessLabel,
  children,
}: {
  testId: string;
  title: string;
  freshness: Freshness;
  freshnessLabel?: string;
  children: ReactNode;
}) {
  return (
    <main data-testid={testId} className="mx-auto grid w-full max-w-[64rem] gap-6 px-4 py-8 sm:px-6">
      <Link
        data-testid={`${testId}-back`}
        href="/mockups/development"
        className="inline-flex min-h-12 w-fit items-center gap-2 text-sm font-bold text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        <ArrowLeft aria-hidden="true" className="size-icon-sm" />
        Developer hub
      </Link>

      <h1 className="text-2xl font-extrabold text-[color:var(--text-heading)]">{title}</h1>

      {/*
       * Unconditional, and directly under the title. Every number below is read
       * from a snapshot committed at build time, so the one thing a reader must
       * never have to guess is how old it is.
       */}
      <FreshnessStamp freshness={freshness} label={freshnessLabel} />

      {children}
    </main>
  );
}
```

- [ ] **Step 7: Adopt the shell in the ledger page**

In `src/app/mockups/development/ledger/page.tsx`, delete the `Link`, `ArrowLeft` and
`FreshnessStamp` imports and add `import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";`.
Replace the opening `<main …>` element, the back `<Link>`, the `<h1>` and the
`<FreshnessStamp …/>` with a single opening tag, and the closing `</main>` with
`</PanelPageShell>`:

```tsx
  return (
    <PanelPageShell testId="developer-ledger" title="Task ledger" freshness={freshness}>
```

Leave every other element, test id and comment exactly as it is. `developer-ledger`
and `developer-ledger-back` keep their ids, so `tests/developer-ledger-page.dom.test.tsx`
proves the swap changed nothing.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test -- tests/developer-panel-page-shell.dom.test.tsx tests/developer-ledger-page.dom.test.tsx tests/developer-hub-components.dom.test.tsx tests/developer-ledger-snapshot.test.ts`
Expected: PASS, all four files. The three existing files are the regression proof for the extraction.

Run: `npm run typecheck:source`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/lib/developer-area/freshness.ts src/lib/developer-area/ledger-snapshot.ts src/components/developer-area/hub/freshness-stamp.tsx src/components/developer-area/hub/panel-page-shell.tsx src/app/mockups/development/ledger/page.tsx tests/developer-panel-page-shell.dom.test.tsx
git commit -m "refactor(developer-hub): label the freshness stamp and share the panel page shell"
```

---

### Task 2: Generator skeleton and the routes section

The snapshot's shape is described **once**, in `src/lib/developer-area/repo-awareness-types.ts`. The generator imports those types through the `@/` alias — exactly as `scripts/generate-site-map.ts` already imports `@/lib/app-modes` — and the reader in Task 8 imports the same file. A types module with no JSON import can exist before the JSON does, which is why it is separate from the reader.

**Files:**

- Create: `src/lib/developer-area/repo-awareness-types.ts`
- Create: `scripts/generate-repo-awareness-snapshot.ts`
- Create: `tests/repo-awareness-generator.test.ts`

**Interfaces:**

- Consumes: `collectSiteMapData()` from `./generate-site-map` (returns `{ pageRoutes, publicRouteHandlers, apiRoutes, redirects, nonRoutedMockupArtifacts }`, where a route is `{ route: string; file: string }` and a redirect is `{ route, file, target }`); `appModeDefinitions` and `appModeHomeHref` from `@/lib/app-modes`.
- Produces: from `@/lib/developer-area/repo-awareness-types` — `REPO_AWARENESS_SNAPSHOT_VERSION`, `type RouteArea`, `type RoutesSection`. From the generator — `buildRoutesSection(siteMap?: SiteMapInput): RoutesSection`, `type SiteMapInput`, `OUTPUT_PATH`.

- [ ] **Step 1: Write the failing test**

Create `tests/repo-awareness-generator.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { appModeDefinitions } from "@/lib/app-modes";
import { buildRoutesSection, type SiteMapInput } from "../scripts/generate-repo-awareness-snapshot";

const SITE_MAP: SiteMapInput = {
  pageRoutes: [
    { route: "/dsm", file: "src/app/(search-app)/dsm/page.tsx" },
    { route: "/mockups/development", file: "src/app/mockups/development/page.tsx" },
    { route: "/tools", file: "src/app/tools/page.tsx" },
  ],
  apiRoutes: [{ route: "/api/answer", file: "src/app/api/answer/route.ts" }],
  redirects: [{ route: "/tools", file: "src/app/tools/page.tsx", target: "/" }],
};

describe("buildRoutesSection", () => {
  it("separates product pages from mockup pages", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.pages).toEqual([
      { path: "/dsm", file: "src/app/(search-app)/dsm/page.tsx", area: "product" },
      { path: "/mockups/development", file: "src/app/mockups/development/page.tsx", area: "mockup" },
    ]);
  });

  it("moves a redirect out of pages so it is listed once, under redirects", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.pages.map((page) => page.path)).not.toContain("/tools");
    expect(section.redirects).toEqual([{ path: "/tools", file: "src/app/tools/page.tsx", target: "/" }]);
  });

  it("carries every app mode with a home href", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.modes).toHaveLength(appModeDefinitions.length);
    for (const mode of section.modes) {
      expect(mode.home).toMatch(/^\//);
      expect(mode.label.length).toBeGreaterThan(0);
      expect(typeof mode.dev_only).toBe("boolean");
    }
  });

  it("computes counts from the arrays it emits, so a count cannot disagree with its list", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.counts).toEqual({
      modes: section.modes.length,
      pages: 2,
      product_pages: 1,
      mockup_pages: 1,
      redirects: 1,
      api: 1,
    });
  });

  it("sorts every array by path so filesystem ordering cannot make the gate fire", () => {
    const shuffled: SiteMapInput = {
      ...SITE_MAP,
      pageRoutes: [...SITE_MAP.pageRoutes].reverse(),
      apiRoutes: [{ route: "/api/zeta", file: "z.ts" }, ...SITE_MAP.apiRoutes],
    };
    const section = buildRoutesSection(shuffled);
    expect(section.pages.map((page) => page.path)).toEqual(["/dsm", "/mockups/development"]);
    expect(section.api.map((route) => route.path)).toEqual(["/api/answer", "/api/zeta"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: FAIL — cannot resolve `../scripts/generate-repo-awareness-snapshot`.

- [ ] **Step 3: Create the shared types module**

Create `src/lib/developer-area/repo-awareness-types.ts`:

```ts
/**
 * The snapshot's shape, described once.
 *
 * It lives in `src/lib` rather than in the generator so that both the generator
 * (`scripts/generate-repo-awareness-snapshot.ts`, via the `@/` alias) and the
 * Server Component reader (`repo-awareness-snapshot.ts`) bind to the same
 * definition. Two hand-kept copies would drift, and the drift would be a
 * mis-rendered page rather than a compile error.
 *
 * No value imports here, and in particular no `import` of the generated JSON:
 * the types must be usable before the JSON file exists.
 */
export const REPO_AWARENESS_SNAPSHOT_VERSION = "repo-awareness-snapshot-v1";

export type RouteArea = "product" | "mockup";

export type RoutesSection = {
  modes: { id: string; label: string; home: string; dev_only: boolean }[];
  pages: { path: string; file: string; area: RouteArea }[];
  redirects: { path: string; file: string; target: string }[];
  api: { path: string; file: string }[];
  counts: {
    modes: number;
    pages: number;
    product_pages: number;
    mockup_pages: number;
    redirects: number;
    api: number;
  };
};
```

Later tasks append `DocumentationSection`, `TestHealthSection`, `ReviewStateSection` and
`RepoAwarenessSnapshot` to this same file.

- [ ] **Step 4: Write the generator skeleton and the routes builder**

Create `scripts/generate-repo-awareness-snapshot.ts`:

```ts
import { appModeDefinitions, appModeHomeHref } from "@/lib/app-modes";
import {
  REPO_AWARENESS_SNAPSHOT_VERSION,
  type RouteArea,
  type RoutesSection,
} from "@/lib/developer-area/repo-awareness-types";

import { collectSiteMapData } from "./generate-site-map";

export const SNAPSHOT_VERSION = REPO_AWARENESS_SNAPSHOT_VERSION;
export const OUTPUT_PATH = "data/repo-awareness-snapshot.json";

/**
 * Only the parts of `collectSiteMapData()`'s return value this generator reads.
 * Declared structurally rather than imported, because `generate-site-map.ts`
 * does not export its `SiteMapData` type — and narrowing here also lets a test
 * build a three-route fixture instead of walking the whole app directory.
 */
export type SiteMapInput = {
  pageRoutes: readonly { route: string; file: string }[];
  apiRoutes: readonly { route: string; file: string }[];
  redirects: readonly { route: string; file: string; target: string }[];
};

function byPath<T extends { path: string }>(left: T, right: T) {
  return left.path.localeCompare(right.path);
}

export function buildRoutesSection(siteMap: SiteMapInput = collectSiteMapData()): RoutesSection {
  // A redirect route is discovered from the page routes, so it appears in both
  // lists. Listing it in `pages` as well would double-count it and tell the
  // reader a redirect stub is a page they can visit.
  const redirectPaths = new Set(siteMap.redirects.map((redirect) => redirect.route));

  const pages = siteMap.pageRoutes
    .filter((route) => !redirectPaths.has(route.route))
    .map((route) => ({
      path: route.route,
      file: route.file,
      area: (route.route.startsWith("/mockups") ? "mockup" : "product") as RouteArea,
    }))
    .sort(byPath);

  const redirects = siteMap.redirects
    .map((redirect) => ({ path: redirect.route, file: redirect.file, target: redirect.target }))
    .sort(byPath);

  const api = siteMap.apiRoutes.map((route) => ({ path: route.route, file: route.file })).sort(byPath);

  const modes = appModeDefinitions
    .map((mode) => ({
      id: mode.id,
      label: mode.label,
      home: appModeHomeHref(mode.id),
      // Some modes are hidden outside development. That is a fact about the
      // product surface a reader of this panel needs, and it is not visible
      // from the route list alone.
      dev_only: "devOnly" in mode && mode.devOnly === true,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    modes,
    pages,
    redirects,
    api,
    counts: {
      modes: modes.length,
      pages: pages.length,
      product_pages: pages.filter((page) => page.area === "product").length,
      mockup_pages: pages.filter((page) => page.area === "mockup").length,
      redirects: redirects.length,
      api: api.length,
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: PASS, 5 tests.

Run: `npm run typecheck:source`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/developer-area/repo-awareness-types.ts scripts/generate-repo-awareness-snapshot.ts tests/repo-awareness-generator.test.ts
git commit -m "feat(developer-hub): build the routes section of the repo awareness snapshot"
```

---

### Task 3: Documentation section

Which documents exist, where they live, and which are absent from the curated index in `docs/README.md` — which says of itself that it is "not an exhaustive listing of every file". That gap is the ungated, actionable fact this panel exists to show (ruling R4). Document age is deliberately absent (ruling R3), and broken links are deliberately absent because `npm run docs:check-links` already guarantees there are none (ruling R1).

**Files:**

- Modify: `scripts/generate-repo-awareness-snapshot.ts`
- Modify: `tests/repo-awareness-generator.test.ts`

**Interfaces:**

- Produces: `type DocumentationSection`, `buildDocumentationSection(docPaths: readonly string[], readmeMarkdown: string): DocumentationSection`, `listDocumentPaths(): string[]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/repo-awareness-generator.test.ts`:

```ts
import { buildDocumentationSection } from "../scripts/generate-repo-awareness-snapshot";

const README = `
# Clinical KB Documentation Index

- [testing.md](testing.md) — how tests run
- [design-system/SPEC.md](design-system/SPEC.md) — the design system
- [an external link](https://example.com/testing.md) — not a repo doc
Referenced in prose as \`docs/rag-behaviour/README.md\` too.
`;

const DOC_PATHS = [
  "docs/testing.md",
  "docs/design-system/SPEC.md",
  "docs/design-system/GATES.md",
  "docs/rag-behaviour/README.md",
  "docs/uncatalogued.md",
];

describe("buildDocumentationSection", () => {
  it("marks a document catalogued when README links it relative to docs/", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    const byPath = new Map(section.documents.map((document) => [document.path, document]));
    expect(byPath.get("docs/testing.md")?.catalogued).toBe(true);
    expect(byPath.get("docs/design-system/SPEC.md")?.catalogued).toBe(true);
  });

  it("marks a document catalogued when README names its full repo path in prose", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    expect(section.documents.find((document) => document.path === "docs/rag-behaviour/README.md")?.catalogued).toBe(
      true,
    );
  });

  it("marks a document uncatalogued when README never names it", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    expect(section.documents.find((document) => document.path === "docs/uncatalogued.md")?.catalogued).toBe(false);
    expect(section.documents.find((document) => document.path === "docs/design-system/GATES.md")?.catalogued).toBe(
      false,
    );
  });

  it("is not fooled by a repository URL that contains a doc path", () => {
    // Removing the URL strip in `catalogueTargets` makes this red: the bare
    // regex would match `docs/only-external.md` inside the blob URL and mark a
    // document catalogued that the index never lists.
    //
    // The earlier version of this test used `https://example.com/only-external.md`
    // and could never fail — `path.posix.join("docs", "https://…")` normalises to
    // `docs/https:/example.com/…`, which never equals `docs/only-external.md`, so
    // it passed with the guard deleted.
    const readme = "See the source at https://github.com/BigSimmo/Database/blob/main/docs/only-external.md for detail.";
    const section = buildDocumentationSection(["docs/only-external.md"], readme);
    expect(section.documents[0].catalogued).toBe(false);
    expect(section.counts.uncatalogued).toBe(1);
  });

  it("still catalogues a document named in ordinary prose", () => {
    // The guard against URLs must not cost us the real prose case, which is the
    // reason the second scan exists at all.
    const section = buildDocumentationSection(["docs/testing.md"], "Read `docs/testing.md` before changing a test.");
    expect(section.documents[0].catalogued).toBe(true);
  });

  it("assigns a section from the first directory under docs/, or root", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    const sections = new Map(section.documents.map((document) => [document.path, document.section]));
    expect(sections.get("docs/testing.md")).toBe("root");
    expect(sections.get("docs/design-system/SPEC.md")).toBe("design-system");
  });

  it("summarises each section and computes counts from its own arrays", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    expect(section.sections).toEqual([
      { name: "design-system", documents: 2, uncatalogued: 1 },
      { name: "rag-behaviour", documents: 1, uncatalogued: 0 },
      { name: "root", documents: 2, uncatalogued: 1 },
    ]);
    expect(section.counts).toEqual({ documents: 5, catalogued: 3, uncatalogued: 2, sections: 3 });
  });

  it("sorts documents by path so listing order cannot make the gate fire", () => {
    const section = buildDocumentationSection([...DOC_PATHS].reverse(), README);
    expect(section.documents.map((document) => document.path)).toEqual([...DOC_PATHS].sort());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: FAIL — `buildDocumentationSection` is not exported.

- [ ] **Step 3: Add the type to the shared types module**

Append to `src/lib/developer-area/repo-awareness-types.ts`:

```ts
export type DocumentationSection = {
  documents: { path: string; section: string; catalogued: boolean }[];
  sections: { name: string; documents: number; uncatalogued: number }[];
  counts: { documents: number; catalogued: number; uncatalogued: number; sections: number };
};
```

- [ ] **Step 4: Implement the documentation builder**

Append to `scripts/generate-repo-awareness-snapshot.ts`; add
`import { execFileSync } from "node:child_process";` and `import path from "node:path";`
to the import block, and add `type DocumentationSection` to the existing
`@/lib/developer-area/repo-awareness-types` import:

```ts
const DOCS_ROOT = "docs";
export const README_PATH = "docs/README.md";

/**
 * Review records get their own panel and would otherwise be 455 of the ~280
 * rows here, drowning the documents a reader is actually looking for. Inbox
 * requests are JSON transactions, not documents.
 */
const EXCLUDED_DOC_PREFIXES = ["docs/branch-review-records/", "docs/outstanding-issues-inbox/"];

/**
 * Tracked files only. Walking the filesystem would list a developer's untracked
 * scratch notes, and the staleness gate would then fail on a clean tree for
 * everyone but that developer — a gate that fires when nothing is wrong.
 */
export function listDocumentPaths(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", DOCS_ROOT], { encoding: "utf8" });
  return output
    .split("\0")
    .filter((entry) => entry.endsWith(".md"))
    .filter((entry) => !EXCLUDED_DOC_PREFIXES.some((prefix) => entry.startsWith(prefix)));
}

function documentSection(repoPath: string): string {
  // "docs/a.md" -> root; "docs/design-system/SPEC.md" -> design-system.
  const segments = repoPath.split("/");
  return segments.length > 2 ? segments[1] : "root";
}

/**
 * Every repo-relative doc path `docs/README.md` refers to, by either route it
 * uses: a markdown link written relative to `docs/`, or a full `docs/…` path
 * named in prose or a code span.
 *
 * An `http(s)://` URL is stripped before EITHER scan runs. Both scans look for
 * a `docs/…md` substring, and a URL can contain one —
 * `https://github.com/BigSimmo/Database/blob/main/docs/some-doc.md` would
 * otherwise mark that document catalogued when the index never listed it.
 * That is a suppressed finding in the one column this panel exists to report,
 * and a blob link is a very plausible edit to a docs index.
 */
function catalogueTargets(readmeMarkdown: string): Set<string> {
  const targets = new Set<string>();
  const withoutUrls = readmeMarkdown.replace(/https?:\/\/\S+/g, " ");

  for (const match of withoutUrls.matchAll(/\]\(([^)\s#]+)/g)) {
    const target = match[1];
    // The strip above does not cover these two: an absolute repo path is not a
    // URL, and an anchor is not a document.
    if (target.startsWith("/") || target.startsWith("#")) continue;
    targets.add(path.posix.normalize(path.posix.join(DOCS_ROOT, target)));
  }

  for (const match of withoutUrls.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/g)) targets.add(match[0]);

  return targets;
}

export function buildDocumentationSection(docPaths: readonly string[], readmeMarkdown: string): DocumentationSection {
  const catalogued = catalogueTargets(readmeMarkdown);

  const documents = [...docPaths]
    .sort((left, right) => left.localeCompare(right))
    .map((repoPath) => ({
      path: repoPath,
      section: documentSection(repoPath),
      catalogued: catalogued.has(repoPath),
    }));

  const bySection = new Map<string, { name: string; documents: number; uncatalogued: number }>();
  for (const document of documents) {
    const entry = bySection.get(document.section) ?? { name: document.section, documents: 0, uncatalogued: 0 };
    entry.documents += 1;
    if (!document.catalogued) entry.uncatalogued += 1;
    bySection.set(document.section, entry);
  }
  const sections = [...bySection.values()].sort((left, right) => left.name.localeCompare(right.name));

  return {
    documents,
    sections,
    counts: {
      documents: documents.length,
      catalogued: documents.filter((document) => document.catalogued).length,
      uncatalogued: documents.filter((document) => !document.catalogued).length,
      sections: sections.length,
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: PASS, 13 tests.

Run: `npm run typecheck:source`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/developer-area/repo-awareness-types.ts scripts/generate-repo-awareness-snapshot.ts tests/repo-awareness-generator.test.ts
git commit -m "feat(developer-hub): build the documentation section of the repo awareness snapshot"
```

---

### Task 4: Test health section

`tests/flake-ledger.json` currently holds zero quarantined tests. A panel that renders nothing there is indistinguishable from one that failed to load, so the ledger's own `$comment` — which explains the emptiness in its author's words — travels with the data.

**Files:**

- Modify: `scripts/generate-repo-awareness-snapshot.ts`
- Modify: `tests/repo-awareness-generator.test.ts`

**Interfaces:**

- Produces: `type TestHealthSection`, `buildTestHealthSection(ledger: FlakeLedgerFile): TestHealthSection`, `type FlakeLedgerFile`.

- [ ] **Step 1: Write the failing test**

Append to `tests/repo-awareness-generator.test.ts`:

```ts
import { buildTestHealthSection } from "../scripts/generate-repo-awareness-snapshot";

const FLAKE = {
  id: "ui-smoke-composer",
  title: "phone composer stays docked @quarantine",
  spec: "tests/ui-smoke.spec.ts",
  reason: "Sub-pixel rounding on the dock reserve",
  owner: "frontend",
  reproduction: "npm run verify:ui -- --grep composer",
  firstSeen: "2026-08-01",
  lastSeen: "2026-08-03",
  expires: "2026-09-01",
  tracking: "docs/process-hardening.md#known-flakes",
};

describe("buildTestHealthSection", () => {
  it("carries the ledger's own comment so an empty panel can say why in words", () => {
    const section = buildTestHealthSection({ $comment: "intentionally empty", flakes: [] });
    expect(section.note).toBe("intentionally empty");
    expect(section.quarantined).toEqual([]);
    expect(section.counts).toEqual({ quarantined: 0 });
  });

  it("uses a null note when the ledger carries no comment", () => {
    expect(buildTestHealthSection({ flakes: [] }).note).toBeNull();
  });

  it("maps every required ledger field, renaming the dates to snake case", () => {
    const section = buildTestHealthSection({ flakes: [FLAKE] });
    expect(section.quarantined).toEqual([
      {
        id: "ui-smoke-composer",
        title: "phone composer stays docked @quarantine",
        spec: "tests/ui-smoke.spec.ts",
        reason: "Sub-pixel rounding on the dock reserve",
        owner: "frontend",
        reproduction: "npm run verify:ui -- --grep composer",
        first_seen: "2026-08-01",
        last_seen: "2026-08-03",
        expires: "2026-09-01",
        tracking: "docs/process-hardening.md#known-flakes",
      },
    ]);
    expect(section.counts.quarantined).toBe(1);
  });

  it("emits exactly the ten mapped fields, so no time-derived flag can be added quietly", () => {
    // Expiry is arithmetic against the current date. Storing it under ANY name
    // would change the snapshot's bytes daily and fail the staleness gate on an
    // unchanged repository.
    //
    // This pins the whole key set rather than one spelling. The earlier version
    // asserted `not.toHaveProperty("expired")`, which sailed straight past
    // `isExpired`, `lapsed` or `stale` — the rule was enforced only incidentally,
    // by a `toEqual` in a different test.
    const section = buildTestHealthSection({ flakes: [FLAKE] });
    expect(Object.keys(section.quarantined[0]).sort()).toEqual([
      "expires",
      "first_seen",
      "id",
      "last_seen",
      "owner",
      "reason",
      "reproduction",
      "spec",
      "title",
      "tracking",
    ]);
    expect(Object.keys(section.counts)).toEqual(["quarantined"]);
  });

  it("fails loudly and names the entry when a required field is missing or blank", () => {
    expect(() => buildTestHealthSection({ flakes: [{ ...FLAKE, owner: "" }] })).toThrow(/ui-smoke-composer.*owner/);
    expect(() => buildTestHealthSection({ flakes: [{ ...FLAKE, tracking: undefined }] })).toThrow(
      /ui-smoke-composer.*tracking/,
    );
  });

  it("sorts by expiry then id so ledger ordering cannot make the gate fire", () => {
    const later = { ...FLAKE, id: "b-later", expires: "2026-09-10" };
    const sameDay = { ...FLAKE, id: "a-same" };
    const section = buildTestHealthSection({ flakes: [later, FLAKE, sameDay] });
    expect(section.quarantined.map((entry) => entry.id)).toEqual(["a-same", "ui-smoke-composer", "b-later"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: FAIL — `buildTestHealthSection` is not exported.

- [ ] **Step 3: Add the type to the shared types module**

Append to `src/lib/developer-area/repo-awareness-types.ts`:

```ts
export type QuarantinedTest = {
  id: string;
  title: string;
  spec: string;
  reason: string;
  owner: string;
  reproduction: string;
  first_seen: string;
  last_seen: string;
  expires: string;
  tracking: string;
};

export type TestHealthSection = {
  /** The ledger's own explanation of its state, so an empty panel can quote it. */
  note: string | null;
  quarantined: QuarantinedTest[];
  counts: { quarantined: number };
};
```

- [ ] **Step 4: Implement the test-health builder**

Append to `scripts/generate-repo-awareness-snapshot.ts`; add
`import { readFileSync } from "node:fs";` to the import block, and add
`type TestHealthSection` to the existing `@/lib/developer-area/repo-awareness-types` import:

```ts
export const FLAKE_LEDGER_PATH = "tests/flake-ledger.json";

export type FlakeLedgerFile = { $comment?: string; flakes: readonly Record<string, unknown>[] };

function requireString(entry: Record<string, unknown>, field: string): string {
  const value = entry[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${FLAKE_LEDGER_PATH}: entry ${String(entry.id ?? "(no id)")} is missing "${field}".`);
  }
  return value;
}

export function buildTestHealthSection(ledger: FlakeLedgerFile): TestHealthSection {
  const quarantined = ledger.flakes
    // These ten calls ARE the required-field list, mirroring `requiredFields`
    // in `scripts/flake-ledger.mjs`. A separate validation loop would be dead
    // code, since every field is read — and therefore checked — right here.
    .map((entry) => {
      return {
        id: requireString(entry, "id"),
        title: requireString(entry, "title"),
        spec: requireString(entry, "spec"),
        reason: requireString(entry, "reason"),
        owner: requireString(entry, "owner"),
        reproduction: requireString(entry, "reproduction"),
        first_seen: requireString(entry, "firstSeen"),
        last_seen: requireString(entry, "lastSeen"),
        expires: requireString(entry, "expires"),
        tracking: requireString(entry, "tracking"),
      };
    })
    // Soonest expiry first: the quarantine closest to lapsing is the one that
    // needs a decision. `id` breaks ties so the order is total.
    .sort((left, right) => left.expires.localeCompare(right.expires) || left.id.localeCompare(right.id));

  return {
    note: typeof ledger.$comment === "string" ? ledger.$comment : null,
    quarantined,
    counts: { quarantined: quarantined.length },
  };
}

export function readFlakeLedger(ledgerPath = FLAKE_LEDGER_PATH): FlakeLedgerFile {
  // A corrupt ledger must fail loudly NAMING the file, not surface as a bare
  // `SyntaxError` or `Cannot read properties of undefined (reading 'map')`, and
  // above all must not become a silently empty panel — which is exactly the
  // under-reporting failure this feature exists to prevent.
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch (error) {
    throw new Error(`${ledgerPath}: could not be read or parsed — ${(error as Error).message}`);
  }
  const ledger = parsed as FlakeLedgerFile;
  if (!Array.isArray(ledger?.flakes)) {
    throw new Error(
      `${ledgerPath}: expected a "flakes" array; a corrupt ledger must not silently become an empty panel.`,
    );
  }
  return ledger;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: PASS, 20 tests.

Run: `npm run typecheck:source`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/developer-area/repo-awareness-types.ts scripts/generate-repo-awareness-snapshot.ts tests/repo-awareness-generator.test.ts
git commit -m "feat(developer-hub): build the test health section of the repo awareness snapshot"
```

---

### Task 5: Review state section

454 immutable review records, each a single markdown table row: `| date | ref | head | scope | outcome | checks |`. This is what the panel formerly called "Work in flight" now shows, per the owner's decision in spec §4.1.

**Files:**

- Modify: `src/lib/developer-area/repo-awareness-types.ts`
- Modify: `scripts/generate-repo-awareness-snapshot.ts`
- Modify: `tests/repo-awareness-generator.test.ts`

**Interfaces:**

- Produces: `type ReviewRecord`, `type ReviewStateSection`, `buildReviewStateSection(rows: readonly { file: string; line: string }[]): ReviewStateSection`, `readReviewRecordRows(dir?: string): { file: string; line: string }[]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/repo-awareness-generator.test.ts`:

```ts
import { buildReviewStateSection } from "../scripts/generate-repo-awareness-snapshot";

const ROW_A = {
  file: "docs/branch-review-records/aaa.record.md",
  line: "| 2026-08-15 | claude/one | 02d2e7fc839cf370b512f66b255d5f9e9b42f377 | ledger triage | Approved | ledger guards passed |",
};
const ROW_B = {
  file: "docs/branch-review-records/bbb.record.md",
  line: "| 2026-08-20 | claude/two | 639108f07aa1bcd2ee3344556677889900aabbcc | hub | Approved | 2 failed \\| 14 passed |",
};

describe("buildReviewStateSection", () => {
  it("parses the six columns of a record row", () => {
    const section = buildReviewStateSection([ROW_A]);
    expect(section.records).toEqual([
      {
        date: "2026-08-15",
        ref: "claude/one",
        head: "02d2e7fc839cf370b512f66b255d5f9e9b42f377",
        scope: "ledger triage",
        outcome: "Approved",
        checks: "ledger guards passed",
      },
    ]);
  });

  it("unescapes a markdown-escaped pipe, so no reader sees a literal backslash", () => {
    // The escape is a markdown-table artifact. Carrying it into JSON is how the
    // Phase 1 ledger page came to render "2 failed \\| 14 passed".
    const section = buildReviewStateSection([ROW_B]);
    expect(section.records[0].checks).toBe("2 failed | 14 passed");
  });

  it("orders newest first so the most recent review is the first thing read", () => {
    const section = buildReviewStateSection([ROW_A, ROW_B]);
    expect(section.records.map((record) => record.ref)).toEqual(["claude/two", "claude/one"]);
  });

  it("counts records and distinct refs", () => {
    const again = { file: "docs/branch-review-records/ccc.record.md", line: ROW_A.line };
    const section = buildReviewStateSection([ROW_A, ROW_B, again]);
    expect(section.counts).toEqual({ records: 3, refs: 2 });
  });

  it("fails loudly and names the file when a row has the wrong number of columns", () => {
    const short = { file: "docs/branch-review-records/ddd.record.md", line: "| 2026-08-15 | claude/one |" };
    expect(() => buildReviewStateSection([short])).toThrow(/ddd\.record\.md/);
  });

  it("keeps an abbreviated head verbatim rather than rejecting the record", () => {
    // Older records were written with abbreviated SHAs. Rejecting them would
    // drop real reviews from the panel, which is the failure mode the
    // no-silent-drop rule exists to prevent — loudly or otherwise.
    const abbreviated = {
      file: "docs/branch-review-records/eee.record.md",
      line: "| 2026-01-02 | r | 1a2b3c4 | s | o | c |",
    };
    expect(buildReviewStateSection([abbreviated]).records[0].head).toBe("1a2b3c4");
  });
});

describe("the real review record corpus", () => {
  it("parses every committed record into six populated columns", async () => {
    // Real-data proof for the locally-owned splitter. A fixture-only test would
    // not have caught the escaped pipes that actually appear in the corpus.
    const { readReviewRecordRows, buildReviewStateSection: build } =
      await import("../scripts/generate-repo-awareness-snapshot");
    const section = build(readReviewRecordRows());
    expect(section.counts.records).toBeGreaterThan(400);
    for (const record of section.records) {
      expect(record.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.ref.length).toBeGreaterThan(0);
      expect(record.head).toMatch(/^[0-9a-f]{7,40}$/);
      // Without these two, swapping `scope` and `outcome` in the destructure
      // passes over all 454 records without a single red assertion — this test
      // exists to catch corpus-shaped bugs a two-row fixture cannot.
      //
      // A "refs never contain a space" check was tried and REJECTED against the
      // real corpus: 106 of the 454 refs legitimately do, taking forms such as
      // `PR #1888 (claude/filter-contract-factsheets-pr-d)`. No length or shape
      // threshold separates a ref from a scope either. Column swaps are caught
      // instead by the pinned six-field `toEqual` in the fixture tests above,
      // which was verified red for both the scope/outcome and ref/scope swaps.
      expect(record.scope.length).toBeGreaterThan(0);
      expect(record.outcome.length).toBeGreaterThan(0);
      expect(record.checks).not.toMatch(/\\\|/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: FAIL — `buildReviewStateSection` is not exported.

- [ ] **Step 3: Add the type to the shared types module**

Append to `src/lib/developer-area/repo-awareness-types.ts`:

```ts
export type ReviewRecord = {
  date: string;
  ref: string;
  head: string;
  scope: string;
  outcome: string;
  checks: string;
};

export type ReviewStateSection = {
  records: ReviewRecord[];
  counts: { records: number; refs: number };
};
```

- [ ] **Step 4: Implement the review-state builder**

Append to `scripts/generate-repo-awareness-snapshot.ts`; add `readdirSync` to the
existing `node:fs` import, and add `type ReviewStateSection` to the existing
`@/lib/developer-area/repo-awareness-types` import:

```ts
export const REVIEW_RECORDS_DIR = "docs/branch-review-records";

const RECORD_ROW = /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/;

/**
 * Escape-aware, and it unescapes as it goes. Deliberately NOT `splitCells` from
 * `scripts/outstanding-issues.mjs`, for two independent reasons:
 *
 *  1. That module is JavaScript with no type declarations, so importing it here
 *     would put an implicit `any` into a strict TypeScript build.
 *  2. It deliberately PRESERVES `\|` because the ledger tooling round-trips
 *     cells back into markdown, and unescaping there would emit a bare pipe
 *     into a table row and corrupt `issues:reconcile`. This snapshot is a
 *     one-way export, so it must do the opposite — the same split Phase 1
 *     documented when it put `unescapeCell` in the generator rather than in the
 *     shared splitter.
 *
 * `tests/repo-awareness-generator.test.ts` runs the whole committed corpus
 * through this function, so a divergence in behaviour fails on real data.
 */
function splitRecordCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < inner.length; index += 1) {
    if (inner[index] === "\\" && inner[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (inner[index] === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += inner[index];
  }
  cells.push(cell.trim());
  return cells;
}

export function readReviewRecordRows(dir = REVIEW_RECORDS_DIR): { file: string; line: string }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".record.md"))
    .sort()
    .map((name) => {
      const file = `${dir}/${name}`;
      const line = readFileSync(file, "utf8")
        .split("\n")
        .map((entry) => entry.trim())
        .find((entry) => RECORD_ROW.test(entry));
      if (!line) throw new Error(`${file}: no review record row found.`);
      return { file, line };
    });
}

export function buildReviewStateSection(rows: readonly { file: string; line: string }[]): ReviewStateSection {
  const records = rows
    .map(({ file, line }) => {
      const cells = splitRecordCells(line);
      if (cells.length !== 6) {
        throw new Error(`${file}: expected 6 columns in the review record row, found ${cells.length}.`);
      }
      const [date, ref, head, scope, outcome, checks] = cells;
      // `head` is kept verbatim. Older records carry abbreviated SHAs, and
      // rejecting them would drop real reviews from the panel.
      return { date, ref, head, scope, outcome, checks };
    })
    // Newest first, then ref, head and scope. That is NOT guaranteed to be a
    // total order: 21 records in the current corpus share a date, ref AND head,
    // because one branch can be reviewed twice at one commit under different
    // scopes, and nothing structurally prevents two records sharing all four.
    //
    // Determinism therefore rests on two further facts, not on the comparator:
    // `readReviewRecordRows` sorts filenames, so its output order is the same on
    // every platform, and `Array.prototype.sort` is specified stable, so ties
    // keep that order. If either ever stops holding — records merged from a
    // second source, or an unsorted glob — this comparator will start flapping
    // the staleness gate for exactly those records, and no test will say why.
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        left.ref.localeCompare(right.ref) ||
        left.head.localeCompare(right.head) ||
        left.scope.localeCompare(right.scope),
    );

  return {
    records,
    counts: { records: records.length, refs: new Set(records.map((record) => record.ref)).size },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: PASS, 28 tests, including the real-corpus parse over 454 records.

Run: `npm run typecheck:source`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/developer-area/repo-awareness-types.ts scripts/generate-repo-awareness-snapshot.ts tests/repo-awareness-generator.test.ts
git commit -m "feat(developer-hub): build the review state section of the repo awareness snapshot"
```

---

### Task 6: Assemble the snapshot, resolve the revision, write the file

**Files:**

- Modify: `src/lib/developer-area/repo-awareness-types.ts`
- Modify: `scripts/generate-repo-awareness-snapshot.ts`
- Modify: `tests/repo-awareness-generator.test.ts`
- Modify: `package.json`
- Create: `data/repo-awareness-snapshot.json` (by running the generator)

**Interfaces:**

- Consumes: `buildRoutesSection`, `buildDocumentationSection`, `buildTestHealthSection`, `buildReviewStateSection`, `listDocumentPaths`, `readFlakeLedger`, `readReviewRecordRows`.
- Produces: `type RepoAwarenessSnapshot`, `generate(): RepoAwarenessSnapshot`, `readCapturedRevision(options?: { cwd?: string }): { sha: string; committed_at: string }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/repo-awareness-generator.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { generate, readCapturedRevision, SNAPSHOT_VERSION } from "../scripts/generate-repo-awareness-snapshot";

describe("generate", () => {
  it("assembles all four sections under the declared version", () => {
    const snapshot = generate();
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(snapshot.routes.counts.pages).toBeGreaterThan(0);
    expect(snapshot.documentation.counts.documents).toBeGreaterThan(0);
    expect(snapshot.review_state.counts.records).toBeGreaterThan(400);
    expect(snapshot.test_health.counts.quarantined).toBeGreaterThanOrEqual(0);
  });

  it("records the revision of the last commit that touched its own inputs", () => {
    const snapshot = generate();
    expect(snapshot.captured_revision?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(new Date(snapshot.captured_revision!.committed_at).getTime())).toBe(false);
  });

  it("fails loudly outside a git repository instead of writing a null revision", () => {
    // Spec §8.2 asks for a no-git proof. Ruling R5 changed what the right
    // behaviour IS — this generator runs only from `npm run docs:update`, so a
    // git-less environment is a broken invocation, not a case to degrade for.
    // Phase 1's silent `null` is exactly what this must not do.
    const outside = mkdtempSync(path.join(os.tmpdir(), "repo-awareness-no-git-"));
    try {
      expect(() => readCapturedRevision({ cwd: outside })).toThrow(/Could not read the repository revision from git/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("carries no field derived from the current time", () => {
    // Byte-determinism is what makes the staleness gate trustworthy. A
    // `generated_at` would change the file on every run and fail the gate on an
    // unchanged repository, which trains people to ignore it.
    const first = JSON.stringify(generate());
    const second = JSON.stringify(generate());
    expect(first).toBe(second);
    expect(first).not.toMatch(/generated_at/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: FAIL — `generate` is not exported.

- [ ] **Step 3: Add the top-level type to the shared types module**

Append to `src/lib/developer-area/repo-awareness-types.ts`:

```ts
export type RepoAwarenessSnapshot = {
  version: string;
  /** Null only in a snapshot written before this field existed; the generator always writes it. */
  captured_revision: { sha: string; committed_at: string } | null;
  routes: RoutesSection;
  documentation: DocumentationSection;
  test_health: TestHealthSection;
  review_state: ReviewStateSection;
};
```

- [ ] **Step 4: Implement assembly, revision, and the CLI entry**

Append to `scripts/generate-repo-awareness-snapshot.ts`; add
`writeFileSync` to the existing `node:fs` import, add
`import { pathToFileURL } from "node:url";`, and add `type RepoAwarenessSnapshot` to the
existing `@/lib/developer-area/repo-awareness-types` import:

```ts
/**
 * The commit that last touched anything this snapshot describes — not `HEAD`.
 *
 * `HEAD` would advance on every unrelated commit, so the page would claim the
 * data was fresher than it is. Dating the snapshot by its own inputs can only
 * ever understate freshness, which is the safe direction and the same choice
 * Phase 1 made for `ledger_revision`.
 */
const REVISION_INPUTS = ["src/app", "src/lib/app-modes.ts", "docs", "tests/flake-ledger.json"];

/**
 * Git is a hard requirement of this generator, and that is deliberate rather
 * than an oversight. `npm run docs:update` is the only thing that runs it, and
 * `docs/site-map.md` sets the precedent: generated, committed, verified by a
 * `check:` gate, never regenerated during a build. Because it never runs inside
 * the Docker image, there is no git-less environment to degrade for — which is
 * strictly better than Phase 1's position, where a `prebuild` hook forced a
 * preserve-the-committed-value fallback to exist at all.
 */
export function readCapturedRevision({ cwd }: { cwd?: string } = {}): { sha: string; committed_at: string } {
  let output: string;
  try {
    output = execFileSync("git", ["log", "-1", "--format=%H%x09%cI", "--", ...REVISION_INPUTS], {
      encoding: "utf8",
      cwd,
    }).trim();
  } catch (error) {
    throw new Error(
      `Could not read the repository revision from git: ${(error as Error).message}. ` +
        "This generator runs only from `npm run docs:update`, where git is always available.",
    );
  }
  if (!output) throw new Error("git reported no commit touching this snapshot's inputs.");
  const [sha, committed_at] = output.split("\t");
  return { sha, committed_at };
}

export function generate(): RepoAwarenessSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    captured_revision: readCapturedRevision(),
    routes: buildRoutesSection(),
    documentation: buildDocumentationSection(listDocumentPaths(), readFileSync(README_PATH, "utf8")),
    test_health: buildTestHealthSection(readFlakeLedger()),
    review_state: buildReviewStateSection(readReviewRecordRows()),
  };
}

// Windows-safe main-module check, matching the convention used elsewhere in
// scripts/: a manual `file://${argv[1]}` string reconstruction never matches
// `import.meta.url` on Windows, because a relative argv[1] stays relative and an
// absolute one is missing the drive-letter leading slash — the guard would
// silently never fire and the file would never be written.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(generate(), null, 2)}\n`, "utf8");
  console.log(`[repo-awareness] wrote ${OUTPUT_PATH}`);
}
```

- [ ] **Step 5: Add the npm scripts**

In `package.json`, add:

```json
    "snapshot:repo-awareness": "node scripts/run-tsx.mjs scripts/generate-repo-awareness-snapshot.ts",
```

and extend `docs:update` so it ends with the new generator:

```json
    "docs:update": "npm run sitemap:update && node scripts/update-docs-inventory.mjs && npm run snapshot:issues && npm run snapshot:repo-awareness",
```

Do **not** add it to `prebuild`. Ruling R5.

- [ ] **Step 6: Generate the snapshot and check it in**

Run: `npm run snapshot:repo-awareness`
Expected: `[repo-awareness] wrote data/repo-awareness-snapshot.json`

Run it a second time and confirm `git diff --stat data/repo-awareness-snapshot.json` is empty. A
non-empty diff means something in the snapshot is not deterministic; find it before continuing.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test -- tests/repo-awareness-generator.test.ts`
Expected: PASS, 32 tests, including the no-git proof.

Run: `npm run typecheck:source`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/developer-area/repo-awareness-types.ts scripts/generate-repo-awareness-snapshot.ts tests/repo-awareness-generator.test.ts package.json data/repo-awareness-snapshot.json
git commit -m "feat(developer-hub): generate and commit the repo awareness snapshot"
```

---

### Task 7: The staleness gate

**Files:**

- Create: `scripts/check-repo-awareness-snapshot.ts`
- Create: `tests/repo-awareness-gate.test.ts`
- Modify: `package.json`
- Modify: `scripts/verify-pr-local.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `generate`, `OUTPUT_PATH` from `./generate-repo-awareness-snapshot`.
- Produces: `compareSnapshots(committed: unknown, regenerated: RepoAwarenessSnapshot): string[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/repo-awareness-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { compareSnapshots } from "../scripts/check-repo-awareness-snapshot";
import { generate } from "../scripts/generate-repo-awareness-snapshot";

const regenerated = generate();

describe("compareSnapshots", () => {
  it("reports no differences for the snapshot it was generated from", () => {
    expect(compareSnapshots(structuredClone(regenerated), regenerated)).toEqual([]);
  });

  it("ignores captured_revision, which changes as a side effect of committing", () => {
    const committed = structuredClone(regenerated);
    committed.captured_revision = { sha: "0".repeat(40), committed_at: "2020-01-01T00:00:00Z" };
    expect(compareSnapshots(committed, regenerated)).toEqual([]);
  });

  it("catches a version mismatch", () => {
    const committed = structuredClone(regenerated);
    committed.version = "repo-awareness-snapshot-v0";
    expect(compareSnapshots(committed, regenerated).join(" ")).toMatch(/version/);
  });

  it("catches a content difference in every section", () => {
    // A small change *inside* each section, so this proves the gate looks
    // within a section rather than merely comparing the top-level key set.
    const mutations: Record<string, (snapshot: typeof regenerated) => void> = {
      routes: (snapshot) => void (snapshot.routes.counts.pages += 1),
      documentation: (snapshot) => void (snapshot.documentation.counts.documents += 1),
      test_health: (snapshot) => void (snapshot.test_health.note = "changed"),
      review_state: (snapshot) => void (snapshot.review_state.counts.records += 1),
    };

    for (const [section, mutate] of Object.entries(mutations)) {
      const committed = structuredClone(regenerated);
      mutate(committed);
      expect(compareSnapshots(committed, regenerated).join(" ")).toMatch(section);
    }
  });

  it("catches a missing snapshot rather than treating it as in step", () => {
    expect(compareSnapshots(null, regenerated).join(" ")).toMatch(/missing|version/);
  });

  it("catches a key the generator no longer emits", () => {
    const committed = { ...structuredClone(regenerated), legacy_section: {} };
    expect(compareSnapshots(committed, regenerated).join(" ")).toMatch(/legacy_section/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/repo-awareness-gate.test.ts`
Expected: FAIL — cannot resolve `../scripts/check-repo-awareness-snapshot`.

- [ ] **Step 3: Implement the gate**

Create `scripts/check-repo-awareness-snapshot.ts`:

```ts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { RepoAwarenessSnapshot } from "@/lib/developer-area/repo-awareness-types";

import { generate, OUTPUT_PATH } from "./generate-repo-awareness-snapshot";

const FIX = "npm run snapshot:repo-awareness";

/**
 * Content keys only.
 *
 * `captured_revision` is deliberately NOT compared. It is the sha of the last
 * commit touching this snapshot's inputs, so it changes as a *side effect* of
 * committing the snapshot: regenerate, commit, and that commit becomes the
 * newest change to `docs/` — so the next regeneration yields a different sha
 * with nothing stale. The gate would then fail on every docs change, and `main`
 * would go red after each squash merge that touched a document.
 *
 * Excluding it fails safe: a lagging revision can only make a page report
 * itself as OLDER than it is, and every content difference is still caught.
 */
const COMPARED_CONTENT_KEYS = ["routes", "documentation", "test_health", "review_state"] as const;

export function compareSnapshots(committed: unknown, regenerated: RepoAwarenessSnapshot): string[] {
  const differences: string[] = [];
  const record = (committed ?? {}) as Partial<RepoAwarenessSnapshot> & Record<string, unknown>;

  if (record.version !== regenerated.version) {
    differences.push(`version: committed ${String(record.version)} vs regenerated ${regenerated.version}`);
  }

  for (const key of COMPARED_CONTENT_KEYS) {
    if (JSON.stringify(record[key]) !== JSON.stringify(regenerated[key])) {
      differences.push(`${key} differs from the repository`);
    }
  }

  // The union of both key sets, so a committed snapshot carrying a key the
  // generator no longer emits is caught rather than silently ignored.
  const topLevelKeys = new Set([...Object.keys(regenerated), ...Object.keys(record)]);
  for (const key of topLevelKeys) {
    if (!(key in regenerated)) differences.push(`unexpected key in the committed snapshot: ${key}`);
    else if (!(key in record)) differences.push(`missing key in the committed snapshot: ${key}`);
  }

  return differences;
}

function main() {
  const regenerated = generate();
  let committed: unknown = null;
  try {
    committed = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  } catch {
    console.error(`[repo-awareness] ${OUTPUT_PATH} is missing or unreadable. Run: ${FIX}`);
    process.exit(1);
  }
  const differences = compareSnapshots(committed, regenerated);
  if (differences.length > 0) {
    console.error("[repo-awareness] The committed snapshot is behind the repository:");
    for (const difference of differences) console.error(`  - ${difference}`);
    console.error(`[repo-awareness] Fix with: ${FIX}`);
    process.exit(1);
  }
  console.log(
    `[repo-awareness] in step with ${OUTPUT_PATH} (${regenerated.routes.counts.pages} pages, ` +
      `${regenerated.documentation.counts.documents} documents, ${regenerated.review_state.counts.records} reviews)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Register the gate in all three places it must run**

`package.json` — add the script:

```json
    "check:repo-awareness-snapshot": "node scripts/run-tsx.mjs scripts/check-repo-awareness-snapshot.ts",
```

and insert it into `verify:cheap:internal` immediately after `npm run sitemap:check`:

```
... && npm run sitemap:check && npm run check:repo-awareness-snapshot && npm run docs:check-index && ...
```

`scripts/verify-pr-local.mjs` — add `"check:repo-awareness-snapshot"` to the list that
currently contains `"sitemap:check"`, immediately after it.

`.github/workflows/ci.yml` — beside the existing `run: npm run sitemap:check` step, add:

```yaml
- name: Repo awareness snapshot
  run: npm run check:repo-awareness-snapshot
```

- [ ] **Step 5: Verify the gate manifest still agrees**

Run: `npm run check:gate-manifest`
Expected: exit 0. If it names a manifest file that must list the new gate, add the entry it
asks for and re-run. Do not weaken or skip the check.

- [ ] **Step 6: Prove the gate actually fails**

A gate is only worth adding if it can go red. Prove it by hand:

```bash
node -e "const f='data/repo-awareness-snapshot.json';const s=JSON.parse(require('fs').readFileSync(f));s.review_state.counts.records=1;require('fs').writeFileSync(f,JSON.stringify(s,null,2)+'\n')"
```

Run: `npm run check:repo-awareness-snapshot`
Expected: exit 1, printing `review_state differs from the repository` and the fix command.

Then restore it:

Run: `npm run snapshot:repo-awareness`
Expected: `git diff --stat data/repo-awareness-snapshot.json` is empty again.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test -- tests/repo-awareness-gate.test.ts tests/repo-awareness-generator.test.ts`
Expected: PASS.

Run: `npm run typecheck:source`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-repo-awareness-snapshot.ts tests/repo-awareness-gate.test.ts package.json scripts/verify-pr-local.mjs .github/workflows/ci.yml
git commit -m "feat(developer-hub): gate the repo awareness snapshot against the repository"
```

---

### Task 8: The typed reader

**Files:**

- Create: `src/lib/developer-area/repo-awareness-snapshot.ts`
- Create: `tests/repo-awareness-snapshot.test.ts`

**Interfaces:**

- Consumes: `data/repo-awareness-snapshot.json`; `@/lib/developer-area/repo-awareness-types`; `resolveFreshnessFrom` from `./freshness`.
- Produces: `loadRepoAwarenessSnapshot(): RepoAwarenessSnapshot`, `assertRepoAwarenessVersion(snapshot: { version: string }): void`, `resolveRepoFreshness(snapshot: RepoAwarenessSnapshot, now: Date): Freshness`, `isQuarantineExpired(entry: QuarantinedTest, now: Date): boolean`, `documentsBySection(snapshot): { name: string; documents: DocumentEntry[] }[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/repo-awareness-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  assertRepoAwarenessVersion,
  documentsBySection,
  isQuarantineExpired,
  loadRepoAwarenessSnapshot,
  resolveRepoFreshness,
} from "@/lib/developer-area/repo-awareness-snapshot";
import { REPO_AWARENESS_SNAPSHOT_VERSION } from "@/lib/developer-area/repo-awareness-types";

const NOW = new Date("2026-08-22T12:00:00.000Z");

describe("assertRepoAwarenessVersion", () => {
  it("accepts the version the committed snapshot declares", () => {
    expect(() => assertRepoAwarenessVersion({ version: REPO_AWARENESS_SNAPSHOT_VERSION })).not.toThrow();
  });

  it("throws loudly on an unrecognised version rather than rendering part of it", () => {
    expect(() => assertRepoAwarenessVersion({ version: "repo-awareness-snapshot-v0" })).toThrow(
      /repo-awareness-snapshot-v0.*snapshot:repo-awareness/s,
    );
  });
});

describe("loadRepoAwarenessSnapshot", () => {
  it("returns the committed snapshot with all four sections populated", () => {
    const snapshot = loadRepoAwarenessSnapshot();
    expect(snapshot.version).toBe(REPO_AWARENESS_SNAPSHOT_VERSION);
    expect(snapshot.routes.counts.pages).toBeGreaterThan(0);
    expect(snapshot.documentation.counts.documents).toBeGreaterThan(0);
    expect(snapshot.review_state.counts.records).toBeGreaterThan(400);
  });

  it("keeps each section's count equal to the length of its own list", () => {
    const snapshot = loadRepoAwarenessSnapshot();
    expect(snapshot.routes.counts.pages).toBe(snapshot.routes.pages.length);
    expect(snapshot.documentation.counts.documents).toBe(snapshot.documentation.documents.length);
    expect(snapshot.test_health.counts.quarantined).toBe(snapshot.test_health.quarantined.length);
    expect(snapshot.review_state.counts.records).toBe(snapshot.review_state.records.length);
  });
});

describe("resolveRepoFreshness", () => {
  it("dates the page from the captured revision", () => {
    const snapshot = loadRepoAwarenessSnapshot();
    const freshness = resolveRepoFreshness(snapshot, NOW);
    expect(freshness.contentAt).toBe(snapshot.captured_revision?.committed_at ?? null);
    expect(freshness.viewedAt).toBe(NOW.toISOString());
  });
});

describe("isQuarantineExpired", () => {
  const entry = {
    id: "x",
    title: "t @quarantine",
    spec: "tests/ui-smoke.spec.ts",
    reason: "r",
    owner: "o",
    reproduction: "cmd",
    first_seen: "2026-08-01",
    last_seen: "2026-08-03",
    expires: "2026-08-22",
    tracking: "docs/process-hardening.md",
  };

  it("treats the expiry date itself as still current", () => {
    // A quarantine that expires today has not expired yet. Rounding this the
    // other way would show a red badge for a whole day the entry is still valid.
    expect(isQuarantineExpired(entry, NOW)).toBe(false);
  });

  it("reports expired the day after", () => {
    expect(isQuarantineExpired(entry, new Date("2026-08-23T00:00:01.000Z"))).toBe(true);
  });

  it("does not claim expiry for an unparseable date", () => {
    expect(isQuarantineExpired({ ...entry, expires: "not-a-date" }, NOW)).toBe(false);
  });
});

describe("documentsBySection", () => {
  it("groups every document under its section, dropping none", () => {
    const snapshot = loadRepoAwarenessSnapshot();
    const grouped = documentsBySection(snapshot);
    const total = grouped.reduce((sum, section) => sum + section.documents.length, 0);
    expect(total).toBe(snapshot.documentation.counts.documents);
    expect(grouped.map((section) => section.name)).toEqual(snapshot.documentation.sections.map((s) => s.name));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/repo-awareness-snapshot.test.ts`
Expected: FAIL — cannot resolve `@/lib/developer-area/repo-awareness-snapshot`.

- [ ] **Step 3: Write the reader**

Create `src/lib/developer-area/repo-awareness-snapshot.ts`:

```ts
import snapshotJson from "../../../data/repo-awareness-snapshot.json";

import { resolveFreshnessFrom, type Freshness } from "./freshness";
import {
  REPO_AWARENESS_SNAPSHOT_VERSION,
  type DocumentationSection,
  type QuarantinedTest,
  type RepoAwarenessSnapshot,
} from "./repo-awareness-types";

/**
 * No `import "server-only"`. This module belongs to the `data/*.json` reader
 * family (`differential-fixtures.ts` and friends), not the auth/env family —
 * the JSON it inlines is public repository metadata, and a client component
 * importing it would be wasteful rather than unsafe. The same call was made and
 * recorded for `ledger-snapshot.ts` in Phase 1 (ruling W1).
 */
export function assertRepoAwarenessVersion(snapshot: { version: string }): void {
  if (snapshot.version !== REPO_AWARENESS_SNAPSHOT_VERSION) {
    // Loud, not a render fallback: an unrecognised shape means a page would
    // silently under-report the repository, which is the `#338` failure.
    throw new Error(
      `Unrecognised repo awareness snapshot version ${snapshot.version}; ` +
        `expected ${REPO_AWARENESS_SNAPSHOT_VERSION}. Run: npm run snapshot:repo-awareness`,
    );
  }
}

export function loadRepoAwarenessSnapshot(): RepoAwarenessSnapshot {
  // `as unknown as` rather than a direct assertion: TypeScript infers `string`
  // for the JSON's `area` field, which does not overlap the `RouteArea` union,
  // so a single-step assertion is rejected. `assertRepoAwarenessVersion` below
  // is the runtime guard that makes the cast honest.
  const snapshot = snapshotJson as unknown as RepoAwarenessSnapshot;
  assertRepoAwarenessVersion(snapshot);
  return snapshot;
}

export function resolveRepoFreshness(snapshot: RepoAwarenessSnapshot, now: Date): Freshness {
  return resolveFreshnessFrom(snapshot.captured_revision?.committed_at ?? null, now);
}

/**
 * Expiry is computed here, never stored: a stored `expired` flag would change
 * the snapshot's bytes daily and fail the staleness gate on an unchanged
 * repository.
 *
 * The expiry date itself counts as still current — an entry expiring today has
 * a full day left — so the comparison is against the end of that day. An
 * unparseable date reports "not expired" rather than flashing a red badge on
 * data nobody can verify.
 */
export function isQuarantineExpired(entry: QuarantinedTest, now: Date): boolean {
  const endOfExpiryDay = new Date(`${entry.expires}T23:59:59.999Z`);
  if (Number.isNaN(endOfExpiryDay.getTime())) return false;
  return now.getTime() > endOfExpiryDay.getTime();
}

export type DocumentEntry = DocumentationSection["documents"][number];

/**
 * Section order comes from `documentation.sections`, which the generator
 * already sorted, so the page cannot introduce an order of its own. Every
 * document lands in exactly one group and none is dropped — a document with a
 * section the summary never listed would otherwise vanish from the page while
 * still being counted.
 */
export function documentsBySection(snapshot: RepoAwarenessSnapshot): { name: string; documents: DocumentEntry[] }[] {
  const grouped = new Map<string, DocumentEntry[]>();
  for (const section of snapshot.documentation.sections) grouped.set(section.name, []);
  for (const document of snapshot.documentation.documents) {
    const bucket = grouped.get(document.section);
    if (bucket) bucket.push(document);
    else grouped.set(document.section, [document]);
  }
  return [...grouped.entries()].map(([name, documents]) => ({ name, documents }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/repo-awareness-snapshot.test.ts`
Expected: PASS, 10 tests.

Run: `npm run typecheck:source`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/developer-area/repo-awareness-snapshot.ts tests/repo-awareness-snapshot.test.ts
git commit -m "feat(developer-hub): read the repo awareness snapshot with a version guard"
```

---

### Task 9: Routes and modes page

**Files:**

- Create: `src/app/mockups/development/routes/page.tsx`
- Create: `tests/developer-routes-page.dom.test.tsx`
- Modify: `data/repo-awareness-snapshot.json` (regenerated — this task adds a route)

**Interfaces:**

- Consumes: `PanelPageShell`, `loadRepoAwarenessSnapshot`, `resolveRepoFreshness`.

- [ ] **Step 1: Write the failing test**

Create `tests/developer-routes-page.dom.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DeveloperRoutesPage from "@/app/mockups/development/routes/page";
import { loadRepoAwarenessSnapshot } from "@/lib/developer-area/repo-awareness-snapshot";

const snapshot = loadRepoAwarenessSnapshot();

describe("developer routes page", () => {
  it("renders inside the shared shell with its own freshness label", () => {
    render(<DeveloperRoutesPage />);
    expect(screen.getByTestId("developer-routes")).toBeInTheDocument();
    expect(screen.getByTestId("developer-routes-back")).toHaveAttribute("href", "/mockups/development");
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository/);
  });

  it("shows each count as its own readable value", () => {
    render(<DeveloperRoutesPage />);
    expect(screen.getByTestId("developer-routes-count-modes-value")).toHaveTextContent(
      String(snapshot.routes.counts.modes),
    );
    expect(screen.getByTestId("developer-routes-count-product-value")).toHaveTextContent(
      String(snapshot.routes.counts.product_pages),
    );
    expect(screen.getByTestId("developer-routes-count-mockup-value")).toHaveTextContent(
      String(snapshot.routes.counts.mockup_pages),
    );
    expect(screen.getByTestId("developer-routes-count-api-value")).toHaveTextContent(
      String(snapshot.routes.counts.api),
    );
  });

  it("lists every mode with a link to its home", () => {
    render(<DeveloperRoutesPage />);
    const modes = within(screen.getByTestId("developer-routes-modes")).getAllByRole("listitem");
    expect(modes).toHaveLength(snapshot.routes.counts.modes);
  });

  it("lists every product page and every mockup page, adding up to the counts", () => {
    render(<DeveloperRoutesPage />);
    expect(within(screen.getByTestId("developer-routes-pages-product")).getAllByRole("listitem")).toHaveLength(
      snapshot.routes.counts.product_pages,
    );
    expect(within(screen.getByTestId("developer-routes-pages-mockup")).getAllByRole("listitem")).toHaveLength(
      snapshot.routes.counts.mockup_pages,
    );
  });

  it("links a concrete route but never a dynamic one", () => {
    // A `[id]` segment is not a URL. Linking it would give the reader a control
    // that always 404s, which the wiring conventions forbid.
    render(<DeveloperRoutesPage />);
    const dynamic = snapshot.routes.pages.find((page) => page.path.includes("["));
    const concrete = snapshot.routes.pages.find((page) => !page.path.includes("["));
    expect(concrete).toBeDefined();
    expect(screen.getByTestId(`developer-routes-page-${concrete!.path}`).tagName).toBe("A");
    if (dynamic) expect(screen.getByTestId(`developer-routes-page-${dynamic.path}`).tagName).not.toBe("A");
  });

  it("says in words when a group is empty rather than rendering a blank list", () => {
    render(<DeveloperRoutesPage />);
    for (const [testId, count] of [
      ["developer-routes-redirects", snapshot.routes.counts.redirects],
      ["developer-routes-api", snapshot.routes.counts.api],
    ] as const) {
      const region = screen.getByTestId(testId);
      if (count === 0) expect(region).toHaveTextContent(/None/i);
      else expect(within(region).getAllByRole("listitem")).toHaveLength(count);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/developer-routes-page.dom.test.tsx`
Expected: FAIL — cannot resolve `@/app/mockups/development/routes/page`.

- [ ] **Step 3: Write the page**

Create `src/app/mockups/development/routes/page.tsx`. **No `"use client"`** — this is a
Server Component and renders no handlers.

```tsx
import type { Metadata } from "next";
import Link from "next/link";

import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { loadRepoAwarenessSnapshot, resolveRepoFreshness } from "@/lib/developer-area/repo-awareness-snapshot";

export const metadata: Metadata = {
  title: "Routes and modes · Developer · Clinical KB",
  description: "Every page route, redirect, API route and app mode, read from the committed repository snapshot.",
};

const TILE_CLASS = "grid gap-1 rounded-xl border border-[color:var(--border)] p-4";
const TILE_NUMBER_CLASS = "text-2xl font-extrabold text-[color:var(--text-heading)]";
const TILE_LABEL_CLASS = "text-xs text-[color:var(--text-muted)]";
const SECTION_HEADING_CLASS = "text-lg font-extrabold text-[color:var(--text-heading)]";
const META_CLASS = "text-xs text-[color:var(--text-muted)]";
const MONO_CLASS = "font-mono text-xs text-[color:var(--text-heading)]";
const ROW_CLASS = "flex flex-wrap items-baseline gap-2 rounded-lg border border-[color:var(--border)] px-3 py-2";
const LINK_CLASS =
  "inline-flex min-h-12 items-center font-mono text-xs text-[color:var(--text-heading)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/** The number carries its own test id, so an assertion can read it apart from
 *  the label's prose — which contains digits of its own. */
function CountTile({ id, value, label }: { id: string; value: number; label: string }) {
  return (
    <div data-testid={`developer-routes-count-${id}`} className={TILE_CLASS}>
      <span data-testid={`developer-routes-count-${id}-value`} className={TILE_NUMBER_CLASS}>
        {value}
      </span>
      <span className={TILE_LABEL_CLASS}>{label}</span>
    </div>
  );
}

/**
 * A route containing a `[segment]` is a pattern, not an address. It is rendered
 * as text with the reason stated, rather than as a link that would always 404.
 */
function RoutePath({ path }: { path: string }) {
  if (path.includes("[")) {
    return (
      <span data-testid={`developer-routes-page-${path}`} className={MONO_CLASS}>
        {path} <span className={META_CLASS}>· dynamic pattern, not a single address</span>
      </span>
    );
  }
  return (
    <Link data-testid={`developer-routes-page-${path}`} href={path} className={LINK_CLASS}>
      {path}
    </Link>
  );
}

export default function DeveloperRoutesPage() {
  const snapshot = loadRepoAwarenessSnapshot();
  const freshness = resolveRepoFreshness(snapshot, new Date());
  const { modes, pages, redirects, api, counts } = snapshot.routes;
  const productPages = pages.filter((page) => page.area === "product");
  const mockupPages = pages.filter((page) => page.area === "mockup");

  return (
    <PanelPageShell
      testId="developer-routes"
      title="Routes and modes"
      freshness={freshness}
      freshnessLabel="Repository"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile id="modes" value={counts.modes} label="app modes" />
        <CountTile id="product" value={counts.product_pages} label="product pages" />
        <CountTile id="mockup" value={counts.mockup_pages} label="design-scratch pages" />
        <CountTile id="api" value={counts.api} label="API routes" />
      </div>

      <p className={META_CLASS}>
        Whether every page is reachable from real navigation is already guaranteed by a check that runs on every pull
        request, so it is not repeated here. This page answers what exists, not what is broken.
      </p>

      <section aria-labelledby="developer-routes-modes-heading" className="grid gap-3">
        <h2 id="developer-routes-modes-heading" className={SECTION_HEADING_CLASS}>
          App modes · {counts.modes}
        </h2>
        <ul data-testid="developer-routes-modes" className="grid gap-2">
          {modes.map((mode) => (
            <li key={mode.id} className={ROW_CLASS}>
              <span className="text-sm font-bold text-[color:var(--text-heading)]">{mode.label}</span>
              <Link href={mode.home} className={LINK_CLASS}>
                {mode.home}
              </Link>
              {mode.dev_only ? <span className={META_CLASS}>· only visible in development</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="developer-routes-product-heading" className="grid gap-3">
        <h2 id="developer-routes-product-heading" className={SECTION_HEADING_CLASS}>
          Product pages · {counts.product_pages}
        </h2>
        <ul data-testid="developer-routes-pages-product" className="grid gap-2">
          {productPages.map((page) => (
            <li key={page.path} className={ROW_CLASS}>
              <RoutePath path={page.path} />
              <span className={META_CLASS}>{page.file}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="developer-routes-mockup-heading" className="grid gap-3">
        <h2 id="developer-routes-mockup-heading" className={SECTION_HEADING_CLASS}>
          Design-scratch pages · {counts.mockup_pages}
        </h2>
        <p className={META_CLASS}>
          These do not exist in production. They are exempt from the button-wiring and reachability checks, and from
          nothing else.
        </p>
        <ul data-testid="developer-routes-pages-mockup" className="grid gap-2">
          {mockupPages.map((page) => (
            <li key={page.path} className={ROW_CLASS}>
              <RoutePath path={page.path} />
              <span className={META_CLASS}>{page.file}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="developer-routes-redirects-heading" className="grid gap-3">
        <h2 id="developer-routes-redirects-heading" className={SECTION_HEADING_CLASS}>
          Redirects · {counts.redirects}
        </h2>
        {redirects.length > 0 ? (
          <ul data-testid="developer-routes-redirects" className="grid gap-2">
            {redirects.map((redirect) => (
              <li key={redirect.path} className={ROW_CLASS}>
                <span className={MONO_CLASS}>{redirect.path}</span>
                <span className={META_CLASS}>→</span>
                <span className={MONO_CLASS}>{redirect.target}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="developer-routes-redirects" className={META_CLASS}>
            None. No route in the app redirects to another.
          </p>
        )}
      </section>

      <section aria-labelledby="developer-routes-api-heading" className="grid gap-3">
        <h2 id="developer-routes-api-heading" className={SECTION_HEADING_CLASS}>
          API routes · {counts.api}
        </h2>
        {api.length > 0 ? (
          <ul data-testid="developer-routes-api" className="grid gap-2">
            {api.map((route) => (
              <li key={route.path} className={ROW_CLASS}>
                {/* Not a link: an API route answers a fetch, not a visit. */}
                <span className={MONO_CLASS}>{route.path}</span>
                <span className={META_CLASS}>{route.file}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="developer-routes-api" className={META_CLASS}>
            None.
          </p>
        )}
      </section>
    </PanelPageShell>
  );
}
```

- [ ] **Step 4: Regenerate the snapshot, which this new route changes**

Run: `npm run snapshot:repo-awareness`
Expected: `data/repo-awareness-snapshot.json` now contains `/mockups/development/routes`.

Run: `npm run check:repo-awareness-snapshot`
Expected: exit 0.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- tests/developer-routes-page.dom.test.tsx`
Expected: PASS, 6 tests.

Run: `npm run typecheck:source` and `npm run lint`
Expected: exit 0 for both. Lint is what catches an unwired control or a hardcoded colour, and
Phase 1 learned to run it per task rather than saving it for the end.

- [ ] **Step 6: Commit**

```bash
git add src/app/mockups/development/routes/page.tsx tests/developer-routes-page.dom.test.tsx data/repo-awareness-snapshot.json
git commit -m "feat(developer-hub): add the routes and modes page"
```

---

### Task 10: Documentation page

**Files:**

- Create: `src/app/mockups/development/documentation/page.tsx`
- Create: `tests/developer-documentation-page.dom.test.tsx`
- Modify: `data/repo-awareness-snapshot.json` (regenerated — this task adds a route and a document count of its own is unaffected, but the route list changes)

- [ ] **Step 1: Write the failing test**

Create `tests/developer-documentation-page.dom.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DeveloperDocumentationPage from "@/app/mockups/development/documentation/page";
import { loadRepoAwarenessSnapshot } from "@/lib/developer-area/repo-awareness-snapshot";

const snapshot = loadRepoAwarenessSnapshot();

describe("developer documentation page", () => {
  it("renders inside the shared shell with the repository freshness label", () => {
    render(<DeveloperDocumentationPage />);
    expect(screen.getByTestId("developer-documentation")).toBeInTheDocument();
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository/);
  });

  it("shows each count as its own readable value", () => {
    render(<DeveloperDocumentationPage />);
    const { counts } = snapshot.documentation;
    expect(screen.getByTestId("developer-documentation-count-documents-value")).toHaveTextContent(
      String(counts.documents),
    );
    expect(screen.getByTestId("developer-documentation-count-uncatalogued-value")).toHaveTextContent(
      String(counts.uncatalogued),
    );
  });

  it("leads with the documents missing from the index, because that is the actionable list", () => {
    render(<DeveloperDocumentationPage />);
    const region = screen.getByTestId("developer-documentation-uncatalogued");
    const { uncatalogued } = snapshot.documentation.counts;
    if (uncatalogued === 0) expect(region).toHaveTextContent(/Every document.*index/i);
    else expect(within(region).getAllByRole("listitem")).toHaveLength(uncatalogued);
  });

  it("lists every document under its section, so the sections add up to the total", () => {
    render(<DeveloperDocumentationPage />);
    const rendered = within(screen.getByTestId("developer-documentation-sections")).getAllByRole("listitem");
    expect(rendered).toHaveLength(snapshot.documentation.counts.documents);
  });

  it("marks each document as indexed or not, rather than leaving the reader to guess", () => {
    render(<DeveloperDocumentationPage />);
    const sample = snapshot.documentation.documents[0];
    const row = screen.getByTestId(`developer-documentation-document-${sample.path}`);
    expect(row).toHaveTextContent(sample.catalogued ? /in the index/i : /not in the index/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/developer-documentation-page.dom.test.tsx`
Expected: FAIL — cannot resolve the page module.

- [ ] **Step 3: Write the page**

Create `src/app/mockups/development/documentation/page.tsx`. **No `"use client"`.**

```tsx
import type { Metadata } from "next";

import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import {
  documentsBySection,
  loadRepoAwarenessSnapshot,
  resolveRepoFreshness,
} from "@/lib/developer-area/repo-awareness-snapshot";

export const metadata: Metadata = {
  title: "Documentation · Developer · Clinical KB",
  description: "Every committed document, its area of the repository, and whether the docs index lists it.",
};

const TILE_CLASS = "grid gap-1 rounded-xl border border-[color:var(--border)] p-4";
const TILE_NUMBER_CLASS = "text-2xl font-extrabold text-[color:var(--text-heading)]";
const TILE_LABEL_CLASS = "text-xs text-[color:var(--text-muted)]";
const SECTION_HEADING_CLASS = "text-lg font-extrabold text-[color:var(--text-heading)]";
const META_CLASS = "text-xs text-[color:var(--text-muted)]";
const MONO_CLASS = "font-mono text-xs text-[color:var(--text-heading)]";
const ROW_CLASS = "flex flex-wrap items-baseline gap-2 rounded-lg border border-[color:var(--border)] px-3 py-2";

function CountTile({ id, value, label }: { id: string; value: number; label: string }) {
  return (
    <div data-testid={`developer-documentation-count-${id}`} className={TILE_CLASS}>
      <span data-testid={`developer-documentation-count-${id}-value`} className={TILE_NUMBER_CLASS}>
        {value}
      </span>
      <span className={TILE_LABEL_CLASS}>{label}</span>
    </div>
  );
}

function DocumentRow({ path, catalogued }: { path: string; catalogued: boolean }) {
  return (
    <li data-testid={`developer-documentation-document-${path}`} className={ROW_CLASS}>
      <span className={MONO_CLASS}>{path}</span>
      {/* Stated on every row in words. A badge shown only on one of the two
       *  states reads as "no data" on the other. */}
      <span className={META_CLASS}>{catalogued ? "· in the index" : "· not in the index"}</span>
    </li>
  );
}

export default function DeveloperDocumentationPage() {
  const snapshot = loadRepoAwarenessSnapshot();
  const freshness = resolveRepoFreshness(snapshot, new Date());
  const { counts } = snapshot.documentation;
  const uncatalogued = snapshot.documentation.documents.filter((document) => !document.catalogued);
  const sections = documentsBySection(snapshot);

  return (
    <PanelPageShell
      testId="developer-documentation"
      title="Documentation"
      freshness={freshness}
      freshnessLabel="Repository"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile id="documents" value={counts.documents} label="committed documents" />
        <CountTile id="catalogued" value={counts.catalogued} label="listed in the index" />
        <CountTile id="uncatalogued" value={counts.uncatalogued} label="not in the index" />
        <CountTile id="sections" value={counts.sections} label="areas of the docs tree" />
      </div>

      <p className={META_CLASS}>
        The index is <span className={MONO_CLASS}>docs/README.md</span>, which describes itself as a curated map rather
        than a complete listing — so a document missing from it is expected some of the time, not automatically a
        defect. Review records live on their own page and are not counted here. Whether links inside these documents
        still resolve is already guaranteed by a check that runs on every pull request, so it is not repeated here.
      </p>

      <section aria-labelledby="developer-documentation-uncatalogued-heading" className="grid gap-3">
        <h2 id="developer-documentation-uncatalogued-heading" className={SECTION_HEADING_CLASS}>
          Not in the index · {counts.uncatalogued}
        </h2>
        {uncatalogued.length > 0 ? (
          <ul data-testid="developer-documentation-uncatalogued" className="grid gap-2">
            {uncatalogued.map((document) => (
              <li
                key={document.path}
                data-testid={`developer-documentation-uncatalogued-${document.path}`}
                className={ROW_CLASS}
              >
                <span className={MONO_CLASS}>{document.path}</span>
                <span className={META_CLASS}>· {document.section}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="developer-documentation-uncatalogued" className={META_CLASS}>
            Every document on disk is named in the index.
          </p>
        )}
      </section>

      <section aria-labelledby="developer-documentation-sections-heading" className="grid gap-3">
        <h2 id="developer-documentation-sections-heading" className={SECTION_HEADING_CLASS}>
          Every document · {counts.documents}
        </h2>
        {/*
         * A wrapper rather than one `<ul>`: each area needs its own heading, and
         * a heading between `<li>` siblings is not valid list markup. Every
         * document still sits under this single test id.
         */}
        <div data-testid="developer-documentation-sections" className="grid gap-6">
          {sections.map((section) => {
            const headingId = `developer-documentation-section-${section.name}`;
            return (
              <section key={section.name} aria-labelledby={headingId} className="grid gap-2">
                <h3 id={headingId} className="text-sm font-extrabold text-[color:var(--text-heading)]">
                  {section.name} · {section.documents.length}
                </h3>
                <ul className="grid gap-2">
                  {section.documents.map((document) => (
                    <DocumentRow key={document.path} path={document.path} catalogued={document.catalogued} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </section>
    </PanelPageShell>
  );
}
```

- [ ] **Step 4: Regenerate the snapshot, run the gate, run the tests**

Run: `npm run snapshot:repo-awareness` then `npm run check:repo-awareness-snapshot`
Expected: exit 0.

Run: `npm run test -- tests/developer-documentation-page.dom.test.tsx`
Expected: PASS, 5 tests.

Run: `npm run typecheck:source` and `npm run lint`
Expected: exit 0 for both.

- [ ] **Step 5: Commit**

```bash
git add src/app/mockups/development/documentation/page.tsx tests/developer-documentation-page.dom.test.tsx data/repo-awareness-snapshot.json
git commit -m "feat(developer-hub): add the documentation page"
```

---

### Task 11: Test health page

The flake ledger is currently empty. A blank panel is indistinguishable from a broken one, so the empty state states the fact in words and quotes the ledger's own explanation.

**Files:**

- Create: `src/app/mockups/development/test-health/page.tsx`
- Create: `tests/developer-test-health-page.dom.test.tsx`
- Modify: `data/repo-awareness-snapshot.json` (regenerated)

- [ ] **Step 1: Write the failing test**

Create `tests/developer-test-health-page.dom.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DeveloperTestHealthPage, { QuarantineList } from "@/app/mockups/development/test-health/page";
import { loadRepoAwarenessSnapshot } from "@/lib/developer-area/repo-awareness-snapshot";

const snapshot = loadRepoAwarenessSnapshot();

const ENTRY = {
  id: "ui-smoke-composer",
  title: "phone composer stays docked @quarantine",
  spec: "tests/ui-smoke.spec.ts",
  reason: "Sub-pixel rounding on the dock reserve",
  owner: "frontend",
  reproduction: "npm run verify:ui -- --grep composer",
  first_seen: "2026-08-01",
  last_seen: "2026-08-03",
  expires: "2026-09-01",
  tracking: "docs/process-hardening.md#known-flakes",
};

describe("developer test health page", () => {
  it("renders inside the shared shell with the repository freshness label", () => {
    render(<DeveloperTestHealthPage />);
    expect(screen.getByTestId("developer-test-health")).toBeInTheDocument();
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository/);
  });

  it("states an empty ledger in words and quotes its own explanation", () => {
    render(<DeveloperTestHealthPage />);
    const { quarantined, note } = snapshot.test_health;
    if (quarantined.length === 0) {
      const empty = screen.getByTestId("developer-test-health-empty");
      expect(empty).toHaveTextContent(/No tests are quarantined/i);
      if (note) expect(empty).toHaveTextContent(note.slice(0, 40));
    } else {
      expect(within(screen.getByTestId("developer-test-health-list")).getAllByRole("listitem")).toHaveLength(
        quarantined.length,
      );
    }
  });
});

describe("QuarantineList", () => {
  it("renders every field a reader needs to act on an entry", () => {
    render(<QuarantineList entries={[ENTRY]} now={new Date("2026-08-22T12:00:00.000Z")} />);
    const row = screen.getByTestId(`developer-test-health-entry-${ENTRY.id}`);
    expect(row).toHaveTextContent(ENTRY.title);
    expect(row).toHaveTextContent(ENTRY.spec);
    expect(row).toHaveTextContent(ENTRY.reason);
    expect(row).toHaveTextContent(ENTRY.owner);
  });

  it("marks an entry expired only after its expiry day has passed", () => {
    const { unmount } = render(<QuarantineList entries={[ENTRY]} now={new Date("2026-09-01T23:00:00.000Z")} />);
    expect(screen.getByTestId(`developer-test-health-entry-${ENTRY.id}`)).not.toHaveTextContent(/expired/i);
    unmount();

    render(<QuarantineList entries={[ENTRY]} now={new Date("2026-09-02T00:00:01.000Z")} />);
    expect(screen.getByTestId(`developer-test-health-entry-${ENTRY.id}`)).toHaveTextContent(/expired/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/developer-test-health-page.dom.test.tsx`
Expected: FAIL — cannot resolve the page module.

- [ ] **Step 3: Write the page**

Create `src/app/mockups/development/test-health/page.tsx`. **No `"use client"`.**
`QuarantineList` takes `now` as a parameter so a test can render both sides of the expiry
boundary without faking the clock.

```tsx
import type { Metadata } from "next";

import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import {
  isQuarantineExpired,
  loadRepoAwarenessSnapshot,
  resolveRepoFreshness,
} from "@/lib/developer-area/repo-awareness-snapshot";
import type { QuarantinedTest } from "@/lib/developer-area/repo-awareness-types";

export const metadata: Metadata = {
  title: "Test health · Developer · Clinical KB",
  description: "Quarantined tests, why each was quarantined, and when its quarantine lapses.",
};

const SECTION_HEADING_CLASS = "text-lg font-extrabold text-[color:var(--text-heading)]";
const META_CLASS = "text-xs text-[color:var(--text-muted)]";
const MONO_CLASS = "font-mono text-xs text-[color:var(--text-heading)]";

export function QuarantineList({ entries, now }: { entries: readonly QuarantinedTest[]; now: Date }) {
  return (
    <ul data-testid="developer-test-health-list" className="grid gap-3">
      {entries.map((entry) => {
        const expired = isQuarantineExpired(entry, now);
        return (
          <li
            key={entry.id}
            data-testid={`developer-test-health-entry-${entry.id}`}
            className="grid gap-1 rounded-xl border border-[color:var(--border)] p-4"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={MONO_CLASS}>{entry.id}</span>
              {expired ? (
                <span className="rounded-full border-2 border-[color:var(--danger)] px-2 py-0.5 text-xs font-bold text-[color:var(--text-heading)]">
                  expired {entry.expires}
                </span>
              ) : (
                <span className={META_CLASS}>· lapses {entry.expires}</span>
              )}
            </div>
            <p className="text-sm leading-6 text-[color:var(--text-heading)]">{entry.title}</p>
            <p className={META_CLASS}>
              {entry.spec} · {entry.owner} · first seen {entry.first_seen}, last seen {entry.last_seen}
            </p>
            <p className="text-sm leading-6 text-[color:var(--text-heading)]">{entry.reason}</p>
            <p className={META_CLASS}>Reproduce: {entry.reproduction}</p>
            <p className={META_CLASS}>Tracked in {entry.tracking}</p>
          </li>
        );
      })}
    </ul>
  );
}

export default function DeveloperTestHealthPage() {
  const snapshot = loadRepoAwarenessSnapshot();
  const now = new Date();
  const freshness = resolveRepoFreshness(snapshot, now);
  const { quarantined, note } = snapshot.test_health;

  return (
    <PanelPageShell
      testId="developer-test-health"
      title="Test health"
      freshness={freshness}
      freshnessLabel="Repository"
    >
      <p className={META_CLASS}>
        A quarantined test still runs, but its failure no longer blocks a merge. Quarantine requires three reproductions
        on the same commit and lapses within thirty days, so this list should be short and should empty itself.
      </p>

      <section aria-labelledby="developer-test-health-heading" className="grid gap-3">
        <h2 id="developer-test-health-heading" className={SECTION_HEADING_CLASS}>
          Quarantined · {snapshot.test_health.counts.quarantined}
        </h2>
        {quarantined.length > 0 ? (
          <QuarantineList entries={quarantined} now={now} />
        ) : (
          /*
           * In words, never a blank container. An empty list and a failed load
           * look identical, and the ledger's own note explains the emptiness
           * better than anything this page could invent.
           */
          <div
            data-testid="developer-test-health-empty"
            className="grid gap-2 rounded-xl border border-[color:var(--border)] p-4"
          >
            <p className="text-sm leading-6 text-[color:var(--text-heading)]">No tests are quarantined.</p>
            {note ? <p className={META_CLASS}>The ledger records why: {note}</p> : null}
          </div>
        )}
      </section>
    </PanelPageShell>
  );
}
```

- [ ] **Step 4: Regenerate the snapshot, run the gate, run the tests**

Run: `npm run snapshot:repo-awareness` then `npm run check:repo-awareness-snapshot`
Expected: exit 0.

Run: `npm run test -- tests/developer-test-health-page.dom.test.tsx`
Expected: PASS, 4 tests.

Run: `npm run typecheck:source` and `npm run lint`
Expected: exit 0 for both.

- [ ] **Step 5: Commit**

```bash
git add src/app/mockups/development/test-health/page.tsx tests/developer-test-health-page.dom.test.tsx data/repo-awareness-snapshot.json
git commit -m "feat(developer-hub): add the test health page"
```

---

### Task 12: Review state page

This is the panel the registry still calls `work-in-flight`. It answers "has this ref been reviewed at this exact head, with what outcome" — history, not live pull-request state. What it deliberately does **not** show is stated on the page itself, so a reader is never left inferring that a missing pull request means there isn't one.

**Files:**

- Create: `src/app/mockups/development/review-state/page.tsx`
- Create: `tests/developer-review-state-page.dom.test.tsx`
- Modify: `data/repo-awareness-snapshot.json` (regenerated)

- [ ] **Step 1: Write the failing test**

Create `tests/developer-review-state-page.dom.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DeveloperReviewStatePage from "@/app/mockups/development/review-state/page";
import { loadRepoAwarenessSnapshot } from "@/lib/developer-area/repo-awareness-snapshot";

const snapshot = loadRepoAwarenessSnapshot();

describe("developer review state page", () => {
  it("renders inside the shared shell with the repository freshness label", () => {
    render(<DeveloperReviewStatePage />);
    expect(screen.getByTestId("developer-review-state")).toBeInTheDocument();
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository/);
  });

  it("shows records and distinct refs as separate readable values", () => {
    render(<DeveloperReviewStatePage />);
    expect(screen.getByTestId("developer-review-state-count-records-value")).toHaveTextContent(
      String(snapshot.review_state.counts.records),
    );
    expect(screen.getByTestId("developer-review-state-count-refs-value")).toHaveTextContent(
      String(snapshot.review_state.counts.refs),
    );
  });

  it("states what the page does not show, so a reader cannot infer live pull-request state", () => {
    render(<DeveloperReviewStatePage />);
    expect(screen.getByTestId("developer-review-state-scope")).toHaveTextContent(/does not show/i);
    expect(screen.getByTestId("developer-review-state-scope")).toHaveTextContent(/pull request/i);
  });

  it("renders every record, dropping none", () => {
    render(<DeveloperReviewStatePage />);
    expect(within(screen.getByTestId("developer-review-state-records")).getAllByRole("listitem")).toHaveLength(
      snapshot.review_state.counts.records,
    );
  });

  it("shows the newest record first and never a raw escaped pipe", () => {
    render(<DeveloperReviewStatePage />);
    const rows = within(screen.getByTestId("developer-review-state-records")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(snapshot.review_state.records[0].head);
    expect(screen.getByTestId("developer-review-state-records").textContent).not.toMatch(/\\\|/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/developer-review-state-page.dom.test.tsx`
Expected: FAIL — cannot resolve the page module.

- [ ] **Step 3: Write the page**

Create `src/app/mockups/development/review-state/page.tsx`. **No `"use client"`.**

```tsx
import type { Metadata } from "next";

import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { loadRepoAwarenessSnapshot, resolveRepoFreshness } from "@/lib/developer-area/repo-awareness-snapshot";

export const metadata: Metadata = {
  title: "Review state · Developer · Clinical KB",
  description: "Every immutable review record: which ref was reviewed, at which head, with what outcome.",
};

const TILE_CLASS = "grid gap-1 rounded-xl border border-[color:var(--border)] p-4";
const TILE_NUMBER_CLASS = "text-2xl font-extrabold text-[color:var(--text-heading)]";
const TILE_LABEL_CLASS = "text-xs text-[color:var(--text-muted)]";
const SECTION_HEADING_CLASS = "text-lg font-extrabold text-[color:var(--text-heading)]";
const META_CLASS = "text-xs text-[color:var(--text-muted)]";
const MONO_CLASS = "font-mono text-xs text-[color:var(--text-heading)]";
const DISCLOSURE_CLASS =
  "min-h-12 cursor-pointer text-xs font-bold text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

function CountTile({ id, value, label }: { id: string; value: number; label: string }) {
  return (
    <div data-testid={`developer-review-state-count-${id}`} className={TILE_CLASS}>
      <span data-testid={`developer-review-state-count-${id}-value`} className={TILE_NUMBER_CLASS}>
        {value}
      </span>
      <span className={TILE_LABEL_CLASS}>{label}</span>
    </div>
  );
}

export default function DeveloperReviewStatePage() {
  const snapshot = loadRepoAwarenessSnapshot();
  const freshness = resolveRepoFreshness(snapshot, new Date());
  const { records, counts } = snapshot.review_state;

  return (
    <PanelPageShell
      testId="developer-review-state"
      title="Review state"
      freshness={freshness}
      freshnessLabel="Repository"
    >
      <div className="grid grid-cols-2 gap-3">
        <CountTile id="records" value={counts.records} label="review records" />
        <CountTile id="refs" value={counts.refs} label="distinct branches reviewed" />
      </div>

      {/*
       * The panel is named for what it has, and says plainly what it has not.
       * A label promising more than its data delivers is the `#338` failure
       * wearing different clothes.
       */}
      <p data-testid="developer-review-state-scope" className={META_CLASS}>
        This is the repository&rsquo;s own review history: which branch was reviewed, at which exact commit, and what
        the reviewer concluded. It does not show which pull requests are open, whether their checks are green, or
        whether a review is outstanding — none of that exists on disk, and reading it would need credentials this page
        deliberately does not have. A branch absent from this list has not been reviewed at any head; it does not mean
        there is no pull request.
      </p>

      <section aria-labelledby="developer-review-state-heading" className="grid gap-3">
        <h2 id="developer-review-state-heading" className={SECTION_HEADING_CLASS}>
          Records · {counts.records}
        </h2>
        <p className={META_CLASS}>
          Newest first. Each record is immutable; a later review of the same branch adds a row rather than replacing
          one.
        </p>
        <ol data-testid="developer-review-state-records" className="grid gap-3">
          {records.map((record, index) => (
            <li
              // `head` alone is not unique — 21 records in the corpus share a
              // date, ref AND head, because one branch can be reviewed twice at one
              // commit under different scopes. Adding `scope` disambiguates every
              // record today, but nothing structurally guarantees it, so the index
              // carries uniqueness and the fields carry readability.
              key={`${record.date}-${record.ref}-${record.head}-${record.scope}-${index}`}
              className="grid gap-1 rounded-xl border border-[color:var(--border)] p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={META_CLASS}>{record.date}</span>
                <span className="text-sm font-bold text-[color:var(--text-heading)]">{record.ref}</span>
                <span className={MONO_CLASS}>{record.head}</span>
              </div>
              <p className={META_CLASS}>{record.scope}</p>
              <p className="text-sm leading-6 text-[color:var(--text-heading)]">{record.outcome}</p>
              <details>
                <summary className={DISCLOSURE_CLASS}>Checks run</summary>
                <p className="mt-2 text-sm leading-6 text-[color:var(--text-muted)]">{record.checks}</p>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </PanelPageShell>
  );
}
```

- [ ] **Step 4: Regenerate the snapshot, run the gate, run the tests**

Run: `npm run snapshot:repo-awareness` then `npm run check:repo-awareness-snapshot`
Expected: exit 0.

Run: `npm run test -- tests/developer-review-state-page.dom.test.tsx`
Expected: PASS, 5 tests.

Run: `npm run typecheck:source` and `npm run lint`
Expected: exit 0 for both.

- [ ] **Step 5: Commit**

```bash
git add src/app/mockups/development/review-state/page.tsx tests/developer-review-state-page.dom.test.tsx data/repo-awareness-snapshot.json
git commit -m "feat(developer-hub): add the review state page"
```

---

### Task 13: Flip the registry, rename the panel, and document the phase

Four registry entries move from `phase: 2` to `phase: 1` with their hrefs — the extension point Phase 1 built. `work-in-flight` keeps its id and takes its new name.

**Files:**

- Modify: `src/lib/developer-area/hub-panels.ts`
- Modify: `tests/developer-hub-panels.test.ts`
- Modify: `docs/codebase-index.md`
- Modify: `docs/site-map.md` (regenerated)
- Modify: `data/repo-awareness-snapshot.json` (regenerated)

- [ ] **Step 1: Write the failing test**

Append to `tests/developer-hub-panels.test.ts`:

```ts
describe("phase 2 panels", () => {
  const expected = [
    { id: "routes", href: "/mockups/development/routes" },
    { id: "documentation", href: "/mockups/development/documentation" },
    { id: "test-health", href: "/mockups/development/test-health" },
    { id: "work-in-flight", href: "/mockups/development/review-state" },
  ];

  it("ships all four with a phase of 1 and a real href", () => {
    for (const { id, href } of expected) {
      const panel = HUB_PANELS.find((entry) => entry.id === id);
      expect(panel, id).toBeDefined();
      expect(panel!.phase).toBe(1);
      expect(panel!.href).toBe(href);
    }
  });

  it("leaves no phase 2 entry behind", () => {
    expect(HUB_PANELS.filter((panel) => panel.phase === 2)).toEqual([]);
  });

  it("renames work in flight to Review state while keeping its id", () => {
    // The id is the extension mechanism Phase 1 built; only the label changes.
    const panel = HUB_PANELS.find((entry) => entry.id === "work-in-flight");
    expect(panel!.name).toBe("Review state");
    expect(panel!.summary).not.toMatch(/open changes/i);
  });

  it("keeps every phase-1 panel's href pointing at a route that exists", () => {
    // Guards the one failure this flip can introduce: a card that navigates to
    // a 404. Checked against the generated route list rather than a hand copy.
    const snapshot = loadRepoAwarenessSnapshot();
    const routePaths = new Set([
      ...snapshot.routes.pages.map((page) => page.path),
      // A redirect is a real address a card may legitimately point at; it is
      // only excluded from `pages` so it is not listed twice.
      ...snapshot.routes.redirects.map((redirect) => redirect.path),
    ]);
    for (const panel of HUB_PANELS) {
      if (panel.phase !== 1 || !panel.href) continue;
      expect(routePaths.has(panel.href), `${panel.id} -> ${panel.href}`).toBe(true);
    }
  });
});
```

Add the imports this block needs at the top of the file: `loadRepoAwarenessSnapshot` from
`@/lib/developer-area/repo-awareness-snapshot`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/developer-hub-panels.test.ts`
Expected: FAIL — the four entries are still `phase: 2` with no href.

- [ ] **Step 3: Flip the four entries**

In `src/lib/developer-area/hub-panels.ts`, replace each of the four entries:

```ts
  {
    id: "work-in-flight",
    name: "Review state",
    summary: "Which branches were reviewed, at which head, with what outcome",
    group: "work",
    phase: 1,
    href: "/mockups/development/review-state",
  },
```

```ts
  {
    id: "test-health",
    name: "Test health",
    summary: "Unstable and quarantined tests",
    group: "system",
    phase: 1,
    href: "/mockups/development/test-health",
  },
```

```ts
  {
    id: "documentation",
    name: "Documentation",
    summary: "Every document, its area, and whether the index lists it",
    group: "reference",
    phase: 1,
    href: "/mockups/development/documentation",
  },
```

```ts
  {
    id: "routes",
    name: "Routes and modes",
    summary: "Every page and all 15 modes",
    group: "reference",
    phase: 1,
    href: "/mockups/development/routes",
  },
```

The `id` on the first entry stays `work-in-flight` on purpose — see the plan's ruling R9.
Add that as a comment above it so a later reader does not "tidy" it.

- [ ] **Step 4: Update the generated documents**

Run: `npm run docs:update`
Expected: `docs/site-map.md` gains the four routes and the repo-awareness snapshot is
regenerated. If `docs:check-index` later complains, that is Step 5's job.

- [ ] **Step 5: Document the new modules**

In `docs/codebase-index.md`, add entries in the sections that already list their neighbours:

- `scripts/generate-repo-awareness-snapshot.ts` — builds `data/repo-awareness-snapshot.json` from the route walker, the docs tree, the flake ledger and the review records. Run by `npm run docs:update`.
- `scripts/check-repo-awareness-snapshot.ts` — fails when that snapshot is behind the repository.
- `src/lib/developer-area/repo-awareness-types.ts` — the snapshot's shape, shared by the generator and the reader.
- `src/lib/developer-area/repo-awareness-snapshot.ts` — the typed reader with its version guard.
- `src/lib/developer-area/freshness.ts` — the label-agnostic content-age helper.
- `src/components/developer-area/hub/panel-page-shell.tsx` — back link, title and freshness stamp shared by every developer sub-page.
- The four routes under `/mockups/development/`.

Run: `npm run docs:check-index` and `npm run docs:check-links`
Expected: exit 0 for both.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- tests/developer-hub-panels.test.ts tests/developer-hub-page.dom.test.tsx tests/route-reachability.test.ts`
Expected: PASS. The hub page test is the regression proof that the four cards became links.

Run: `npm run typecheck:source` and `npm run lint`
Expected: exit 0 for both.

- [ ] **Step 7: Commit**

```bash
git add src/lib/developer-area/hub-panels.ts tests/developer-hub-panels.test.ts docs/codebase-index.md docs/site-map.md data/repo-awareness-snapshot.json
git commit -m "feat(developer-hub): ship the four phase 2 panels and rename work in flight to review state"
```

---

## Final acceptance (controller, not an implementer)

These are the exclusive gates, and two of them exist because Phase 1 proved the cheap gates blind to their failure class.

1. **`npm run build`** — mandatory. The only gate that catches a Server Component reading data from a `"use client"` module. Read the output for "Compiled successfully"; exit code alone is not proof.
2. **A live render of all five developer routes.** Run `npm run ensure`, then fetch `/mockups/development`, `/mockups/development/routes`, `/mockups/development/documentation`, `/mockups/development/test-health` and `/mockups/development/review-state`, and grep each response for `Event handlers cannot be passed`. A Dynamic route is compiled but never rendered at build time, so this is the only thing that catches a serialised handler. Also confirm the review-state HTML contains no literal `\|`.
3. **`npm run verify:pr-local`** — the PR mirror, including the new gate. Paste the decisive lines: the test totals, "Compiled successfully", and the `[repo-awareness] in step with …` line.
4. **`npm run verify:phone-chrome`** — these pages do not mount `InPageNavHeader`, so the shared phone chrome is untouched and the spec's §8 trigger does not fire. Run it once anyway; it is cheap when its selector routes to focused coverage, and it is the only proof that the new routes did not disturb the shared shell.
5. **Snapshot determinism** — run `npm run snapshot:repo-awareness` twice and confirm `git status` stays clean.

Expected known-failing baseline throughout: `tests/codex-cloud-setup.test.ts` (2) and `tests/design-sync-contract.test.ts` (1).

## What this phase deliberately leaves undone

Carry these into the handoff rather than discovering them later.

1. **No phone-viewport proof.** Server-render and jsdom proof only, as in Phase 1. These pages are desktop-first by the owner's choice; the gap is real and stated.
2. **The environment strip is still three-quarters unwired.** `isDemoMode()`, the signed-in email and the document count belong to the phase that owns their data source.
3. **Nine panels remain declared placeholders** — phases 3 and 4. The registry mechanism is unchanged, so each is still a phase flip plus an href.
4. **Spec open questions 2 and 3 are answered "no"** by rulings R1 and R3. If a future reader wants orphan-route or document-age reporting, those rulings are the argument to overturn, not an oversight to fix.

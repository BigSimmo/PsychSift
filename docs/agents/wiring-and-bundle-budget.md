# Page Wiring and Bundle Budget

_Updated 2026-11-05 — reconcile retired developer-gated routes; Knowledge owns._

<!-- BEGIN:wiring-and-bundle-budget -->

# Page and button wiring

Interactive controls and routes follow conventions the codebase already holds to. Before adding
or moving a button, link, or route, read `docs/wiring-conventions.md`. A control that advertises an
action must perform one; a page that ships must be reachable.

- **Buttons.** Every interactive `<button>` must do something: an `onClick`, a `type="submit"`
  inside a `<form onSubmit>`, or navigation (wrap it in a `<Link>` / call `router.push`). A control
  that is unavailable for a **stated reason** — feature not built, or this record lacks the data —
  uses `aria-disabled="true"` + `onClick={ignoreUnavailableActivation}` + `title="… — coming soon"`
  - an `sr-only` note wired via `aria-describedby` (see `favourites-hub.tsx`). Native `disabled`
    would remove the tab stop and the reason would never be reached. Keep native `disabled` for
    **transient** inertness (request in flight, pager at its last page, form action awaiting
    validity). Never both attributes on one button — lint fails on the pair. **Never** ship a styled,
    `aria-label`led button with no handler and no disabled state — that was the "Language and region"
    defect fixed 2026-07-21.
- **Navigation.** Internal navigation uses `<Link>`, `router.push`, or server `redirect()` — never
  a raw `<a href="/…">` to an internal route. Build hrefs from the existing sources
  (`src/lib/app-modes.ts`, `src/lib/tools-catalog.ts`, `src/lib/universal-search.ts`), not
  hardcoded strings scattered across components.
- **New-route checklist.** Add the page → link it from real nav (sidebar / launcher / mode home /
  search) → `npm run docs:update` → document it in `docs/codebase-index.md` → add a
  reachability/coverage assertion. A production page route with no inbound link is an orphan.
  The committed pre-commit hook runs this synchronization for relevant staged changes and stops
  when generated docs need review/staging; it never stages files automatically.
- **Gates.** `eslint-rules/require-button-wiring.mjs` (in `npm run lint`) fails on an un-wired
  `<button>`; `tests/route-reachability.test.ts` (in `npm run test`) fails when a production page
  route has no inbound nav link unless it is consciously added to that test's documented
  allowlist (redirect targets / legacy-compat routes). Both run via `lint` / `test` inside
  `verify:cheap`, `verify:full`, and CI. Mockups
  (`src/app/mockups/**`, `*-mockups.tsx`) are design-scratch and exempt from both. **Corrected
  2026-09-02: "and from nothing else" was wrong** — reading the actual rule and config sources,
  mockups are also exempt from `local/no-hardcoded-hex`, `local/require-z-index-ladder` and
  `local/require-lucide-icon-aria` (`eslint.config.mjs`), from `check:icon-scale` and
  `check:design-system-contract`, and from the required Playwright lane (mockup specs carry
  `@mockup` and the `chromium` project sets `grepInvert`; `chromium-mockups` is advisory).
  One exemption people assume and that does NOT exist, verified by glob semantics on 2026-09-02:
  **`knip` is not blind to this surface** — `knip.json` ignores files whose _basename_ contains
  `mockup`, so `*-mockups.tsx` is exempt but the `src/app/mockups/<slug>/page.tsx` routes and the
  `*/mockups/**` subtrees are not.
  (`check:knip` does run `--include dependencies,unlisted,unresolved,duplicates`, omitting
  unused-file and unused-export analysis — but that is repo-wide, not a mockup carve-out.)
  Note too that the three exemption globs disagree with each other; do not infer one rule’s
  coverage from another’s path matching. Mockups are still compiled like any other source: they are
  typechecked, and their client chunks are still weighed by `check:bundle-budget` — against the
  separate `mockups` scratch budget, not the `production` one (reconciled 2026-08-09; see
  "Bundle budget" below). Do not read "exempt" as "free", and do not read this correction as
  licence to widen the list.
- **Retiring a mockup is governed by `docs/mockup-retirement-policy.md`**, enforced by
  `npm run check:mockups`. Deleting one needs a written successor plus a clean import search, not a
  reachability scan and not a `-v2`/`-final`/`-perfected` suffix — in this repo a mockup and the
  production change it justifies usually land in the SAME commit, and in at least five families the
  newer generation imports the older one. The Care Plan prototype was retired on 2026-10-21,
  and the `/mockups/development` Owner panel copy on 2026-10-22. The active
  `/admin/developer-hub` subtree remains behind `DeveloperAreaGate`; its former mockup addresses
  redirect there. Recorded owner authority remains required to retire a developer-gated application.
- **Never** add a production page route without either an inbound link or a documented
  reachability allowlist entry plus an `/issues` note, and never silence the button-wiring rule
  with a blanket disable — wire the control or make it an explicit placeholder.

# Bundle budget

`check:bundle-budget` enforces **three complementary safeguards** in `bundle-budget.json`:

- **`production`** — every chunk a non-mockup route reaches, plus chunks no route manifest claims
  (framework, polyfills, runtime). This is user-facing weight and the real regression guard.
  Tolerance 10%. A failure here means find the regression; do not refresh the baseline to clear it.
- **`routes`** — client JavaScript referenced by `/` and `/documents/search`, the same journeys
  measured by Lighthouse. Each route has a 10% tolerance, so local growth cannot hide inside a
  still-healthy repository aggregate. `/therapy-compass`, `/dsm` and `/forms` were in this list
  and were deliberately removed: home consolidation turned all three into redirect stubs that
  render the same shared home as `/`, so budgeting them measured `/` three more times rather than
  covering anything new (see `tests/check-lighthouse-budget.test.ts`, `COMMITTED_ROUTES`). Do not
  re-add them without also un-consolidating the homes; if a mode's own surface needs its own
  budget, the route to add is its `/search` view, which is a genuinely different bundle.
- **`mockups`** — chunks reachable **only** from `/mockups/**`. Nobody downloads these, so this is a
  repo-hygiene ceiling for unbounded accumulation, not a per-mockup gate. Tolerance 25%.

A chunk shared by a mockup and a production route counts as production — it would be built either
way. Attribution comes from the per-route `*_client-reference-manifest.js` files under
`.next/server/app`; if that tree is missing, resolves no routes, or omits a configured route, the
check **fails closed** rather than collapsing the buckets or silently dropping a route.

Why the split rather than a raised ceiling: measured on `main` at `af85cbc`, the repo-wide total was
+9.96% of the old single baseline — 576 bytes from failing `Build` — while production-only was
**9.06% below** it. Every byte of the apparent regression was design scratch; production had
actually shrunk since the baseline was captured. Raising the ceiling would have hidden that.

**Measuring:** `npm run build` reuses a cached `.next`, and the check then reads stale output and
reports byte-identical numbers — it will tell you the budget passes when it does not. Always
`rm -rf .next` before measuring, and sanity-check `.next/BUILD_ID`'s mtime against the current
commit before trusting a number.

<!-- END:wiring-and-bundle-budget -->

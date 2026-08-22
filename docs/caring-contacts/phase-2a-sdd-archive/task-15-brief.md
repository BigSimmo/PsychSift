### Task 15: The route group, the four width states, and the inbound link

**This task knowingly rescopes one existing test.** `tests/caring-contact-route-files.test.ts:46` currently asserts that `src/app/caring-contacts` **does not exist**, with the stated intent that "the prototype may not squat production route namespaces". That assertion was reserving the name _for_ production. Production now arrives. The assertion is **replaced with a strictly stronger pair** — the mockup must not reach into production and production must not reach into the mockup — so the separation it protects is enforced in both directions rather than by absence. Do not simply delete it. Do not weaken any other assertion in that file: the `localStorage`/`sessionStorage`/`indexedDB`/`document.cookie` ban and the `fetch(` ban stay, scoped to the mockup roots they were written for.

**Files:**

- Create: `src/app/caring-contacts/layout.tsx`, `src/app/caring-contacts/page.tsx`, `src/app/caring-contacts/loading.tsx`, `src/app/caring-contacts/error.tsx`
- Create: `src/components/caring-contacts/workspace/width-state.ts`
- Create: `src/components/caring-contacts/workspace/shell.tsx`
- Create: `src/lib/caring-contacts-routes.ts`
- Modify: `src/lib/tools-catalog.ts`, `src/lib/category-identity.ts`, `src/components/tools-page-mockups/tool-fixtures.ts`
- Modify: `scripts/generate-site-map.ts` (`routeDescriptions`, `routeOwnershipRows`)
- Modify: `docs/codebase-index.md`
- Modify: `tests/caring-contact-route-files.test.ts` (the rescope described above)
- Test: `tests/caring-contacts-workspace-shell.dom.test.tsx` (new)
- Test: `tests/caring-contacts-width-state.test.ts` (new)

**Route shapes** — mirror the approved mockup identities with the `/mockups` prefix removed. Do **not** use any shape from `SUPERSEDED_CARING_CONTACT_ROUTE_PATTERNS` in `src/components/caring-contacts/mockups/types.ts:20-25`; those were rejected during design.

```ts
// src/lib/caring-contacts-routes.ts
export const CARING_CONTACTS_BASE = "/caring-contacts" as const;
export const CARING_CONTACTS_ROUTES = {
  today: CARING_CONTACTS_BASE,
  patients: `${CARING_CONTACTS_BASE}/patients`,
  newPlan: `${CARING_CONTACTS_BASE}/plans/new`,
  schedule: `${CARING_CONTACTS_BASE}/schedule`,
  templates: `${CARING_CONTACTS_BASE}/templates`,
  team: `${CARING_CONTACTS_BASE}/team`,
  guidance: `${CARING_CONTACTS_BASE}/guidance`,
  reports: `${CARING_CONTACTS_BASE}/reports`,
  serviceStop: `${CARING_CONTACTS_BASE}/service-stop`,
  accessTrail: `${CARING_CONTACTS_BASE}/access-trail`,
  workload: `${CARING_CONTACTS_BASE}/workload`,
  reconciliation: `${CARING_CONTACTS_BASE}/reconciliation`,
  notifications: `${CARING_CONTACTS_BASE}/notifications`,
  training: `${CARING_CONTACTS_BASE}/training`,
  coverage: `${CARING_CONTACTS_BASE}/coverage`,
} as const;
export function patientRoute(patientId: string): string;
export function planRoute(planId: string): string;
export function contactRoute(contactId: string): string;
export function pathwayRoute(pathwayId: string): string;
export function episodeTimelineRoute(planId: string): string;
```

Only `today` ships a page in this plan. The rest are declared here so Plan 2B has one source for hrefs and so the nav can render its destinations now with the not-yet-built ones marked unavailable **with a stated reason**, per the button-wiring convention: `aria-disabled="true"` + `onClick={ignoreUnavailableActivation}` + `title="… — coming soon"` + an `sr-only` note wired by `aria-describedby`. Never native `disabled`, and never both attributes together.

**Width state** — the frozen four-state mapping from coordination design spec §7:

```ts
// src/components/caring-contacts/workspace/width-state.ts
export type WorkspaceWidthState = "compact" | "rail" | "split" | "wide";
export const WORKSPACE_WIDTH_BREAKPOINTS = Object.freeze({ rail: 768, split: 1024, wide: 1440 } as const);
export function widthStateFor(viewportWidth: number): WorkspaceWidthState;
```

`widthStateFor` returns `compact` below 768, `rail` from 768 to 1023, `split` from 1024 to 1439, and `wide` at 1440 and above. **This is the single source; no component may re-derive a breakpoint.** The shell expresses the states in Tailwind media classes (`md:` / `lg:` / `xl:`) so layout needs no JavaScript; `widthStateFor` exists for the overlay modality decision and for tests. Do not introduce a named `--breakpoint-*` token for these — design-system GATES §3b prohibits it.

- [ ] **Step 1: Write the failing tests**

`tests/caring-contacts-width-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { WORKSPACE_WIDTH_BREAKPOINTS, widthStateFor } from "@/components/caring-contacts/workspace/width-state";

describe("frozen width-to-state mapping", () => {
  it("maps each required review width to its frozen state", () => {
    expect(widthStateFor(320)).toBe("compact");
    expect(widthStateFor(390)).toBe("compact");
    expect(widthStateFor(430)).toBe("compact");
    expect(widthStateFor(768)).toBe("rail");
    expect(widthStateFor(1024)).toBe("split");
    expect(widthStateFor(1440)).toBe("wide");
    expect(widthStateFor(1920)).toBe("wide");
  });

  it("treats 390 and 430 as compact samples, not additional states", () => {
    expect(new Set([widthStateFor(320), widthStateFor(390), widthStateFor(430)]).size).toBe(1);
  });

  it("changes state exactly at the frozen boundaries", () => {
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.rail - 1)).toBe("compact");
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.split - 1)).toBe("rail");
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.wide - 1)).toBe("split");
  });
});
```

`tests/caring-contacts-workspace-shell.dom.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaringContactsShell } from "@/components/caring-contacts/workspace/shell";

describe("caring-contacts workspace shell", () => {
  it("renders exactly one h1 and marks the workspace synthetic", () => {
    render(<CaringContactsShell title="Today">content</CaringContactsShell>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId("caring-contacts-synthetic-marker")).toBeInTheDocument();
  });

  it("keeps the frozen desktop and phone destination sets", () => {
    render(<CaringContactsShell title="Today">content</CaringContactsShell>);
    const desktop = within(screen.getByRole("navigation", { name: "Workspace" }));
    expect(desktop.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Today",
      "Patients",
      "Schedule",
      "Templates",
    ]);
    const phone = within(screen.getByRole("navigation", { name: "Phone workspace" }));
    expect(phone.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Today",
      "Patients",
      "Schedule",
      "More",
    ]);
  });

  it("navigates internally with Link, never a raw anchor to an internal route", () => {
    const { container } = render(<CaringContactsShell title="Today">content</CaringContactsShell>);
    for (const anchor of container.querySelectorAll("a[href^='/']")) {
      expect(anchor.getAttribute("data-internal-link")).toBe("true");
    }
  });

  it("states a reason on every destination that is not built yet", () => {
    render(<CaringContactsShell title="Today">content</CaringContactsShell>);
    for (const control of screen.queryAllByRole("button", { current: false })) {
      if (control.getAttribute("aria-disabled") !== "true") continue;
      expect(control).toHaveAttribute("title", expect.stringContaining("coming soon"));
      expect(control).not.toHaveAttribute("disabled");
      const describedBy = control.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)?.textContent ?? "").not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run both and verify they fail.**

- [ ] **Step 3: Build the route group and the shell.**

`src/app/caring-contacts/layout.tsx` — Next 16 App Router:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

// Listed in the live tools catalogue by the owner's decision of 19 August 2026, but never
// indexed: this workspace holds invented patients only and must not appear in a search result
// where its synthetic nature is not visible.
export const metadata: Metadata = {
  title: "Caring Contacts - Clinical KB",
  robots: { index: false, follow: false },
};

export default function CaringContactsLayout({ children }: { children: ReactNode }) {
  return children;
}
```

The synthetic marker is not decoration — it is the safeguard that makes decision C survivable. Render it in the shell header on **every** screen, with the same `FICTIONAL_DATA_MARKER` wording the mockup uses.

- [ ] **Step 4: Run both and verify they pass.** Paste both `N passed` lines.

- [ ] **Step 5: Make the route reachable and documented**

Add to `src/lib/tools-catalog.ts`: a `"caring-contacts"` member of `ToolCatalogId` and a record with `href: "/caring-contacts"`, `area: "coordination"`, and a description that names it a **synthetic demonstration** in plain words. Add the matching glyph to `src/lib/category-identity.ts` — the `Record<ToolCatalogId, …>` there is exhaustive and will not compile without it. Add a matching entry to `fixtureExtras` in `src/components/tools-page-mockups/tool-fixtures.ts`, because `route-reachability.test.ts` reads its `tools` array as a `builderTargets` source and that array is built by `fixtureExtras.map`, not from the catalogue.

Then:

```bash
npm run docs:update
```

and add a `routeDescriptions` entry plus a `routeOwnershipRows` row in `scripts/generate-site-map.ts`, and a `docs/codebase-index.md` entry. `npm run sitemap:check` runs inside `verify:cheap` and will fail on a stale file.

- [ ] **Step 6: Rescope the route-files test — replace, do not weaken**

In `tests/caring-contact-route-files.test.ts`, replace the `src/app/caring-contacts` non-existence assertion with:

```ts
it("keeps the prototype and the production workspace from reaching into each other", () => {
  const mockupSources = collectSources(["src/app/mockups/caring-contacts", "src/components/caring-contacts/mockups"]);
  for (const [file, source] of mockupSources) {
    expect(source, `${file} imports production workspace code`).not.toMatch(
      /from\s+["']@\/components\/caring-contacts\/workspace/,
    );
    expect(source, `${file} imports a production caring-contacts route`).not.toMatch(
      /from\s+["']@\/lib\/caring-contacts-server/,
    );
  }

  const productionSources = collectSources(["src/app/caring-contacts", "src/components/caring-contacts/workspace"]);
  expect(productionSources.size).toBeGreaterThan(0);
  for (const [file, source] of productionSources) {
    expect(source, `${file} imports mockup code`).not.toMatch(/caring-contacts\/mockups/);
  }
});

it("still keeps every prototype route under /mockups", () => {
  // unchanged assertion, retained verbatim
});
```

Keep the storage ban and the `fetch(` ban exactly as they are, scoped to the two mockup roots. The production tree legitimately fetches; the prototype still may not.

- [ ] **Step 7: Run the full reachability and route suite**

```bash
npm run test:focused -- --files tests/route-reachability.test.ts,tests/site-map.test.ts,tests/caring-contact-route-files.test.ts,tests/caring-contacts-workspace-shell.dom.test.tsx,tests/caring-contacts-width-state.test.ts
```

Paste the `N passed` line.

- [ ] **Step 8: Measure the bundle before it becomes a surprise**

```bash
rm -rf .next && npm run build && npm run check:bundle-budget
```

`npm run build` reuses a cached `.next` and will report byte-identical numbers if it is not removed first — the measurement would be a lie. Sanity-check `.next/BUILD_ID`'s mtime against the current commit before trusting the number.

The `production` budget is 1,518,033 gzip bytes at 10% tolerance, so there is roughly 151 KB of headroom for the whole workspace. If this task alone consumes a large share of it, **do not refresh the baseline** — that hides real regressions and is explicitly prohibited. Instead make the workspace's client chunks route-local (dynamic import at the route boundary so the Clinical KB dashboard never downloads them) and add `/caring-contacts` as its own key in `bundle-budget.json` `routes` so later screens are gated locally rather than hiding inside the aggregate. Report the measured number in the commit body either way.

- [ ] **Step 9: Prove the tests can fail.** Change `widthStateFor(768)` to return `compact` → the boundary test goes red. Remove the tools-catalogue entry → `route-reachability.test.ts` goes red naming `/caring-contacts` as an orphan. Revert both.

- [ ] **Step 10: Commit**

```bash
git add src/app/caring-contacts src/components/caring-contacts/workspace src/lib/caring-contacts-routes.ts src/lib/tools-catalog.ts src/lib/category-identity.ts src/components/tools-page-mockups/tool-fixtures.ts scripts/generate-site-map.ts docs/site-map.md docs/codebase-index.md tests/caring-contact-route-files.test.ts tests/caring-contacts-workspace-shell.dom.test.tsx tests/caring-contacts-width-state.test.ts
git commit -m "feat(caring-contacts): production workspace route group, four-state shell and catalogue entry"
```

---

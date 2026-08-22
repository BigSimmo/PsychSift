### Task 6: The other ten routes

Spec §8. Do this immediately after Task 5 — the window between them is exactly when the application shows two different truths.

**Files:**

- Modify: `src/components/ward-management/ward-derivations.ts`
- Modify: `src/components/ward-management/ward-management-modes.tsx`
- Modify: `src/components/ward-management/ward-management-network.tsx`
- Modify: `src/components/ward-management/ward-management-console.tsx`
- Create: `tests/ward-flow-single-source.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ward-flow-single-source.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WARD_DIR = "src/components/ward-management";

/** Files allowed to read the frozen fixture: the seed itself, and derivations that take it as a
 *  default parameter. Everything else must read the provider, or two surfaces will disagree. */
const ALLOWED = new Set(["ward-movements.ts", "ward-flow-reducer.ts", "ward-pressure.ts", "ward-derivations.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("one source of truth", () => {
  it("has no component reading the frozen fixture directly", () => {
    const offenders = walk(WARD_DIR)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => !ALLOWED.has(file.split(/[\\/]/).pop()!))
      .filter((file) => /from "[^"]*ward-movements"/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no longer exports a stage summary frozen at import time", () => {
    const source = readFileSync(join(WARD_DIR, "ward-derivations.ts"), "utf8");
    expect(source).not.toMatch(/export const movementStageSummary/);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: four offenders, and `movementStageSummary` still exported.

- [ ] **Step 3: Delete the frozen constant**

In `ward-derivations.ts`, delete `export const movementStageSummary = stageSummaries(wardMovements);`. `stageSummaries(movements)` already exists and takes the list — every call site calls it with the current movements instead.

- [ ] **Step 4: Rewire the three components**

Each becomes a client component reading `useWardFlow()`. Replace `wardMovements` with `movements`, `allUnits()` with `units`, and `movementStageSummary` with `stageSummaries(movements)`. `ward-management-modes.tsx` serves eight routes from one file — change the data source only, not the layout.

- [ ] **Step 5: Run everything**

```bash
npx vitest run tests/ward-flow-single-source.test.ts tests/route-reachability.test.ts tests/ward-management.test.ts
npx tsc --noEmit -p tsconfig.json
npm run lint
PLAYWRIGHT_BASE_URL=<url> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
```

- [ ] **Step 6: Prove the two surfaces now agree**

In the browser, refer a patient on the coordinator screen, then navigate to `/ward-management/queue` **by clicking the rail link, not by reloading**, and confirm the board reflects the referral. Record what you saw.

- [ ] **Step 7: Commit**

```bash
npm run format && git add -A
git commit -m "refactor(ward-flow): every route reads one source of truth"
```

---

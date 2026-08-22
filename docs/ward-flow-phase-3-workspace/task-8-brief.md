### Task 8: The ward screen

**Files:**

- Create: `src/components/ward-management/ward/ward-screen.tsx`
- Create: `src/app/ward-management/ward/[unitId]/page.tsx`
- Create: `tests/ui-ward-roles.spec.ts`
- Modify: `playwright.config.ts`, `docs/design-system/adoption-contract.json`, `ward-management-navigation.tsx`

**Interfaces:**

- Consumes: `useWardFlow()`, `unitById`, `unitCapacity`, `eligibility`, `DECLINE_REASONS`.
- Produces: `WardScreen({ unitId })`.

- [ ] **Step 1: Register the new spec in BOTH Playwright matchers**

Add `ward-roles` to the top-level `testMatch` regex **and** `productionSpecPattern` in `playwright.config.ts`. Missing either yields "No tests found", which reads like a pass. `npx vitest run tests/playwright-project-isolation.test.ts` is the proof.

- [ ] **Step 2: Write the failing test**

```ts
// tests/ui-ward-roles.spec.ts
import { expect, test, type Page } from "playwright/test";

async function gotoWard(page: Page, unitId: string) {
  await page.goto(`/ward-management/ward/${unitId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-unit-screen")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

test.describe("Ward screen", () => {
  test.describe.configure({ timeout: 45_000 });

  test("shows one unit's own capacity and answers an incoming referral", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await gotoWard(page, "bty-adult-secure");

    // One unit, not twenty-two.
    await expect(page.getByTestId("ward-unit-screen")).toContainText("BTY Adult Secure");
    await expect(page.locator('[data-testid^="ward-unit-card-"]')).toHaveCount(1);

    // Its beds reconcile on screen.
    const beds = page.getByTestId("ward-unit-beds");
    await expect(beds).toContainText("Ready");
    await expect(beds).toContainText("Occupied");

    // A decline requires a reason from the fixed list, and out-of-catchment is offered.
    // Unconditional: bty-adult-secure holds a live referral at seed, so this must not
    // hide behind an `if (count())` that can silently never run.
    const incoming = page.locator('[data-testid^="ward-incoming-"]');
    await expect(incoming).not.toHaveCount(0);
    await incoming
      .first()
      .getByRole("button", { name: /Decline/ })
      .click();
    const reasons = page.getByRole("group", { name: /Decline reason/ });
    await expect(reasons).toContainText(/out of catchment/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails.**

- [ ] **Step 4: Build it**

`data-testid="ward-unit-screen"`. The unit resolved by `unitById(unitId)`; **an unresolved id renders an explicit empty state naming the id, never a substituted unit**.

Regions: this unit's five-state bed grid; incoming referrals awaiting an answer, each labelled a parallel referral where it is one and each carrying `restrictionNotice(movement, unit)` where it applies — the ward is the party who would be holding the person, so it sees the voluntary-on-locked warning too — with **accept in principle**, **hold a bed** and **decline** (a reason from the seven, no free text); who is accepted, held or en route here; and what was withdrawn and why, drawn from `withdrawnReferrals`.

`CONFIRM_CAPACITY` lets the ward restate what it can allocate. It writes to its own unit only.

Add the route to `adoption-contract.json`, run `npm run design-system:adoption:update`, and add a literal `<Link href="/ward-management/ward/rph-adult-secure">` to the rail so the route is not an orphan.

- [ ] **Step 5: Run the gates and screenshot** `artifacts/ward-management/phase3-ward.png`. Look at it: does every number belong to this ward and no other?

- [ ] **Step 6: Commit**

```bash
npm run format && git add -A
git commit -m "feat(ward-flow): add the ward screen"
```

---

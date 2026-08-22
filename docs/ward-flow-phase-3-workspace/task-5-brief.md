### Task 5: The coordinator rewire

The primary screen becomes live and its main action becomes a referral. Spec §7.

**Files:**

- Modify: `src/components/ward-management/coordinator/coordinator-screen.tsx`
- Modify: `src/components/ward-management/coordinator/shortlist-panel.tsx`
- Modify: `src/components/ward-management/coordinator/exception-drawer.tsx`
- Modify: `src/components/ward-management/ward-derivations.ts`
- Create: `tests/ward-restriction-notice.test.ts`
- Modify: `tests/ui-ward-coordinator.spec.ts`

**Interfaces:**

- Consumes: `useWardFlow()`.
- Produces: nothing new; the screen's props stop being derived from `wardMovements` and start coming from the provider.
- **Renames one testid:** the primary control in `shortlist-panel.tsx` currently reads `data-testid="ward-shortlist-confirm"` with the label `Confirm placement`. It becomes `data-testid="ward-shortlist-refer"` labelled `Refer`. The candidate rows keep their existing `data-testid={`ward-shortlist-candidate-${unit.id}`}` — do not rename those. Tasks 7 and 12 select on `ward-shortlist-refer`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-coordinator.spec.ts
test("refers a patient to up to three wards and records what it did", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await gotoCoordinator(page);

  const queue = page.getByRole("region", { name: "Priority queue" });
  await queue.locator('[data-testid^="ward-queue-row-"]').first().click();

  const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

  // Nothing is referable until a human picks a ward.
  const refer = shortlist.getByRole("button", { name: /Refer/ });
  await expect(refer).toHaveAttribute("aria-disabled", "true");

  await shortlist.locator('[data-testid^="ward-shortlist-candidate-"]').first().click();
  await expect(refer).not.toHaveAttribute("aria-disabled", "true");
  await refer.click();

  // The referral is recorded on the screen, and the parallel cap is stated.
  await expect(shortlist).toContainText(/parallel referral/i);
  await expect(shortlist).not.toContainText(/Confirm placement/);
});

test("shows a refused transition instead of swallowing it", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await gotoCoordinator(page);

  const drawer = page.getByRole("button", { name: /Exceptions/ });
  await drawer.click();
  // The refusals region exists even when empty, so a coordinator learns where to look.
  await expect(page.getByRole("region", { name: "Exceptions" })).toContainText(/refus/i);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Add the restriction notice derivation and its test**

Two warnings, not one. Write `tests/ward-restriction-notice.test.ts` first and watch it fail:

```ts
import { describe, expect, it } from "vitest";

import { restrictionNotice } from "../src/components/ward-management/ward-derivations";
import { wardMovements } from "../src/components/ward-management/ward-movements";
import { allUnits } from "../src/components/ward-management/ward-sites";

const unit = (id: string) => allUnits().find((candidate) => candidate.id === id)!;

describe("restriction notice", () => {
  it("says nothing when the ward's security matches what the patient needs", () => {
    const open = wardMovements.find((m) => m.security === "Open" && m.legalStatus !== "Voluntary")!;
    expect(restrictionNotice(open, unit("scgh-adult-open"))).toBeUndefined();
  });

  it("flags a secure ward for an open-security patient as more restrictive than required", () => {
    const open = wardMovements.find((m) => m.security === "Open" && m.legalStatus !== "Voluntary")!;
    const notice = restrictionNotice(open, unit("rph-adult-secure"));
    expect(notice?.level).toBe("more_restrictive");
    expect(notice?.text).toMatch(/more restrictive/i);
  });

  it("flags a voluntary patient on a locked ward separately and more prominently", () => {
    const voluntary = wardMovements.find((m) => m.legalStatus === "Voluntary")!;
    const notice = restrictionNotice(voluntary, unit("rph-adult-secure"));
    expect(notice?.level).toBe("voluntary_on_locked");
    expect(notice?.text).toMatch(/voluntary/i);
    // It prompts a review; it never asserts that anything unlawful has happened.
    expect(notice?.text).not.toMatch(/unlawful|illegal|breach/i);
  });

  it("prefers the voluntary warning when both would apply", () => {
    const voluntaryOpen = wardMovements.find((m) => m.legalStatus === "Voluntary" && m.security === "Open")!;
    expect(restrictionNotice(voluntaryOpen, unit("rph-adult-secure"))?.level).toBe("voluntary_on_locked");
  });
});
```

Then add to `ward-derivations.ts`:

```ts
export type RestrictionNotice = { level: "voluntary_on_locked" | "more_restrictive"; text: string };

/**
 * A ward tighter than the patient needs raises one of two warnings, and they are different things.
 * A voluntary person who cannot leave a locked ward is detained in fact without an order, which is
 * sharper than merely over-restrictive and gets its own flag. Neither blocks a placement and
 * neither touches an eligibility gate — `ward-eligibility.ts` is a protected surface.
 */
export function restrictionNotice(movement: Movement, unit: Unit): RestrictionNotice | undefined {
  if (unit.security !== "Secure") return undefined;
  if (movement.legalStatus === "Voluntary") {
    return {
      level: "voluntary_on_locked",
      text: "Voluntary patient on a locked ward — review legal status before admission",
    };
  }
  if (movement.security === "Open") {
    return { level: "more_restrictive", text: "More restrictive than this movement requires" };
  }
  return undefined;
}
```

Run `npx vitest run tests/ward-restriction-notice.test.ts` — expected PASS, 4 tests.

- [ ] **Step 4: Rewire**

In `coordinator-screen.tsx`, replace the direct `wardMovements` import and the `NOW_ANCHOR` constant with `const { movements, units, rejections, now, dispatch } = useWardFlow();`, and pass `movements`, `units` and `now` down to every region. `queueOrder(movements, now)`, `edPressure(now, movements)`, `buildActionInbox(movements.filter(isOpen), now)`.

In `shortlist-panel.tsx`:

- "Confirm placement" becomes **"Refer to selected wards"**, dispatching `REFER_TO_UNITS` with every explicitly selected candidate, capped at three. Selection becomes multi-select; the existing explicit-selection guard stays — nothing is referable until a human has chosen.
- Each referred ward is labelled a parallel referral.
- Override keeps its reason-gated path and dispatches the same event with the reason recorded.
- **The security wording changes.** Render `restrictionNotice(movement, unit)` from Step 3 on every candidate row and every routed diagram node — the voluntary-on-locked warning more prominently than the more-restrictive one, both carried in text so they survive `forced-colors` rather than relying on colour. Candidate ordering ranks a security-matching ward above an over-restrictive one. `ward-eligibility.ts` is protected — do not change gate semantics, only the rendered text and the ordering.

In `exception-drawer.tsx`, add a refusals section rendering `rejections`, newest first, present even when empty.

- [ ] **Step 5: Run the gates**

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run check:design-system-contract
PLAYWRIGHT_BASE_URL=<url> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
```

Read lint's output, not its exit code.

- [ ] **Step 6: Screenshot**

Capture `artifacts/ward-management/phase3-coordinator-live.png` at 1600×1100 with a patient selected and two wards chosen. **Look at it.** Does the screen say what it did, and does anything claim a placement that has not happened?

- [ ] **Step 7: Commit**

```bash
npm run format && git add -A src/components/ward-management/coordinator src/components/ward-management/ward-derivations.ts tests
git commit -m "feat(ward-flow): make the coordinator screen live and refer rather than place"
```

---

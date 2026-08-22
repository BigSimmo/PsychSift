### Task 7: The coordinator's phone pins Confirm

Small, and the officer's screen inherits the pattern, so it must exist first.

**Files:**

- Modify: `src/components/ward-management/coordinator/coordinator-screen.tsx`
- Modify: `src/components/ward-management/coordinator/coordinator.module.css`
- Modify: `tests/ui-ward-coordinator.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-coordinator.spec.ts
test("keeps the referral control reachable on a phone without moving the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoCoordinator(page);

  const queue = page.getByRole("region", { name: "Priority queue" });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await queue.locator('[data-testid^="ward-queue-row-"]').first().click();

  // The control is pinned, so selecting a patient must not scroll the page under the thumb.
  await expect(page.evaluate(() => window.scrollY)).resolves.toBe(scrollBefore);
  await expect(page.getByTestId("ward-shortlist-refer")).toBeInViewport();

  // And the queue keeps the room it was previously losing to a nested scroller.
  const rows = await queue.locator('[data-testid^="ward-queue-row-"]').count();
  expect(rows).toBeGreaterThan(4);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build it**

Delete the nested double-`requestAnimationFrame` `scrollIntoView` effect. Replace it with a bar pinned to the bottom of the viewport on phone widths carrying the referral and override controls, painting its own safe-area inset. The queue then takes the height the scroller was consuming.

- [ ] **Step 4: Run to verify it passes,** then capture `artifacts/ward-management/phase3-phone-pinned.png` and look at it.

- [ ] **Step 5: Commit**

```bash
npm run format && git add -A src/components/ward-management/coordinator tests
git commit -m "feat(ward-flow): pin the phone referral bar instead of scrolling to it"
```

---

## Checkpoint

Tasks 1–7 produce complete, coherent software: the coordinator screen is live, every existing route agrees with it, the reducer is proved, and the phone works. **If the phase is sprawling, stop here and re-plan.** Tasks 8–12 add the three new screens.

---

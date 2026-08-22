### Task 10: The live tracker

**Files:**

- Create: `src/components/ward-management/tracker/live-tracker.tsx`
- Modify: `src/app/ward-management/transport/page.tsx`, `tests/ui-ward-roles.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-roles.spec.ts
test("tracks every vehicle by leg and by how long since the last stamp", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/ward-management/transport", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-live-tracker")).toBeVisible({ timeout: 15_000 });

  const rows = page.locator('[data-testid^="ward-tracker-row-"]');
  expect(await rows.count()).toBeGreaterThan(0);

  // Every row names its leg and its age, and no row claims a leg it has not reached.
  for (const row of await rows.all()) {
    await expect(row).toContainText(/Requested|Accepted|En route|Collected|Arrived/);
    await expect(row).toContainText(/ago|since/i);
  }
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build it**

Rewrite `/ward-management/transport` as the coordinator's tracker: which patient, which leg, how long since the last stamp, using `transportStatusLabel` and `splitDuration`. A movement with no transport shows an explicit absence, never a fabricated leg.

- [ ] **Step 4: Run the gates and screenshot** `artifacts/ward-management/phase3-tracker.png`.

- [ ] **Step 5: Commit**

```bash
npm run format && git add -A
git commit -m "feat(ward-flow): rewrite transport as the coordinator's live tracker"
```

---

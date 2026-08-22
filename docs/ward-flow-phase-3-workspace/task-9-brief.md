### Task 9: The transport officer's phone

**Files:**

- Create: `src/components/ward-management/officer/officer-screen.tsx`
- Create: `src/app/ward-management/transport/officer/page.tsx`
- Modify: `tests/ui-ward-roles.spec.ts`, `adoption-contract.json`, `ward-management-navigation.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-roles.spec.ts
test("gives the officer four actions and nothing else", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ward-management/transport/officer", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-officer-screen")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  const job = page.locator('[data-testid^="ward-officer-job-"]').first();
  await expect(job).toContainText(/escort/i);

  // Exactly four actions, pinned and reachable without scrolling.
  const actions = job.getByRole("button");
  await expect(actions).toHaveCount(4);
  for (const action of await actions.all()) {
    const box = await action.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build it**

Phone-first. Every job not yet arrived — the model records a `provider`, not a person, so **the screen says it is showing all jobs rather than inventing an officer to own them**. Per job: patient identifier, origin department, destination unit, legal form required, escort required. Four buttons dispatching `TRANSPORT_ACCEPTED`, `TRANSPORT_EN_ROUTE`, `PATIENT_COLLECTED`, `PATIENT_ARRIVED`. Each is unavailable, with a stated reason, until its predecessor has happened — never both `disabled` and `aria-disabled`.

Controls pinned to the bottom, following Task 7's pattern.

- [ ] **Step 4: Run the gates and screenshot** `artifacts/ward-management/phase3-officer-390.png`. Look at it: could a driver use this one-handed?

- [ ] **Step 5: Commit**

```bash
npm run format && git add -A
git commit -m "feat(ward-flow): add the transport officer phone screen"
```

---

### Task 11: The emergency department screen

The last screen, and the one carrying both clocks. Spec §7.

**Files:**

- Create: `src/components/ward-management/ed/ed-screen.tsx`
- Create: `src/app/ward-management/ed/[edId]/page.tsx`
- Modify: `tests/ui-ward-roles.spec.ts`, `adoption-contract.json`, `ward-management-navigation.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-roles.spec.ts
test("shows a department its own patients, both clocks, and one outstanding item each", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/ward-management/ed/peel-ed", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-ed-screen")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  const rows = page.locator('[data-testid^="ward-ed-patient-"]');
  expect(await rows.count()).toBeGreaterThan(0);

  // Its own patients only.
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute("data-origin-ed", "peel-ed");
  }

  // The legal clock and the department clock are shown as different things.
  await expect(page.getByTestId("ward-ed-screen")).toContainText(/in department/i);
  await expect(page.getByTestId("ward-ed-screen")).toContainText(/legal clock|since form/i);

  // At least one community-formed patient shows a legal clock older than its time in department.
  const communityFormed = page.locator('[data-testid^="ward-ed-patient-"][data-community-formed="true"]');
  expect(await communityFormed.count()).toBeGreaterThan(0);

  // A department can raise a referral.
  await expect(page.getByRole("button", { name: /Raise referral/ })).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build it**

Its own patients, filtered on `originEdId`. Each row carries **both clocks** — time in the department from `openedAt`, and the legal clock from `formedAt` where that is earlier, marked `data-community-formed="true"` when they differ — plus the four-hour access target, a police flag where `arrivalMode` says so, and **the single outstanding item**: a form, an examination, a transport request, or handover.

Two forms: **raise a referral** (cohort, security, sex, specialling, legal status, urgency — dispatching `RAISE_REFERRAL`) and **record an examination** with its outcome (dispatching `RECORD_EXAMINATION`; `revoked` closes the movement).

Statewide capacity visible and read-only. No statewide queue, no shortlist, no diagram.

- [ ] **Step 4: Run the gates and screenshot** `artifacts/ward-management/phase3-ed.png`. Look at it: does any patient's legal clock read as shorter than its time in the department? That would be backwards.

- [ ] **Step 5: Commit**

```bash
npm run format && git add -A
git commit -m "feat(ward-flow): add the emergency department screen with both clocks"
```

---

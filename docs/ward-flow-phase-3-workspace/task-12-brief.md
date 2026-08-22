### Task 12: The role switcher, the loop, and proving the phase

**Files:**

- Create: `src/components/ward-management/ward-role-switcher.tsx`
- Modify: `ward-management-navigation.tsx`, `tests/ui-ward-roles.spec.ts`

- [ ] **Step 1: Write the failing test — the journey that proves the phase**

```ts
// append to tests/ui-ward-roles.spec.ts
test("walks one patient through all four roles in a single window", async ({ page }) => {
  // NOTE: this journey must navigate by CLICKING. `page.goto()` is a full page load, which
  // resets the provider — the test would then pass or fail for reasons unrelated to the code.
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/ward-management", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-coordinator")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  // Coordinator refers.
  const queue = page.getByRole("region", { name: "Priority queue" });
  const firstRow = queue.locator('[data-testid^="ward-queue-row-"]').first();
  const movementId = (await firstRow.getAttribute("data-testid"))!.replace("ward-queue-row-", "");
  await firstRow.click();

  const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });
  await shortlist.locator('[data-testid^="ward-shortlist-candidate-"]').first().click();
  await shortlist.getByRole("button", { name: /Refer/ }).click();

  // Switch to the ward the patient was referred to — by clicking, not navigating.
  await page.getByRole("button", { name: /Switch role/ }).click();
  await page.getByRole("menuitem", { name: /Ward/ }).click();
  await expect(page.getByTestId("ward-unit-screen")).toBeVisible();
  const incoming = page.locator(`[data-testid="ward-incoming-${movementId}"]`);
  await expect(incoming).toBeVisible();

  // Ward accepts and holds a bed.
  await incoming.getByRole("button", { name: /Accept/ }).click();
  await incoming.getByRole("button", { name: /Hold a bed/ }).click();

  // Back to the coordinator: the acceptance is already there.
  await page.getByRole("button", { name: /Switch role/ }).click();
  await page.getByRole("menuitem", { name: /Coordinator/ }).click();
  await expect(page.getByRole("complementary", { name: "Explainable shortlist" })).toContainText(/Accepted/);

  // Officer completes the journey.
  await page.getByRole("button", { name: /Switch role/ }).click();
  await page.getByRole("menuitem", { name: /Transport officer/ }).click();
  const job = page.locator(`[data-testid="ward-officer-job-${movementId}"]`);
  for (const label of ["Accepted", "En route", "Collected", "Arrived"]) {
    await job.getByRole("button", { name: label }).click();
  }

  // Arrival closes the record: the patient leaves the system entirely.
  await page.getByRole("button", { name: /Switch role/ }).click();
  await page.getByRole("menuitem", { name: /Coordinator/ }).click();
  await expect(queue.locator(`[data-testid="ward-queue-row-${movementId}"]`)).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build the switcher**

Four roles. Where you stand is inferred from the selected patient — Ward goes to the unit it was referred to, ED to its origin department — with a picker to move elsewhere. **The coordinator has no place**; the switcher shows that asymmetry rather than inventing a location. Tap targets `3rem`. Each destination is a real `<Link>` so the routes are reachable.

- [ ] **Step 4: Prove the phase**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
npm run lint
npm run check:design-system-contract
npm run ensure
PLAYWRIGHT_BASE_URL=<url> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts tests/ui-ward-roles.spec.ts --project=chromium --reporter=line
```

Read lint's output, not its exit code. Do **not** run `verify:ui`, `verify:release`, `eval:*` or `check:supabase-project` — the owner has asked for CI restraint and everything here is offline.

- [ ] **Step 5: The screenshot pass**

Collect every capture from Tasks 5–11 and review them as a set at full size. Ask of each: **is every number on it derived from the current state, and does every label say what the number actually means?** Then send the set to the owner. Their eyes are the gate this phase cannot pass without — every serious defect in Phases 1 and 2 was something that passed its tests and was visibly wrong.

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(ward-flow): add the role switcher and prove the loop end to end"
```

---

## Self-Review

**Spec coverage.** §3 model changes → Task 1. §4 state layer → Tasks 2 and 4. §5 clock → Task 4. §6 events → Task 2. §7 screens → Tasks 5, 8, 9, 10, 11. §8 the ten routes → Task 6. §9 role switching → Task 12. §10 failure behaviour → Tasks 2, 3 and 5. §11 escalation → Task 5's `RECORD_ESCALATION` dispatch and the shortlist's existing no-eligible-destination state. §12 simplifications → recorded, nothing to build. §14 proof → Tasks 3 and 12. §15 build order → task order, with build-order item 1 already complete at `7f373e80f`. §17 conventions → Tasks 8, 9 and 11 each register their route.

**Type consistency.** `WardFlowState`, `WardFlowEvent`, `WardFlowRole`, `seedWardFlowState`, `wardFlowReducer` are defined in Task 2 and consumed under those names in Tasks 3, 4, 5 and 6. `useWardFlow()` is defined in Task 4 and consumed in Tasks 5, 6, 8, 9, 10, 11 and 12. `Rejection` is defined in Task 1 and consumed in Tasks 2 and 5.

**Two things a reviewer should watch for.** First, that no screen has quietly kept its own copy of the fixture — Task 6's static test is the guard and it must not be weakened. Second, that the end-to-end journey navigates by clicking; a single `page.goto()` in it silently resets the world and the test then proves nothing.

### Task 19: Browser proof at the six required widths

**Files:**

- Create: `tests/ui-caring-contacts-workspace.spec.ts`
- Modify: `playwright.config.ts` — add `caring-contacts-workspace` to **both** `testMatch` (line 34) **and** `productionSpecPattern` (line 26)
- Test: `tests/playwright-project-isolation.test.ts` (extend)

**A spec that is not in both patterns silently never runs.** That is the failure mode this task exists to prevent, so the isolation test is extended first.

- [ ] **Step 1: Write the failing guard**

Extend `tests/playwright-project-isolation.test.ts`:

```ts
it("collects the production caring-contacts workspace spec in the chromium project only", () => {
  const productionPattern = configPattern("productionSpecPattern");
  const mockupPattern = configPattern("mockupSpecPattern");
  expect(productionPattern.test("tests/ui-caring-contacts-workspace.spec.ts")).toBe(true);
  expect(mockupPattern.test("tests/ui-caring-contacts-workspace.spec.ts")).toBe(false);
  expect(configPattern("testMatch").test("tests/ui-caring-contacts-workspace.spec.ts")).toBe(true);
});
```

- [ ] **Step 2: Run and verify it fails.**

Run: `npm run test:focused -- --files tests/playwright-project-isolation.test.ts`
Expected: FAIL — the basename is in neither pattern.

- [ ] **Step 3: Register the spec in both patterns, then write it.**

The spec must cover, at 320, 390, 430, 768, 1024 and 1440:

1. `/caring-contacts` renders its `h1` with **no horizontal document overflow** (`scrollWidth - innerWidth <= 2`).
2. Below 768 the phone dock is visible and the rail is hidden; at 768 and above the inverse.
3. The primary control's bottom edge sits above the phone dock's top edge (dock clearance).
4. The `widthStateFor` state is observable in the DOM as `data-workspace-width-state` and equals `compact` / `rail` / `split` / `wide` at the six widths.
5. Every one of the 24 overlays, deep-linked by `?overlay=<id>` at 390 and 1440: the URL contains the id, `data-overlay-modality` equals the width-appropriate modality, geometry matches (`full-screen-stage` and `session-gate` at phone width fill the viewport; `inspection-drawer` on desktop is right-anchored and at most 56% of the width; `dialog` is at most 640 px wide; nothing is ever off-screen), Escape closes and returns focus to the trigger, and `session-expiry` survives Escape.
6. Dark mode, `forcedColors: "active"` and 400% zoom on a 1280 px viewport: a visible focus outline (`outlineStyle !== "none"`) and no horizontal overflow.

Tag nothing `@quarantine`. Retries stay at zero.

- [ ] **Step 4: Run the spec**

```bash
npm run ensure
```

Use the URL it prints. Never assume `localhost:3000`.

```bash
node scripts/run-playwright.mjs tests/ui-caring-contacts-workspace.spec.ts --project=chromium
```

Under heavy lock contention this queues Playwright admission for up to 15 minutes and **exits 1 on timeout** — it does not soft-skip green. Grep the output for the `N passed` line and paste it. An exit code alone is not proof.

- [ ] **Step 5: Prove the spec can fail.** Force `data-workspace-width-state` to `compact` at every width → the width test goes red at 768. Revert.

- [ ] **Step 6: Commit**

```bash
git add tests/ui-caring-contacts-workspace.spec.ts playwright.config.ts tests/playwright-project-isolation.test.ts
git commit -m "test(caring-contacts): browser proof of the workspace shell and all 24 overlays at six widths"
```

---

## Closing the plan

- [ ] **Step 1: Format and run the gate**

```bash
npm run format
```

Commit the result — formatting is in neither `test`, `typecheck` nor `lint`, and the push guard checks the pushed commit rather than the working tree.

```bash
npm run verify:pr-local
```

Paste the decisive line.

- [ ] **Step 2: Capture the atlas and list the differences**

Re-capture the 44-image atlas against the **production** routes and compare it image by image against the committed mockup baseline in `docs/caring-contacts/atlas/`. Comparison is manual — nothing in the repository diffs these automatically, and the only automated assertions are the count and the recorded dimensions.

Write the justified-difference list to `docs/caring-contacts/phase-2a-visual-differences.md`. These five are already known and expected; anything else on the list needs its own justification, and anything unexplained is a regression to fix rather than to document:

1. The first-contact-date control on review and activation (spec §2.3, which records that the mockup is out of date on that screen).
2. Reply-handling copy now describing the automated response (spec §2.1) instead of claiming replies are not received.
3. The month-12 contact shown as a distinct `closing` message type (spec §2.2).
4. Nine sendable contacts, not ten, when the coordinator sets the first contact to discharge plus seven days (Phase 1 decision 1).
5. Genuine `rail` and `split` compositions at 768 and 1024, which the mockup never had.

- [ ] **Step 3: Record the outstanding work**

```bash
npm run issues:add -- --title "Caring Contacts Phase 2B — the screens" --priority P2
```

Do not edit `docs/outstanding-issues.md` by hand; the inbox file is the only supported route.

- [ ] **Step 4: Stop.** Do not push and do not open a pull request without asking the owner.

---

## Self-review

**Spec coverage.** §2.1 automated reply — Task 1. §2.2 closing message — Tasks 4 and 11 (`snapshot.messageTextByType.closing`). §2.3 first-contact date — already in Phase 1's `schedule.ts`; its control is Plan 2B. §2.4 third-party pause — Phase 1. §2.5 cultural identity reporting-only — Phase 1's `cultural_identity_reports`; the equity report is Plan 2B. §2.6 retention — Task 10's `markRetentionCleared` and Task 11. §2.7 message rules as data — Phase 1, preserved by Task 1. §2.8 sealed seam — held throughout; Group 3 lives outside the seam on purpose. §2.9 clinical-record summary — Plan 2B. §2.10 rename — done in Phase 1. §3.2 datastore separation — Tasks 11 and 12. §4.2 all seven required screens — their rules and data land in Tasks 3–11; their surfaces are Plan 2B. §4.3 four recommended screens — Plan 2B, with assignment and coverage data ready at Task 6. §4.4 explained automation — Task 16. §5 phone — Tasks 15 and 19. §6 non-regression — the closing atlas step. §7 elevation brief items 3, 4, 6 and 7 — Tasks 16, 14, 15 and 18; items 1, 2 and 5 are screen-level and belong to Plan 2B. §8 behaviour — Phase 1 plus Tasks 3–7. §9 data model additions — Task 11.

**Known gaps, deliberate.** Every screen other than Today is Plan 2B. Loading, empty and error states beyond the route-group defaults are Plan 2C. The demo clock, synthetic caseload and training scenario scripts are Phase 3.

**Type consistency.** `ServiceState`, `PathwayVersion`, `PlanAssignment`, `AccessRecord`, `NotificationPreferences` and `TrainingRecord` are defined in Tasks 3, 4, 6, 8 and 9 and consumed under those exact names in Tasks 10, 11 and 14. `widthStateFor` is defined once in Task 15 and consumed in Tasks 18 and 19. `WorkspaceOverlayDefinition` is defined in Task 17 and consumed in Task 18.

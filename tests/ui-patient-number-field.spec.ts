import { expect, test, type Locator, type Page } from "playwright/test";

import { gotoApp } from "./helpers/spec-navigation";
import { clickWhenHydrated } from "./playwright-settlement";
import { PATIENT_PROFILE_STORAGE_KEY } from "../src/lib/patient-profile-storage";

/**
 * The browser half of #WFARS3 — the one thing the ledger row asked for and that
 * had never existed: "Playwright digit-by-digit asserts values never gain
 * foreign prefixes".
 *
 * The defect and its fix are already covered in jsdom by
 * `tests/patient-profile-panel.dom.test.tsx`. This spec exists because jsdom
 * cannot answer the question the incident actually raised. Two of the three
 * moving parts here are browser behaviour, not React behaviour:
 *
 *  - `<input type="number">` sanitises what its `value` IDL attribute reports,
 *    so the text a clinician sees and the string the component receives are not
 *    always the same string. The jsdom suite has to SIMULATE that; only a real
 *    engine can be asked.
 *  - The caret is owned by the browser. A remount, or a value written back over
 *    a draft, moves it — and where the next keystroke lands is the whole
 *    hazard. jsdom has no caret to move.
 *
 * WHY THIS IS A CLINICAL GUARD AND NOT A COSMETIC ONE. Every assertion below is
 * about a number that a dosing decision is made from:
 *
 *  1. CrCl 95 displaying as 42095 was the originally reported live symptom
 *     (desktop prescribing mode on psychiatry.tools). A renal-dosing field that
 *     silently carries a prefix is a dose calculated against the wrong kidney.
 *  2. The serum-creatinine case is the worse, previously-unknown half. An
 *     in-progress "1.0" was rewritten to "1" under the caret, so the next
 *     keystroke landed as "12" — and 12 mg/dL is inside the accepted range, so
 *     it stored with no warning at all. An order-of-magnitude dosing input
 *     error, entered by a clinician who typed 1.02 and was told nothing.
 *
 * ASSERT AFTER EVERY KEYSTROKE, NEVER ONLY THE FINAL VALUE. Both faults were
 * states BETWEEN keystrokes: the final value was often right, and checking only
 * the end of the sequence would have reported green throughout the incident.
 *
 * Surface under test: the desktop prescribing workspace's inline patient strip
 * (`PatientProfilePanel variant="compact"`), which is the surface the live pass
 * was run against. It is `max-sm:hidden`, so the viewport is pinned below
 * rather than inherited from the project device.
 */

// The prescribing workspace renders its patient strip on the submitted view.
// The strip does not depend on the query resolving to anything — verified with
// a deliberately unmatchable query — so the query here only chooses a realistic
// prescribing journey, and a catalogue change cannot quietly disarm this spec.
const PRESCRIBING_SUBMITTED_VIEW = "/?mode=prescribing&q=acamprosate&run=1";

// The strip is hidden below the `sm` breakpoint, where the phone dock owns the
// same form instead. Pinned so the release-matrix phone projects measure the
// surface this spec is about rather than skipping or failing on its absence.
test.use({ viewport: { width: 1280, height: 900 } });

/**
 * Let React commit and the browser paint before reading the field back.
 *
 * Reading immediately after a keystroke can observe the pre-render value and
 * miss a rewrite that lands one frame later — which is exactly the shape of the
 * defect. Two frames is a committed render, so a value that is going to be
 * rewritten has already been rewritten by the time it is asserted.
 */
async function settleRender(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function storedProfile(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    (key) => JSON.parse(window.sessionStorage.getItem(key) ?? "{}") as Record<string, unknown>,
    PATIENT_PROFILE_STORAGE_KEY,
  );
}

/** Wait for the field to be hydrated, so a keystroke reaches React rather than a static input. */
async function waitForHydratedField(field: Locator): Promise<void> {
  await expect
    .poll(
      async () =>
        field.evaluate((element) => {
          const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
          if (!propsKey) return false;
          const props = (element as unknown as Record<string, Record<string, unknown>>)[propsKey];
          return typeof props?.onChange === "function";
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function openPatientStrip(page: Page): Promise<void> {
  await gotoApp(page, PRESCRIBING_SUBMITTED_VIEW);
  const panel = page.getByTestId("patient-profile-panel");
  // Exactly one. Two mounted copies would make every field id below ambiguous,
  // and a second copy of this form is the desync #WFARS3 was reported from.
  await expect(panel).toHaveCount(1, { timeout: 30_000 });
  // The panel's open state is React-controlled. A tap before hydration toggles
  // the native <details> without React's onToggle, so React's state and the
  // DOM can disagree and the field may never show.
  // A streamed page can replace the panel after the tap, and the replacement mounts closed, so
  // tap again whenever the panel is closed rather than trusting the first tap. Reading the
  // panel's own open state never re-taps an open panel whose fields are still painting.
  const crcl = page.getByTestId("patient-crcl");
  await expect(async () => {
    const open = await panel.evaluate((element) => (element as HTMLDetailsElement).open);
    if (!open) await clickWhenHydrated(panel.locator("summary").first());
    await expect(crcl).toBeVisible({ timeout: 5_000 });
    await waitForHydratedField(crcl);
    // A replacement that lands after the field first painted mounts closed; this retries it.
    await expect(crcl).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Type one character at a time into the already-focused field, recording what
 * the box displays and what the shared profile holds after each keystroke.
 *
 * `page.keyboard.type` rather than `locator.press`, because `press` focuses the
 * element first: on the caret case below that would be the test moving the
 * caret rather than the field preserving it.
 */
async function typeOneCharacterAtATime(
  page: Page,
  field: Locator,
  characters: string,
  storedKey: string,
): Promise<{ displayed: string[]; stored: unknown[] }> {
  const displayed: string[] = [];
  const stored: unknown[] = [];
  for (const character of characters) {
    await page.keyboard.type(character);
    await settleRender(page);
    displayed.push(await field.inputValue());
    stored.push((await storedProfile(page))[storedKey] ?? null);
  }
  return { displayed, stored };
}

/**
 * A profile change arriving from somewhere that is not this field — a second
 * mounted copy of the panel on the same screen, or any other writer of the
 * shared store. It performs exactly what `writePatientProfile` performs: write
 * the session-scoped record, then notify. Both notifications the store listens
 * for are raised, so the sync does not depend on which one a given writer used.
 *
 * Every caller below asserts a SECOND field visibly took the change, so a
 * notification that stopped arriving fails loudly here instead of turning the
 * assertions that follow it into a test of nothing.
 */
async function writeProfileFromElsewhere(page: Page, changes: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ key, changes: incoming }) => {
      const current = JSON.parse(window.sessionStorage.getItem(key) ?? "{}") as Record<string, unknown>;
      window.sessionStorage.setItem(key, JSON.stringify({ ...current, ...incoming }));
      window.dispatchEvent(new StorageEvent("storage", { key }));
      window.dispatchEvent(new Event("clinical-kb-patient-profile-change"));
    },
    { key: PATIENT_PROFILE_STORAGE_KEY, changes },
  );
  await settleRender(page);
}

test.describe("Patient number fields — digit-by-digit entry in a real browser (#WFARS3)", () => {
  test("CrCl 95 shows exactly the digits typed, after every single keystroke", async ({ page }) => {
    await openPatientStrip(page);
    const crcl = page.getByTestId("patient-crcl");
    await crcl.click();

    const { displayed, stored } = await typeOneCharacterAtATime(page, crcl, "95", "crcl");

    // The reported symptom was "95" displaying as "42095". Nothing may ever
    // appear in front of the digits entered — not for one frame, not once.
    expect(displayed).toEqual(["9", "95"]);
    // 9 mL/min is a real (anuric-range) CrCl, so the first keystroke is stored
    // as itself. The point is that it is 9 and not 4209.
    expect(stored).toEqual([9, 95]);
    await expect(crcl).toHaveValue("95");
    expect((await storedProfile(page)).crcl).toBe(95);
  });

  test("a refused CrCl is replaced by one arriving from elsewhere, not typed on top of", async ({ page }) => {
    await openPatientStrip(page);
    const crcl = page.getByTestId("patient-crcl");
    await crcl.click();

    // 420 mL/min is out of range for CrCl (a QTc typed into the wrong box is
    // how it happened). It is refused: kept on screen for correction in place,
    // and never stored.
    await typeOneCharacterAtATime(page, crcl, "420", "crcl");
    await expect(crcl).toHaveValue("420");
    await expect(crcl).toHaveAttribute("aria-invalid", "true");
    expect((await storedProfile(page)).crcl).toBeNull();

    // The real CrCl is then entered somewhere else against the same profile.
    await writeProfileFromElsewhere(page, { crcl: 95, ageYears: 72 });
    await expect(page.getByTestId("patient-age")).toHaveValue("72");

    // This field must follow the profile. Keeping 420 is what put a foreign
    // prefix in front of the next entry and read 42095 — and, until it was
    // typed over, left this panel showing a CrCl the dosing alerts were not
    // being computed from.
    await expect(crcl).toHaveValue("95");
    expect(await crcl.inputValue()).not.toContain("420");
    await expect(crcl).not.toHaveAttribute("aria-invalid", "true");
  });

  test("an in-progress serum creatinine of 1.02 is never rewritten to 1 under the caret", async ({ page }) => {
    await openPatientStrip(page);
    // mg/dL, the unit in which the order-of-magnitude error is silent: the
    // wrongly-assembled "12" is inside the accepted range and stores without a
    // warning, where a µmol/L slip of the same shape would be refused.
    await page.getByRole("radio", { name: "mg/dL" }).click();
    const scr = page.getByTestId("patient-scr");
    await scr.click();

    const { displayed, stored } = await typeOneCharacterAtATime(page, scr, "1.02", "scr");

    expect(displayed[0]).toBe("1");
    // The "." keystroke is the one step whose reported value is an engine
    // decision rather than a product decision: a number input's `value` IDL
    // yields only a valid floating-point number, so the box legitimately reads
    // "1" (Chromium, observed) or "" while the visible text is "1.". Any of
    // those is fine. What must not happen is a foreign prefix.
    expect(["1.", "1", ""]).toContain(displayed[1]);
    // THE DECISIVE ASSERTION. Re-deriving the text from the stored number turns
    // "1.0" back into "1"; the "2" then lands as "12" mg/dL — a creatinine an
    // order of magnitude out, accepted in silence.
    expect(displayed[2]).toBe("1.0");
    expect(displayed[3]).toBe("1.02");

    await expect(scr).toHaveValue("1.02");
    expect((await storedProfile(page)).scr).toBe(1.02);
    // Not once, at any keystroke, was the wrong magnitude committed.
    expect(stored).not.toContain(12);

    // THE SAME REWRITE BY THE OTHER ROUTE A CLINICIAN TAKES — correcting the
    // last digit rather than typing straight through. This arm exists because
    // the straight-through sequence above cannot reach the fault in Chromium:
    // Chromium reports "1" (not "") for a half-typed "1.", so the stored number
    // never changes between those keystrokes and the sync that did the damage
    // never runs. Backspacing 1.02 to 1.0 DOES change it (1.02 -> 1), which is
    // exactly the sync the old code answered by re-deriving the text from the
    // number: the box became "1", and the corrected digit landed as "15" mg/dL
    // — in range, stored in silence, an order of magnitude out again.
    await page.keyboard.press("Backspace");
    await settleRender(page);
    await expect(scr).toHaveValue("1.0");
    expect((await storedProfile(page)).scr).toBe(1);

    await page.keyboard.type("5");
    await settleRender(page);
    await expect(scr).toHaveValue("1.05");
    expect((await storedProfile(page)).scr).toBe(1.05);
  });

  test("QTc 450 shows exactly the digits typed, and no partial is stored as a QTc", async ({ page }) => {
    await openPatientStrip(page);
    const qtc = page.getByTestId("patient-qtc");
    await qtc.click();

    const { displayed, stored } = await typeOneCharacterAtATime(page, qtc, "450", "qtc");

    expect(displayed).toEqual(["4", "45", "450"]);
    // "4" and "45" are below the QTc floor, so they are refused rather than
    // stored. A partial must read as unassessed — never as a short QTc, which
    // the alert engine would take as a reassuring measurement.
    expect(stored).toEqual([null, null, 450]);
    await expect(qtc).toHaveValue("450");
    await expect(qtc).not.toHaveAttribute("aria-invalid", "true");
  });

  test("a refused QTc does not outlive the measurement that replaces it", async ({ page }) => {
    await openPatientStrip(page);
    const qtc = page.getByTestId("patient-qtc");
    await qtc.click();

    // Abandoned mid-entry: 42 ms is below the floor, so nothing is stored.
    await typeOneCharacterAtATime(page, qtc, "42", "qtc");
    await expect(qtc).toHaveAttribute("aria-invalid", "true");
    expect((await storedProfile(page)).qtc).toBeNull();

    // The measured QTc is then recorded against the same profile elsewhere.
    await writeProfileFromElsewhere(page, { qtc: 450, ageYears: 72 });
    await expect(page.getByTestId("patient-age")).toHaveValue("72");

    // Treating a refusal as permission to keep the text is what left a panel
    // displaying a QTc nobody had entered, beside alerts computed from the one
    // that had been.
    await expect(qtc).toHaveValue("450");
    await expect(qtc).not.toHaveAttribute("aria-invalid", "true");
  });

  test("the caret survives a profile sync arriving while the field is being edited", async ({ page }) => {
    await openPatientStrip(page);
    const crcl = page.getByTestId("patient-crcl");
    await crcl.click();
    await typeOneCharacterAtATime(page, crcl, "12", "crcl");
    await expect(crcl).toHaveValue("12");

    // A number input reports no `selectionStart` in Chromium, so the caret
    // cannot be read directly. Where the NEXT keystroke lands is the caret, and
    // it is also the only thing about the caret that can harm a patient.
    await page.keyboard.press("ArrowLeft");

    // Mark this exact DOM node. React does not manage an attribute it never
    // set, so the marker survives any re-render — but not a remount, which
    // builds a new element and takes the caret and the focus with it. That is
    // why the fix syncs the value in place instead of remounting the field.
    await crcl.evaluate((element) => element.setAttribute("data-caret-probe", "original-node"));

    // News about a different field, from another writer of the shared profile.
    await writeProfileFromElsewhere(page, { ageYears: 72 });
    await expect(page.getByTestId("patient-age")).toHaveValue("72");

    // The draft is untouched, the element is the same one, and it is still focused.
    await expect(crcl).toHaveValue("12");
    await expect(crcl).toHaveAttribute("data-caret-probe", "original-node");
    await expect(crcl).toBeFocused();

    // And the caret is still between the 1 and the 2: "102", not "120".
    await page.keyboard.type("0");
    await settleRender(page);
    await expect(crcl).toHaveValue("102");
    expect((await storedProfile(page)).crcl).toBe(102);
  });
});

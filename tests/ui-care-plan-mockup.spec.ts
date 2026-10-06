import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "playwright/test";

import {
  JOINT_AUTHORSHIP_CLAIMS,
  PAPER_INTRO_TOGETHER,
  PAPER_INTRO_WRITTEN_BY_THE_TEAM,
  REPROACH_SHAPES,
  TEAM_WRITTEN_HEADINGS,
  TEAM_WRITTEN_LEAD_INS,
} from "./helpers/care-plan-patient-copy-claims";
import { visibleByTestId } from "./playwright-settlement";

/**
 * The Care Plan prototype's only browser proof.
 *
 * Tasks 1–10 verified this route family with Vitest under `css: false` in
 * jsdom, plus static parsing of the stylesheet as text. That combination cannot
 * see a rendered page at all: not a viewport, not a computed colour, not a page
 * break, not a focus ring. Everything asserted here is therefore something no
 * committed test could previously observe, and nothing here re-proves a
 * behaviour a reducer or DOM test already pins.
 *
 * Three things this file exists for above the rest:
 *
 * 1. **The pinned safety boundary.** `whatWouldMakeThisDifferent` is the single
 *    most safety-critical element in the product. It must sit above all plan
 *    content, never collapsed, truncated or clipped, at every width, in dark
 *    mode, in forced colours, and on paper.
 * 2. **Print.** Three print surfaces exist and none had ever been printed. The
 *    monochrome rule, the cascade against Tailwind utilities, page-break
 *    control, and — twice removed by accident on this project — the marker that
 *    tells a reader the document is fictional.
 * 3. **Ruling 57's replacement.** A static guard reading declarations as text
 *    was beaten four times by nine spellings of "paints nothing". It is frozen
 *    as a tripwire; `expectLooksLikeALink` is the spelling-immune successor,
 *    because a computed style has already resolved `var()`, alpha, shorthands,
 *    `all: unset` and every other spelling into one final value.
 *
 * Chromium evidence only. Nothing here is acceptance for physical iPhone
 * Safari or for an installed PWA.
 */

const CARE_PLAN_BASE = "/mockups/care-plan";

/**
 * The stable, directly reconstructable address of every route in the family,
 * built from `CARE_PLAN_BASE` and the two synthetic example identifiers the
 * route registry itself publishes. No record content ever appears in a URL.
 */
const EXAMPLE_PATIENT = "SYN-PATIENT-001";
const EXAMPLE_PRESENTATION = "SYN-PRESENTATION-001";
const patientPath = (patientId: string) => `${CARE_PLAN_BASE}/patients/${patientId}`;

const routes = {
  home: CARE_PLAN_BASE,
  patients: `${CARE_PLAN_BASE}/patients`,
  patient: patientPath(EXAMPLE_PATIENT),
  managementPlan: `${patientPath(EXAMPLE_PATIENT)}/management-plan`,
  managementPlanEdit: `${patientPath(EXAMPLE_PATIENT)}/management-plan/edit`,
  managementPlanReview: `${patientPath(EXAMPLE_PATIENT)}/management-plan/review`,
  managementPlanPrint: `${patientPath(EXAMPLE_PATIENT)}/management-plan/print`,
  patientPlan: `${patientPath(EXAMPLE_PATIENT)}/patient-plan`,
  patientPlanEdit: `${patientPath(EXAMPLE_PATIENT)}/patient-plan/edit`,
  patientPlanPrint: `${patientPath(EXAMPLE_PATIENT)}/patient-plan/print`,
  safetyPlan: `${patientPath(EXAMPLE_PATIENT)}/safety-plan`,
  safetyPlanEdit: `${patientPath(EXAMPLE_PATIENT)}/safety-plan/edit`,
  safetyPlanPrint: `${patientPath(EXAMPLE_PATIENT)}/safety-plan/print`,
  presentations: `${patientPath(EXAMPLE_PATIENT)}/presentations`,
  newPresentation: `${patientPath(EXAMPLE_PATIENT)}/presentations/new`,
  presentation: `${patientPath(EXAMPLE_PATIENT)}/presentations/${EXAMPLE_PRESENTATION}`,
  history: `${patientPath(EXAMPLE_PATIENT)}/history`,
  reviews: `${CARE_PLAN_BASE}/reviews`,
  team: `${CARE_PLAN_BASE}/team`,
  governance: `${CARE_PLAN_BASE}/governance`,
  systemStates: `${CARE_PLAN_BASE}/system-states`,
} as const;

/** The approved heading of every route, in the order the route table declares them. */
const ROUTE_HEADINGS: readonly (readonly [string, string])[] = [
  [routes.home, "Home"],
  [routes.patients, "Patients"],
  [routes.patient, "Patient overview"],
  [routes.managementPlan, "Management Plan"],
  [routes.managementPlanEdit, "Draft Management Plan Version"],
  [routes.managementPlanReview, "Review submitted version"],
  [routes.managementPlanPrint, "Print Management Plan"],
  [routes.patientPlan, "Patient Plan"],
  [routes.patientPlanEdit, "Draft Patient Plan"],
  [routes.patientPlanPrint, "Print Patient Plan"],
  [routes.safetyPlan, "Personal Safety Plan"],
  [routes.safetyPlanEdit, "Draft Personal Safety Plan Version"],
  [routes.safetyPlanPrint, "Print Personal Safety Plan"],
  [routes.presentations, "ED Presentations"],
  [routes.newPresentation, "Record ED Presentation"],
  [routes.presentation, "ED Presentation"],
  [routes.history, "History"],
  [routes.reviews, "Reviews"],
  [routes.team, "Team"],
  [routes.governance, "Governance"],
  [routes.systemStates, "System states"],
];

/** Every deterministic specimen the address bar may name. */
const SCENARIOS = [
  "empty",
  "no-current-plan",
  "overdue-plan",
  "withdrawn-plan",
  "unverified-contact",
  "identity-uncertain",
  "version-conflict",
  "offline",
  "permission-unavailable",
  "launch-failure",
  "print-failure",
] as const;

const REQUIRED_WIDTHS = [320, 390, 768, 1024, 1440] as const;

/**
 * The floor a primary tap target has to clear, in CSS pixels.
 *
 * This repository's convention is `min-h-12` / `var(--spacing-tap)`, which is
 * 48 px, and it is deliberately above both the WCAG AA minimum (24 px, 2.5.8)
 * and the AAA enhanced criterion (44 px, 2.5.5): `min-h-11` was tried and
 * reintroduced a known sub-pixel `ui-smoke` flake, so 44 is banned here rather
 * than merely unambitious.
 *
 * 47.5 rather than 48 because a fractional viewport can round a 48 px box to
 * 47.98; a `min-h-11` regression measures 44, which is nowhere near it. The
 * first shape of these guards asserted 44 while their own messages said 48, so
 * the exact edit this repository bans would have passed them.
 */
const TAP_TARGET_FLOOR = 47.5;

const SYNTHETIC_MARKER = "Synthetic prototype — fictional data only";
const MEMORY_NOTICE = "Nothing is saved. Reloading this page starts over.";
const PINNED_BOUNDARY_SENTENCE = "Do not rely on this plan if today is different";

const captureEvidence = process.env.CARE_PLAN_CAPTURE_EVIDENCE === "1";
const captureDirectory = resolve(process.cwd(), ".local", "care-plan", "atlas");

const phoneDock = (page: Page) => page.getByRole("navigation", { name: "Care Plan phone navigation" });
const desktopRail = (page: Page) => page.getByRole("navigation", { name: "Care Plan sections" });
const pinnedBoundary = (page: Page) => page.getByTestId("care-plan-pinned-safety-boundary");
const printPaper = (page: Page) => page.locator("[data-print-output]");

// --- Helpers ----------------------------------------------------------------

async function gotoRoute(page: Page, route: string, heading?: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  // The shell's synthetic marker is the first thing every route paints, so it
  // doubles as the "this route actually rendered" signal.
  //
  // `.first()` because the framework streams the route subtree, so mid-load the
  // shell is transiently present twice and a bare locator raises a strict-mode
  // violation instead of waiting. That surfaced only once the machine was under
  // enough load to widen the window, which is exactly the shape of flake worth
  // fixing at the locator rather than by loosening the assertion: what is being
  // asserted here is that the marker is present and says the right thing, never
  // how many copies the streaming DOM holds at that instant.
  await expect(page.getByTestId("care-plan-synthetic-marker").first()).toHaveText(SYNTHETIC_MARKER, {
    timeout: 45_000,
  });

  // Rendered is not the same as interactive, and this suite is the first thing
  // able to tell the difference. Every control is server-rendered, so a click
  // that lands before hydration changes the DOM and is then thrown away when
  // React reconciles — which looks in a report exactly like a control that does
  // not work. Wait for a React root to be attached before touching anything.
  await page.waitForFunction(
    () =>
      Object.keys(document).some((key) => key.startsWith("__reactContainer")) ||
      Object.keys(document.body).some((key) => key.startsWith("__react")) ||
      (document.body.firstElementChild !== null &&
        Object.keys(document.body.firstElementChild).some((key) => key.startsWith("__react"))),
    undefined,
    { timeout: 45_000 },
  );

  if (heading !== undefined) {
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  }
}

/**
 * Choose a different synthetic clinician, and prove the choice took.
 *
 * Retried as a block on purpose. The control is server-rendered, so a
 * `selectOption` that lands a frame before hydration sets the native value,
 * React never sees the event, and the next reconcile puts the previous
 * clinician back — silently. Asserting the identity block after the change is
 * what makes that visible instead of surfacing minutes later as "the role
 * switcher does not work".
 */
async function switchRole(page: Page, optionLabel: string, expectedName: string) {
  await expect(async () => {
    await page.getByLabel("Prototype role").selectOption({ label: optionLabel });
    await expect(page.getByTestId("care-plan-active-user")).toContainText(expectedName, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

const SENIOR = ["Dr Taylor Fiction — Named senior clinician", "Dr Taylor Fiction"] as const;
const LIAISON = ["Morgan Sample — Emergency department mental health liaison clinician", "Morgan Sample"] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
  );
  expect(overflow, `the page scrolls sideways at ${page.viewportSize()?.width}px`).toBeLessThanOrEqual(2);
}

/**
 * The Current Plan's metadata block, and the assertion that it has not moved.
 *
 * Both halves deliberately go through `innerText`. Mixing capture methods is how
 * the first version of two of these journeys failed: `innerText` is CSS-aware, so
 * it returns `PLAN OWNER` for a `text-transform: uppercase` label and puts real
 * newlines between rows, while `toHaveText` compares whitespace-normalised
 * `textContent` and sees `Plan owner` on one line. The two strings described the
 * same, entirely unchanged plan and still could not match. `expect.poll` keeps
 * the retry that a plain equality would throw away.
 */
const planMetadata = (page: Page) => page.getByTestId("care-plan-current-plan-metadata");

/**
 * The block's Management-Plan-owned facts only: version and status, owner,
 * approver, approval date, next review date, team.
 *
 * The block's last row is a **cross-reference** to the Personal Safety Plan, and
 * that row is supposed to move when a new safety-plan version is made current —
 * the two documents are independent, but the clinician's card names the current
 * one. A whole-block comparison therefore reads a correct linkage update as the
 * clinical plan having moved, which is what the first version of the safety-plan
 * journey did. The split is asserted rather than assumed, so a rename of that
 * row fails loudly instead of quietly widening what counts as "unchanged".
 */
async function readPlanMetadata(page: Page): Promise<string> {
  const text = (await planMetadata(page).innerText()).trim();
  expect(text, "the Current Plan metadata block rendered nothing to compare against").toContain("Current version");
  const boundary = text.search(/^personal safety plan$/im);
  expect(
    boundary,
    "the Current Plan metadata block no longer carries a Personal Safety Plan row, so this helper is splitting on nothing",
  ).toBeGreaterThan(0);
  return text.slice(0, boundary).trim();
}

async function expectPlanMetadataUnchanged(page: Page, before: string) {
  await expect
    .poll(
      async () => {
        const text = (await planMetadata(page).innerText()).trim();
        const boundary = text.search(/^personal safety plan$/im);
        return boundary > 0 ? text.slice(0, boundary).trim() : text;
      },
      {
        message: "the Current Plan moved when nothing in this journey should have moved it",
        timeout: 10_000,
      },
    )
    .toBe(before);
}

/**
 * The standing statement that this is fictional and holds nothing. Both halves
 * are asserted: the synthetic-data label alone does not warn somebody
 * demonstrating the tool that a reload discards what they are showing.
 */
async function expectSyntheticBoundary(page: Page) {
  // Scoped to the shell banner, which is the one place the standing statement
  // lives. That keeps this strict about *where* the boundary is rather than
  // merely that the string exists somewhere, and it is immune to the streaming
  // duplicate `gotoRoute` documents above.
  const banner = page.getByRole("banner").first();
  await expect(banner.getByTestId("care-plan-synthetic-marker")).toHaveText(SYNTHETIC_MARKER);
  await expect(banner.getByText(MEMORY_NOTICE, { exact: true })).toBeVisible();
}

/** No control may sit underneath the phone dock, where a thumb cannot reach it. */
async function expectPhoneDockClearance(page: Page, control: Locator) {
  const width = page.viewportSize()?.width ?? 0;
  if (width >= 768) return;
  // `block: "center"` rather than `scrollIntoViewIfNeeded`, which stops the
  // moment the control is inside the viewport — including underneath the fixed
  // dock. For a control near the end of the document, centring is the browser's
  // maximum scroll, so this asks the question that matters: with the page
  // scrolled as far as it goes, can a thumb still reach this?
  await control.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const [controlBox, dockBox] = await Promise.all([control.boundingBox(), phoneDock(page).boundingBox()]);
  expect(controlBox, "the control has no box to measure").not.toBeNull();
  expect(dockBox, "the phone dock has no box to measure").not.toBeNull();
  expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
}

/** One first-level heading per route, and it is the route's own. */
async function expectSinglePageHeading(page: Page, heading: string) {
  const headings = page.getByRole("heading", { level: 1 });
  await expect(headings).toHaveCount(1);
  await expect(headings).toHaveText(heading);
}

type Rgba = { r: number; g: number; b: number; a: number };

function parseColour(value: string): Rgba | null {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (match === null) return null;
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter((part) => part.length > 0)
    .map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
}

const sameColour = (a: Rgba, b: Rgba) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/**
 * Resolve a CSS-module class to the exact hashed token the build produced.
 *
 * Deliberately not `[class*="queueAction"]`: that substring also matches the
 * `queueActions` wrapper, and a guard that silently measures the wrong element
 * is the failure mode this whole file exists to replace. The name has to sit in
 * the token on its own, between `_`/`-` boundaries, so `queueActions` can never
 * answer for `queueAction`.
 *
 * Both build shapes are matched on purpose. `next dev` emits
 * `care-plan-module__<hash>__<name>` and a production build emits
 * `care-plan_<name>__<hash>`, and this suite runs against the production build —
 * an `endsWith("__" + name)` test passes in dev and finds nothing in the very
 * build the gate actually measures.
 *
 * It throws rather than degrading when the class is absent from the page.
 */
async function moduleClassSelector(page: Page, name: string): Promise<string> {
  const token = await page.evaluate((wanted) => {
    const boundary = new RegExp(`(^|[-_])${wanted}([-_]|$)`);
    for (const element of document.querySelectorAll<HTMLElement>("[class]")) {
      for (const candidate of element.classList) {
        if (boundary.test(candidate)) return candidate;
      }
    }
    return null;
  }, name);
  expect(token, `no element on ${page.url()} carries the CSS-module class \`${name}\``).not.toBeNull();
  return `.${token!}`;
}

type Affordance = {
  /** A real underline, drawn in ink that is not transparent. */
  underline: boolean;
  /** A visible border, drawn in ink that is not transparent. */
  border: boolean;
  /**
   * Ink that differs from the prose around it.
   *
   * Contracted for the accent-coloured text links and deliberately **not** for
   * the bordered pill controls. Requiring it everywhere was the first shape of
   * this gate, and a probe showed it would go red for a pill recoloured to match
   * its four siblings — a change that takes nothing away from a reader, because
   * a pill's affordance is its border and its 48 px box. A guard that reddens
   * for a harmless change is how a guard gets relaxed later for a harmful one.
   */
  distinctColour: boolean;
};

/**
 * Ruling 57's replacement, and the whole reason this file is a browser test.
 *
 * The frozen static guard reads declarations as text, so `transparent`,
 * `rgb(0 0 0 / 0.0%)`, a `var()` fallback, a colour behind one level of
 * indirection, `all: unset`, and `:is(.x)` are nine different problems to it. A
 * computed style is the value the pixel is painted from: every one of those
 * spellings has already collapsed into the same resolved answer by the time it
 * is read here, so this assertion cannot be beaten by a tenth spelling.
 *
 * What it decides: this control is distinguishable from the prose around it
 * without relying on colour alone. The reference is not a hard-coded token but
 * a throwaway span inserted at the control's own position in the tree, so it
 * measures the colour this text would have had if it were ordinary body copy.
 */
async function expectLooksLikeALink(page: Page, name: string, affordance: Affordance) {
  const selector = await moduleClassSelector(page, name);
  const control = page.locator(selector).first();
  await expect(control, `\`${name}\` does not render on ${page.url()}`).toBeVisible();

  const measured = await control.evaluate((element) => {
    const probe = document.createElement("span");
    probe.textContent = "reference";
    element.parentElement?.insertBefore(probe, element);
    const surroundingColour = getComputedStyle(probe).color;
    probe.remove();

    let background = "rgba(0, 0, 0, 0)";
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const candidate = getComputedStyle(node).backgroundColor;
      if (!/rgba\([^)]*,\s*0\)$/.test(candidate) && candidate !== "transparent") {
        background = candidate;
        break;
      }
    }

    const style = getComputedStyle(element);
    const sides = ["Top", "Right", "Bottom", "Left"] as const;
    const borders = sides.map((side) => ({
      width: Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)),
      colour: style.getPropertyValue(`border-${side.toLowerCase()}-color`),
      style: style.getPropertyValue(`border-${side.toLowerCase()}-style`),
    }));

    return {
      colour: style.color,
      surroundingColour,
      background,
      decorationLine: style.textDecorationLine,
      decorationColour: style.textDecorationColor,
      decorationThickness: style.textDecorationThickness,
      fontWeight: style.fontWeight,
      borders,
    };
  });

  const colour = parseColour(measured.colour);
  const surrounding = parseColour(measured.surroundingColour);
  const background = parseColour(measured.background);
  expect(colour, `\`${name}\` has an unreadable computed colour: ${measured.colour}`).not.toBeNull();
  expect(surrounding, "the reference span has an unreadable computed colour").not.toBeNull();
  // Fails closed, like its two siblings above. Chromium serialises some colours
  // as `color(srgb …)` or `color-mix(…)`, which `parseColour` cannot read — and
  // an unreadable background used to make this function *skip* both the
  // "not its own background colour" and the "border differs from the surface"
  // checks with nothing going red. A guard that quietly stops checking is the
  // exact shape this whole file replaced.
  expect(background, `\`${name}\` has an unreadable computed background: ${measured.background}`).not.toBeNull();

  // It paints at all. Every one of Ruling 57's nine spellings ended here.
  expect(
    colour!.a,
    `\`${name}\` paints its text in ink that is effectively invisible (${measured.colour})`,
  ).toBeGreaterThanOrEqual(0.5);
  expect(
    sameColour({ ...colour!, a: 1 }, { ...background!, a: 1 }),
    `\`${name}\` paints its text the same colour as its own background (${measured.colour})`,
  ).toBe(false);

  // For a text link, it is not the same colour as the prose it sits in.
  if (affordance.distinctColour) {
    expect(
      sameColour(colour!, surrounding!),
      `\`${name}\` is exactly the colour of the text around it (${measured.colour}), so colour distinguishes it from nothing`,
    ).toBe(false);
  }

  if (affordance.underline) {
    expect(
      measured.decorationLine,
      `\`${name}\` carries no underline, so it is distinguished from body text by colour alone`,
    ).toContain("underline");
    const decoration = parseColour(measured.decorationColour);
    expect(decoration, `\`${name}\` has an unreadable decoration colour: ${measured.decorationColour}`).not.toBeNull();
    expect(
      decoration!.a,
      `\`${name}\` draws its underline in ink that is effectively invisible (${measured.decorationColour})`,
    ).toBeGreaterThanOrEqual(0.5);
    expect(
      Number.parseFloat(measured.decorationThickness) || 1,
      `\`${name}\` draws a zero-thickness underline`,
    ).toBeGreaterThan(0);
  }

  if (affordance.border) {
    const painted = measured.borders.filter((border) => {
      const ink = parseColour(border.colour);
      if (border.width <= 0 || border.style === "none" || ink === null || ink.a < 0.5) return false;
      // A border the colour of the surface behind it is a border nobody sees,
      // which is the same defect as a transparent one wearing a different name.
      // `background` is asserted non-null above, so an unreadable surface colour
      // reddens rather than turning this comparison off.
      return !sameColour({ ...ink, a: 1 }, { ...background!, a: 1 });
    });
    expect(
      painted.length,
      `\`${name}\` draws no visible border on any side (${JSON.stringify(measured.borders)})`,
    ).toBeGreaterThan(0);
  }
}

/**
 * The monochrome contract, asserted on resolved ink rather than on a class name.
 *
 * This is the test of whether `[data-print-monochrome]` genuinely wins the
 * cascade against every Tailwind utility and CSS-module rule inside the printed
 * subtree — a greyscale printer flattens tint, so a state carried by tint is a
 * state lost on paper. Call it with print media already emulated.
 */
async function expectMonochromePaper(page: Page, surface: string) {
  const ink = await printPaper(page).evaluate((element) => {
    const samples = [element, ...element.querySelectorAll("h2, h3, p, li, dd")].slice(0, 40);
    return samples.map((node) => {
      const style = getComputedStyle(node as Element);
      return { colour: style.color, background: style.backgroundColor };
    });
  });
  expect(ink.length, `${surface}: nothing was sampled, so this asserts nothing`).toBeGreaterThan(5);
  for (const sample of ink) {
    const colour = parseColour(sample.colour);
    expect(colour, `${surface}: unreadable printed colour: ${sample.colour}`).not.toBeNull();
    expect(
      colour!.r + colour!.g + colour!.b,
      `${surface}: printed text is not black on paper (${sample.colour}), so a greyscale printer decides its contrast`,
    ).toBe(0);
    const background = parseColour(sample.background);
    // Fails closed on a colour it cannot read. Only a genuinely transparent
    // background is exempt — that is "no tint", which is the thing being asked
    // for; an unreadable one used to skip the check silently.
    expect(background, `${surface}: unreadable printed background: ${sample.background}`).not.toBeNull();
    if (background!.a > 0) {
      expect(
        background!.r + background!.g + background!.b,
        `${surface}: printed background is tinted (${sample.background}), so a state carried by tint is lost on greyscale`,
      ).toBe(765);
    }
  }
}

/**
 * Every block in the printed subtree asks the browser to keep it whole.
 *
 * Half of somebody's reasons for living on the previous sheet, or a crisis
 * number separated from the sentence saying it is not an emergency service, is
 * not an acceptable printed document. Call it with print media emulated.
 */
async function expectPageBreakControl(page: Page, surface: string) {
  const breaks = await printPaper(page).evaluate((element) =>
    [...element.querySelectorAll("[data-print-break-inside='avoid']")].map(
      (node) => getComputedStyle(node).breakInside,
    ),
  );
  expect(breaks.length, `${surface}: no printed block asks to be kept whole`).toBeGreaterThan(0);
  for (const value of breaks)
    expect(value, `${surface}: a printed block may be split across a page break`).toBe("avoid");
}

/**
 * The pinned safety boundary sits above every other piece of plan content.
 * Asserted geometrically, from painted boxes — document order was already
 * proved in jsdom, and a `grid-row` or `order` rule could invert it visually
 * with every one of those assertions still green.
 */
async function expectPinnedBoundaryAbovePlanContent(page: Page) {
  const boundary = pinnedBoundary(page).first();
  await expect(boundary).toBeVisible();
  await expect(boundary).toContainText(PINNED_BOUNDARY_SENTENCE);

  const boundaryBox = await boundary.boundingBox();
  expect(boundaryBox, "the pinned safety boundary has no painted box").not.toBeNull();
  expect(boundaryBox!.height, "the pinned safety boundary is collapsed to nothing").toBeGreaterThan(8);

  const sections = page.getByTestId("care-plan-first-minute-sections").first();
  await expect(sections).toBeVisible();
  const sectionsBox = await sections.boundingBox();
  expect(sectionsBox, "the first-minute sections have no painted box").not.toBeNull();
  expect(
    boundaryBox!.y + boundaryBox!.height,
    "the pinned safety boundary is not above the plan content it guards",
  ).toBeLessThanOrEqual(sectionsBox!.y + 1);

  // Never collapsed, truncated, or clipped: the painted box must hold the text.
  const clipping = await boundary.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      maxHeight: style.maxHeight,
      overflow: style.overflow,
      webkitLineClamp: style.getPropertyValue("-webkit-line-clamp"),
      textOverflow: style.textOverflow,
      display: style.display,
      visibility: style.visibility,
    };
  });
  expect(clipping.display, "the pinned safety boundary is not displayed").not.toBe("none");
  expect(clipping.visibility, "the pinned safety boundary is hidden").not.toBe("hidden");
  expect(clipping.webkitLineClamp, "the pinned safety boundary is line-clamped").toMatch(/^(none|)$/);
  expect(
    clipping.scrollHeight - clipping.clientHeight,
    "the pinned safety boundary's content is taller than the box painting it, so it is clipped",
  ).toBeLessThanOrEqual(1);
}

/**
 * Write something into every section of the open Patient Plan draft.
 *
 * `locator.all()` does not wait, so the wait for the first field is the whole
 * point: without it a fill loop that runs one frame early silently writes
 * nothing at all and the test fails four minutes later on a control that is
 * still, correctly, unavailable.
 */
async function fillEverySection(page: Page, text = "We wrote this together at the bedside, in your words.") {
  const fields = page.locator("form textarea");
  await expect(fields.first()).toBeVisible();
  for (const field of await fields.all()) {
    await field.fill(text);
  }
}

/**
 * What a clinician types into a copy written for somebody who took no part.
 *
 * The default fill above is the co-produced journey's, and it contains the
 * literal phrase `we wrote this together` — which is one of the forbidden
 * claims. Reusing it on the team-written sheet would redden the guard on the
 * clinician's own sentence rather than on the product's wording, and the obvious
 * "fix" for that failure is to weaken the guard. So the situation gets its own
 * neutral text instead, chosen to carry none of the forbidden phrasings and none
 * of the reproach shapes.
 */
const TEAM_WRITTEN_FILL = "Your team wrote this down after talking about what usually helps.";

/**
 * The same rule as the jsdom suite, on a real rendered page.
 *
 * `JOINT_AUTHORSHIP_CLAIMS` and `REPROACH_SHAPES` are imported rather than
 * restated: one set of forbidden phrasings, checked on the authoring form, on
 * the reading surface, and — for the first time here — on paper that a browser
 * actually laid out.
 */
async function expectNoClaimOfJointAuthorship(surface: Locator, where: string) {
  const text = await surface.innerText();
  expect(text.trim().length, `${where} rendered no text, so this asserts nothing`).toBeGreaterThan(0);
  for (const claim of JOINT_AUTHORSHIP_CLAIMS) {
    expect(claim.test(text), `${where} still claims joint authorship: ${claim}`).toBe(false);
  }
}

/**
 * Nothing on the person's own sheet reads as a reproach. Non-participation is
 * never labelled non-compliance, and this is the surface where it would do the
 * most harm: the paper they are handed and keep.
 */
async function expectNoReproach(surface: Locator, where: string) {
  const text = await surface.innerText();
  expect(text.trim().length, `${where} rendered no text, so this asserts nothing`).toBeGreaterThan(0);
  for (const shape of REPROACH_SHAPES) {
    expect(shape.test(text), `${where} reads as a reproach: ${shape}`).toBe(false);
  }
}

// --- Journeys ---------------------------------------------------------------

test.describe("@mockup Care Plan synthetic prototype", () => {
  test("every route in the family is directly reconstructable from its address", async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [route, heading] of ROUTE_HEADINGS) {
      await gotoRoute(page, route, heading);
      await expectSinglePageHeading(page, heading);
      await expectSyntheticBoundary(page);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("the pinned safety boundary is above the plan at every supported width", async ({ page }) => {
    test.setTimeout(180_000);
    for (const width of REQUIRED_WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await gotoRoute(page, routes.managementPlan, "Management Plan");
      await expectPinnedBoundaryAbovePlanContent(page);
      await expectNoHorizontalOverflow(page);

      // The full fifth section is still there in full, never replaced by the
      // pinned line and never behind a disclosure.
      const fifth = page.getByRole("heading", { name: "5. What would make this presentation different" });
      await expect(fifth).toBeVisible();
      await expect(page.locator("details")).toHaveCount(0);
    }
  });

  test("the pinned safety boundary survives dark mode and forced colours", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.emulateMedia({ colorScheme: "dark" });
    await gotoRoute(page, routes.managementPlan, "Management Plan");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expectPinnedBoundaryAbovePlanContent(page);

    await page.emulateMedia({ colorScheme: "light", forcedColors: "active" });
    await gotoRoute(page, routes.managementPlan, "Management Plan");
    await expectPinnedBoundaryAbovePlanContent(page);
    // Forced colours flattens tint, so the border is what still carries the box.
    const border = await pinnedBoundary(page)
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { width: Number.parseFloat(style.borderTopWidth), colour: style.borderTopColor };
      });
    expect(border.width, "the pinned boundary loses its outline in forced colours").toBeGreaterThan(0);
    const ink = parseColour(border.colour);
    expect(ink, `unreadable forced-colours border: ${border.colour}`).not.toBeNull();
    expect(ink!.a, "the pinned boundary's forced-colours border is transparent").toBeGreaterThanOrEqual(0.5);

    await page.emulateMedia({ forcedColors: "none" });
  });

  /**
   * Ruling 57's replacement. Each entry names the affordance that class is
   * contracted to carry: the four accent text links draw a real underline in
   * ink that differs from the prose around them, and the two pill controls draw
   * a real border in ink that differs from the surface behind them. Every one of
   * the six must paint at all.
   */
  test("every named link affordance still looks like a control in a real browser", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });

    const link = { underline: true, border: false, distinctColour: true } as const;
    const pill = { underline: false, border: true, distinctColour: false } as const;
    const affordances: readonly (readonly [string, string, string, Affordance])[] = [
      [routes.patient, "Patient overview", "pinnedBoundaryLink", link],
      [routes.patient, "Patient overview", "patientNavSecondary", pill],
      [routes.history, "History", "inlineLink", link],
      [routes.presentations, "ED Presentations", "timelineLink", link],
      [routes.reviews, "Reviews", "queueAction", { ...link, border: true }],
      [routes.systemStates, "System states", "specimenLink", link],
    ];

    for (const [route, heading, name, affordance] of affordances) {
      await gotoRoute(page, route, heading);
      await expectLooksLikeALink(page, name, affordance);
    }
  });

  test("the clinician Management Plan reaches paper whole", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoRoute(page, routes.managementPlanPrint, "Print Management Plan");
    await page.emulateMedia({ media: "print" });

    const paper = printPaper(page);
    await expect(paper).toBeVisible();

    // The one line that says the document is fictional. Removed by accident
    // twice on this project; it is inside the printed subtree, because the
    // shared rule hides everything outside it.
    await expect(paper.getByText("Synthetic prototype — fictional people, teams, and hospitals")).toBeVisible();
    await expect(paper.getByText(/Printed on \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    await expect(paper.getByText(/Confidential clinical document/)).toBeVisible();
    await expect(paper.getByTestId("care-plan-print-record-warning")).toBeVisible();

    // The pinned boundary prints, above the plan, in full.
    await expectPinnedBoundaryAbovePlanContent(page);

    /*
      And on paper it carries its own lines, not a count of them. On screen the
      jump link resolves the pointer; paper has nothing to jump to, and a page
      break can leave a reader at 3am holding `5 listed` with its referent on the
      next sheet. Vitest runs with `css: false`, so print media is only ever
      visible here.
    */
    const boundary = pinnedBoundary(page).first();
    await expect(boundary, "the printed boundary still counts its lines instead of printing them").not.toContainText(
      /\d+ listed/,
    );
    const printedBoundaryLines = boundary.getByTestId("care-plan-pinned-boundary-lines");
    await expect(printedBoundaryLines).toBeVisible();
    await expect(printedBoundaryLines).toContainText("What would make this presentation different");
    const printedItems = printedBoundaryLines.locator("li");
    await expect(printedItems, "the printed boundary does not carry all five of Rowan's lines").toHaveCount(5);
    await expect(printedItems.first()).toContainText("New or worsening physical symptoms");
    await expect(printedItems.last()).toContainText("safeguarding concern");

    // Above the plan content, on the paper, and not merely present somewhere.
    const linesBox = await printedBoundaryLines.boundingBox();
    const planBox = await page.getByTestId("care-plan-first-minute-sections").first().boundingBox();
    expect(linesBox, "the printed boundary lines have no painted box").not.toBeNull();
    expect(planBox, "the first-minute sections have no painted box").not.toBeNull();
    expect(
      linesBox!.y + linesBox!.height,
      "the boundary's own lines are not above the plan content they guard",
    ).toBeLessThanOrEqual(planBox!.y + 1);

    // Screen chrome does not.
    await expect(desktopRail(page)).toBeHidden();
    await expect(phoneDock(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Print this plan" })).toBeHidden();

    await expectMonochromePaper(page, "the clinician summary");
    await expectPageBreakControl(page, "the clinician summary");

    await page.emulateMedia({ media: "screen" });
  });

  test("the Personal Safety Plan prints as the person's own document", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoRoute(page, routes.safetyPlanPrint, "Print Personal Safety Plan");
    await page.emulateMedia({ media: "print" });

    const paper = printPaper(page);
    await expect(paper).toBeVisible();
    await expect(paper.getByText("Synthetic prototype — fictional people, teams, and hospitals")).toBeVisible();
    await expect(paper.getByRole("heading", { name: "My Personal Safety Plan" })).toBeVisible();

    // Every one of the person's own headings reaches the paper. A section
    // silently dropped from somebody's own safety plan is the worst defect this
    // surface can carry.
    for (const heading of [
      "My warning signs",
      "Making my surroundings safer",
      "My reasons for living",
      "Things I can do myself",
      "People and places that help me feel connected",
      "Family, friends, and supports I can contact",
      "Professional and emergency support",
    ]) {
      await expect(paper.getByRole("heading", { name: heading })).toBeVisible();
    }

    // Nothing in the person's own words is empty on paper, and nothing on it
    // says a part of their life was "Not recorded".
    await expect(paper).not.toContainText("Not recorded");

    // The crisis line and the sentence that says it is not an emergency service
    // are never separated by a page break, and the sheet is readable on a
    // greyscale printer.
    await expectPageBreakControl(page, "the Personal Safety Plan");
    await expectMonochromePaper(page, "the Personal Safety Plan");

    await expect(paper.getByText(/000/).first()).toBeVisible();
    await expect(paper.getByText(/not an emergency service/i).first()).toBeVisible();

    await page.emulateMedia({ media: "screen" });
  });

  test("a clinician can search a name and reach the Current Plan", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRoute(page, routes.home, "Home");

    await page.getByRole("searchbox", { name: "Search synthetic patients" }).fill("Rowan");
    await page.getByRole("link", { name: "Open the full record for Rowan Sample" }).click();
    await expect(page).toHaveURL(new RegExp(`${routes.patient}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Patient overview" })).toBeFocused();

    await page
      .getByRole("navigation", { name: "Patient sections" })
      .getByRole("link", { name: "Management Plan" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Management Plan" })).toBeVisible();
    await expectPinnedBoundaryAbovePlanContent(page);
    await expect(page.getByTestId("care-plan-current-plan-metadata")).toBeVisible();
  });

  test("a version awaiting approval never displaces the Current Plan", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRoute(page, `${patientPath("SYN-PATIENT-002")}/management-plan`, "Management Plan");

    const current = page.getByRole("region", { name: "Current Plan" });
    const draft = page.getByRole("region", { name: "Version in progress" });
    await expect(current).toBeVisible();
    await expect(draft).toBeVisible();

    const [currentBox, draftBox] = await Promise.all([current.boundingBox(), draft.boundingBox()]);
    expect(currentBox).not.toBeNull();
    expect(draftBox).not.toBeNull();
    expect(currentBox!.y, "the version awaiting approval is painted above the plan actually in use").toBeLessThan(
      draftBox!.y,
    );
  });

  /**
   * Named for the half of the lifecycle it exercises. Drafting a version and
   * submitting it for approval are **not** covered by any browser journey — they
   * have reducer and DOM proof only — and the earlier name, "the whole authoring
   * lifecycle", claimed them. Approving is covered, in the staleness journey
   * below. The gap is recorded in `verification-report.md` rather than papered
   * over by a name.
   */
  test("a submitted version is returned for changes without the Current Plan moving", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoRoute(page, routes.reviews, "Reviews");

    // The named senior clinician is the only role that may decide.
    await switchRole(page, ...SENIOR);
    await page.getByRole("link", { name: "Compare and decide on Mira Example's version 2" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Review submitted version" })).toBeVisible();

    // Returning a version needs a reason, so the author knows what to change.
    await page.getByRole("button", { name: "Return for changes" }).click();
    const returnSheet = page.getByRole("dialog", { name: "Return version 2 for changes" });
    await expect(returnSheet).toBeVisible();
    await page.getByLabel("What needs to change").fill("Add the after-hours arrangement the team agreed on Tuesday.");
    await returnSheet.getByRole("button", { name: "Return for changes" }).click();

    // Returning navigates to the draft, so the outcome is reported on the form
    // surface rather than on the review one. The first version of this assertion
    // waited on `care-plan-review-outcome`, which by then no longer existed —
    // the notice had not gone missing, the reader had been moved.
    await expect(page.getByRole("heading", { level: 1, name: "Draft Management Plan Version" })).toBeVisible();
    await expect(page.getByTestId("care-plan-form-outcome")).toContainText(/returned/i);

    // The Current Plan is untouched by any of it. Reached by clicking, because
    // a reload would reset the prototype and make this assertion vacuous.
    await page.getByRole("link", { name: "Back to the Management Plan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Management Plan" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current Plan" })).toBeVisible();
    await expect(page.getByTestId("care-plan-current-plan-metadata")).toContainText("Current version 1");
    await expect(page.getByText("Awaiting Approval")).toHaveCount(0);
  });

  /**
   * The authoring half of the Management Plan lifecycle, which had no browser
   * proof of any kind: drafting a replacement version and asking a senior
   * clinician to decide on it. Approval, return-for-changes and withdrawal are
   * covered elsewhere in this file and are deliberately not repeated here.
   *
   * The assertion this journey exists for is the last one: **a replacement draft
   * never obscures or replaces the Current Plan before approval.** It is a
   * specification guarantee, and it is the one a clinician's safety depends on —
   * somebody reading the plan at 3am must be reading the plan actually in use,
   * not the version somebody submitted on Tuesday and nobody has decided on. The
   * sibling journey above proves it for a version the fixtures ship already
   * awaiting approval; this proves it for one created and submitted in the
   * browser, which is the path a clinician actually takes.
   */
  test("a replacement version is drafted and submitted without displacing the Current Plan", async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoRoute(page, routes.managementPlan, "Management Plan");

    // The plan in use, captured before anything is written, so "unchanged" is
    // measured against what was on the page rather than against an expectation.
    const currentPlanBefore = await readPlanMetadata(page);
    expect(currentPlanBefore, "this journey needs a Current Plan to leave alone").toContain("Current version 2");

    // The emergency physician may read and print, and deliberately may not
    // author a Management Plan Version. Authoring is the liaison clinician's.
    await switchRole(page, ...LIAISON);

    await page.getByRole("link", { name: "Draft a replacement version" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Draft Management Plan Version" })).toBeVisible();
    await page.getByRole("button", { name: "Start a replacement version" }).click();

    /*
     * A new version starts from the content of the Current Plan, so the six
     * required sections arrive already filled. The reason for the version does
     * not, deliberately: a later reader comparing two versions has nothing else
     * to tell them why this one replaced the last.
     */
    const revisionReason = page.getByLabel("Reason for this version");
    await expect(revisionReason).toBeVisible();
    await expect(revisionReason).toHaveValue("");
    await revisionReason.fill(
      "The after-hours arrangement changed on 12 August 2026, and the agreed order of assessment needs stating plainly.",
    );

    await page.getByRole("button", { name: "Submit for senior approval" }).click();
    const submitSheet = page.getByRole("dialog", { name: "Submit version 3 for senior approval" });
    await expect(submitSheet).toBeVisible();
    // The confirmation says, in so many words, what this journey then measures.
    await expect(submitSheet).toContainText("Current version 2 stays in use while it waits.");
    await submitSheet.getByRole("button", { name: "Submit for approval" }).click();

    // Submitting is a request for a decision, so it hands the reader to the
    // surface where that decision is made.
    await expect(page.getByRole("heading", { level: 1, name: "Review submitted version" })).toBeVisible();

    /*
     * And back to the plan itself, by clicking rather than reloading — a reload
     * would reset the prototype and make every assertion below vacuous.
     *
     * The Current Plan is still version 2, its metadata is byte-for-byte what it
     * was before the draft existed, the submitted version is shown as awaiting a
     * decision rather than as the plan, and it is painted *below* the plan in
     * use rather than in front of it.
     */
    await page.getByRole("link", { name: "Back to the Management Plan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Management Plan" })).toBeVisible();
    await expectPlanMetadataUnchanged(page, currentPlanBefore);

    const current = page.getByRole("region", { name: "Current Plan" });
    const awaiting = page.getByRole("region", { name: "Version in progress" });
    await expect(current).toBeVisible();
    await expect(awaiting).toBeVisible();
    await expect(awaiting).toContainText("Awaiting Approval version 3");
    await expect(awaiting).toContainText("Current version 2 remains in use until this version is approved.");

    const [currentBox, awaitingBox] = await Promise.all([current.boundingBox(), awaiting.boundingBox()]);
    expect(currentBox, "the Current Plan has no painted box").not.toBeNull();
    expect(awaitingBox, "the submitted version has no painted box").not.toBeNull();
    expect(currentBox!.y, "the version awaiting a decision is painted above the plan actually in use").toBeLessThan(
      awaitingBox!.y,
    );

    // The full plan on the page is still the approved one. A reader scrolling
    // past the summary card must not be reading the unapproved content.
    await expectPinnedBoundaryAbovePlanContent(page);
  });

  /**
   * The person's own copy, end to end and in a browser: the conversion refuses
   * to guess, the refusals block approval with a stated reason, a clinician
   * fills them, any clinical role may approve, and the result reaches paper.
   */
  test("a Patient Plan shows its gaps, blocks approval until they are filled, and prints", async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoRoute(page, routes.patientPlan, "Patient Plan");

    // The default synthetic user is an emergency physician, not a named senior
    // clinician: any clinical role may approve a patient copy, deliberately.
    await expect(page.getByTestId("care-plan-active-user")).toContainText("Dr Casey Example");
    await expect(page.getByTestId("care-plan-patient-plan-no-current")).toContainText(/no approved Patient Plan/i);

    await page.getByRole("button", { name: "Create the patient copy" }).click();
    await expect(page.getByTestId("care-plan-patient-plan-draft-notice")).toContainText(/sections still to write/i);

    await page.getByRole("link", { name: /Continue draft version|Write a new copy with this person/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Draft Patient Plan" })).toBeVisible();

    // Section 4 is never auto-converted, under any circumstances.
    const agreed = page.getByTestId("care-plan-patient-plan-form-gap-whatWeAgreedWillHappen");
    await expect(agreed).toBeVisible();
    await expect(agreed).toContainText(/never converted automatically/i);

    const approve = page.getByRole("button", { name: "Approve patient copy" });
    await expect(approve).toHaveAttribute("aria-disabled", "true");
    await expect(approve).not.toHaveAttribute("disabled", /.*/);
    const reason = page.getByTestId("care-plan-patient-plan-approve-unavailable");
    await expect(reason).toContainText(/cannot be approved while/i);

    await fillEverySection(page);
    await expect(page.getByRole("button", { name: "Approve patient copy" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByRole("button", { name: "Approve patient copy" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Patient Plan" })).toBeVisible();
    await expect(page.getByTestId("care-plan-patient-plan-version")).toContainText("Dr Casey Example");

    await page.getByRole("link", { name: "Print this copy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Print Patient Plan" })).toBeVisible();
    await page.emulateMedia({ media: "print" });

    const paper = printPaper(page);
    await expect(paper).toBeVisible();
    await expect(paper.getByText("Synthetic prototype — fictional people, teams, and hospitals")).toBeVisible();
    await expect(paper).not.toContainText("Not recorded");
    // Nothing clinical, and nothing from the internal record, reaches the person.
    await expect(paper).not.toContainText(/Management Plan Version|Awaiting Approval|audit|Disposition/i);

    // The sheet that actually leaves the building gets the same two paper
    // guarantees as the clinician's. It carried neither until fix round 1, while
    // the accessibility document described both as covering all three surfaces.
    await expectMonochromePaper(page, "the Patient Plan");
    await expectPageBreakControl(page, "the Patient Plan");

    await page.emulateMedia({ media: "screen" });
  });

  test("a Patient Plan is marked as needing updating, and its replacement never claims she helped write it", async ({
    page,
  }) => {
    test.setTimeout(480_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    const patient = "SYN-PATIENT-002";
    await gotoRoute(page, `${patientPath(patient)}/patient-plan`, "Patient Plan");

    await page.getByRole("button", { name: "Create the patient copy" }).click();
    await page.getByRole("link", { name: /Continue draft version|Write a new copy with this person/ }).click();
    await fillEverySection(page);
    await page.getByRole("button", { name: "Approve patient copy" }).click();
    await expect(page.getByTestId("care-plan-patient-plan-version")).toBeVisible();
    await expect(page.getByTestId("care-plan-patient-plan-stale")).toHaveCount(0);

    // Approve the version already awaiting approval, as the named senior
    // clinician. Every step from here is a client-side navigation: a full
    // reload would reset the prototype, which is the documented boundary.
    await switchRole(page, ...SENIOR);
    await desktopRail(page).getByRole("link", { name: "Reviews" }).click();
    await page.getByRole("link", { name: "Compare and decide on Mira Example's version 2" }).click();
    await page.getByRole("button", { name: "Approve version 2" }).click();
    await page
      .getByRole("dialog", { name: "Approve Management Plan version 2" })
      .getByRole("button", { name: "Approve and make Current" })
      .click();

    await page.getByRole("link", { name: "Back to the Management Plan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Management Plan" })).toBeVisible();
    await page.getByRole("link", { name: "Open the Patient Plan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Patient Plan" })).toBeVisible();

    // Marked, fully readable, not regenerated, not hidden, not withdrawn.
    await expect(page.getByTestId("care-plan-patient-plan-stale")).toContainText(/needs updating/i);
    await expect(page.getByTestId("care-plan-patient-plan-sections")).toBeVisible();
    await expect(page.getByTestId("care-plan-patient-plan-version")).toContainText("Version 1");

    /*
     * And it prints. Until now the printed stale banner had been asserted in
     * jsdom and against the stylesheet as text, so "it reaches the paper" was
     * inference rather than observation — and the paper is the artefact that
     * outlives everything, read months later by somebody with no other way to
     * know the plan behind it has moved on. Task 9 recorded this observation as
     * owed and it stayed owed; this is it.
     */
    await page.getByRole("link", { name: "Print this copy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Print Patient Plan" })).toBeVisible();
    await page.emulateMedia({ media: "print" });

    const stalePaper = printPaper(page);
    const printedStale = page.getByTestId("care-plan-patient-plan-paper-stale");
    await expect(printedStale).toBeVisible();
    await expect(printedStale).toContainText("Some of this may have changed.");
    await expect(printedStale).toContainText("It is still yours to keep.");
    // Never that anyone updated anything, and never an estimate of how much of
    // the sheet is still right: staleness includes the plan being withdrawn.
    await expect(stalePaper).not.toContainText(/updated/i);
    await expect(stalePaper).not.toContainText(/most of it will still be right/i);
    // The screen notice is worded for a clinician and stays off the sheet.
    await expect(stalePaper).not.toContainText(/go through it with them/i);
    // Kept whole on paper, so a reader cannot lose the half that says the copy
    // is still theirs — the rule the print stylesheet declares, measured here.
    await expect(printedStale).toHaveCSS("break-inside", "avoid");

    await page.emulateMedia({ media: "screen" });

    /*
     * --- The team-written sheet, on paper, for the first time in a browser ---
     *
     * Everything above this line printed the *joint* wording, because the copy
     * was made from Mira's version 1 (`discussed`) before her version 2
     * (`patient_unavailable`) was approved. That sequencing is why the sheet the
     * product must never get wrong — the one handed to somebody who took no part
     * in writing the plan it carries — had jsdom proof only.
     *
     * So the journey continues into what a clinician would actually do next: the
     * copy is stale, the banner they just printed tells the person to ask
     * somebody to write a new one with them, and this is that new one. It is
     * written from the version now Current, which the record says was written
     * without her, and it is printed.
     *
     * The staleness half is deliberately untouched above rather than reordered
     * away. Both facts now have browser proof, and neither was traded for the
     * other.
     */
    await desktopRail(page).getByRole("link", { name: "Patients" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Patients" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search synthetic patients" }).fill("Mira");
    // Two steps, because the directory has two. A search result is a *button*
    // that loads the person into the snapshot beside it; the link to the full
    // record belongs to that snapshot. Treating the row as a link is what this
    // journey did first, and it waited eight minutes for an element the product
    // has never had.
    await page.getByRole("button", { name: "Open Mira Example" }).click();
    await page.getByRole("link", { name: "Open the full record for Mira Example" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Patient overview" })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Patient sections" })
      .getByRole("link", { name: "Management Plan" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Management Plan" })).toBeVisible();
    await page.getByRole("link", { name: "Open the Patient Plan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Patient Plan" })).toBeVisible();
    await page.getByRole("link", { name: "Write a new copy with this person" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Draft Patient Plan" })).toBeVisible();
    await page.getByRole("button", { name: "Create the patient copy" }).click();

    /*
     * The authoring form first, because it is where the claim gets back in. A
     * clinician writing this copy reads the same headings and lead-ins as the
     * prompt for what to type, and what they type reaches her sheet.
     */
    await expectNoClaimOfJointAuthorship(
      page.getByRole("region", { name: "The eight sections" }),
      "the Patient Plan authoring form",
    );

    await fillEverySection(page, TEAM_WRITTEN_FILL);
    await page.getByRole("button", { name: "Approve patient copy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Patient Plan" })).toBeVisible();

    /*
     * The sequencing this journey exists to fix, pinned rather than assumed. If
     * a later edit moves the copy back in front of the approval, the source
     * version reverts to 1 and this reddens — instead of the suite quietly going
     * back to printing the joint wording with every assertion below still green.
     */
    const newCopy = page.getByTestId("care-plan-patient-plan-version");
    await expect(newCopy).toContainText("Version 2");
    await expect
      .poll(async () => (await newCopy.innerText()).replace(/\s+/g, " "), {
        message: "the new copy was not written from the Management Plan version approved without her",
      })
      .toMatch(/Written from Management Plan version 2/i);
    // The clinician's own marker, in the third person, on the screen where the
    // decision to hand the sheet over is made.
    await expect(newCopy).toContainText("Written without this person's involvement");
    await expect(page.getByTestId("care-plan-patient-plan-stale")).toHaveCount(0);

    const teamWrittenOnScreen = page.getByTestId("care-plan-patient-plan-sections");
    await expectNoClaimOfJointAuthorship(teamWrittenOnScreen, "the Patient Plan reading surface");

    await page.getByRole("link", { name: "Print this copy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Print Patient Plan" })).toBeVisible();
    await page.emulateMedia({ media: "print" });

    const teamWrittenPaper = printPaper(page);
    await expect(teamWrittenPaper).toBeVisible();

    /*
     * The forbidden phrasings come first, deliberately.
     *
     * Ordering is not cosmetic in a guard block: the first assertion to fail is
     * the only one anybody sees. With the positive "these headings are present"
     * checks in front, a probe that swapped the paper back to the joint wording
     * reddened on a *missing* team-written line, and the assertion that actually
     * carries the user's decision — that none of the five claims survives — was
     * never reached, so it could not be shown to fail at all. It is checked
     * first now, and the probe reddens on it.
     *
     * None of the five may survive anywhere on the sheet, and nothing on it may
     * read as a reproach: she has done nothing wrong, and her own paper is the
     * last place that could be implied. The clinician's third-person marker
     * stays off it for the same reason.
     */
    await expectNoClaimOfJointAuthorship(teamWrittenPaper, "the printed team-written Patient Plan");
    await expectNoReproach(teamWrittenPaper, "the printed team-written Patient Plan");

    // The opening sentence does not claim she helped write it, and the joint
    // opening is nowhere on the sheet.
    const paperIntro = page.getByTestId("care-plan-patient-plan-paper-intro");
    await expect(paperIntro).toHaveText(PAPER_INTRO_WRITTEN_BY_THE_TEAM);
    const paperText = await teamWrittenPaper.innerText();
    expect(paperText).not.toContain(PAPER_INTRO_TOGETHER);
    expect(/wrote (?:it )?together/i.test(paperText), "the printed sheet says the plan was written together").toBe(
      false,
    );

    // And the team-written wording is what is there instead. A sheet that merely
    // omitted the forbidden phrasings would pass everything above it.
    for (const heading of TEAM_WRITTEN_HEADINGS) {
      expect(paperText, `the printed sheet is missing the team-written heading: ${heading}`).toContain(heading);
    }
    for (const leadIn of TEAM_WRITTEN_LEAD_INS) {
      expect(paperText, `the printed sheet is missing the team-written lead-in: ${leadIn}`).toContain(leadIn);
    }

    await page.emulateMedia({ media: "screen" });
  });

  test("a Personal Safety Plan is written, made current, and printed without touching the clinical plan", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 1200 });

    // Reached by clicking from the Management Plan, which also records what the
    // clinical plan says before any of this — the second half of this case's
    // name was previously asserted nowhere at all.
    await gotoRoute(page, routes.managementPlan, "Management Plan");
    const planBefore = await readPlanMetadata(page);
    await page.getByRole("link", { name: "Personal Safety Plan" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Personal Safety Plan" })).toBeVisible();
    await page.getByRole("link", { name: /^Start a new version with this person$/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Draft Personal Safety Plan Version" })).toBeVisible();

    await page.getByRole("button", { name: "Start a new version" }).click();
    await expect(page.getByTestId("care-plan-safety-form-surface")).toBeVisible();

    // A new version starts from the words already agreed, so the person's own
    // seven sections arrive filled. What it cannot inherit is how *this*
    // version came about, which is required and blocks making it current.
    await page
      .getByLabel("How this version was written")
      .fill("Written with Rowan in the quiet room, and read back to them before it was saved.");
    await page.getByRole("button", { name: "Make current Personal Safety Plan" }).click();

    const confirm = page.getByRole("dialog", { name: /Make version \d+ the current Personal Safety Plan/ });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Make it the current plan" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Personal Safety Plan" })).toBeVisible();
    await expect(page.getByTestId("care-plan-safety-sections")).toBeVisible();

    await page.getByRole("link", { name: "Print this plan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Print Personal Safety Plan" })).toBeVisible();
    await expect(printPaper(page)).toBeVisible();

    // "without touching the clinical plan" — the clause the name has always
    // carried and nothing used to check. The two documents are independent, and
    // making a Personal Safety Plan version current needs no Management Plan
    // approval and moves no Management Plan version.
    //
    // Routed back through Home rather than the patient section navigation: a
    // print route deliberately carries none, which is correct and is what the
    // first attempt at this step tripped over.
    await desktopRail(page).getByRole("link", { name: "Home" }).click();
    await page.getByRole("link", { name: "Open the full record for Rowan Sample" }).click();
    await page
      .getByRole("navigation", { name: "Patient sections" })
      .getByRole("link", { name: "Management Plan" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Management Plan" })).toBeVisible();
    await expectPlanMetadataUnchanged(page, planBefore);

    // The other half of the same fact: the clinical plan did not move, and the
    // card's cross-reference to the person's own plan *did*. Independence is not
    // the same as invisibility — the clinician's card names whichever safety
    // plan is current, and it now names the one written above.
    await expect(planMetadata(page)).toContainText("Personal Safety Plan — Current version 2");
  });

  test("a Review Trigger is resolved without the plan changing by itself", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoRoute(page, routes.reviews, "Reviews");
    // Worklists belong to the liaison, community and senior roles; the default
    // emergency physician is correctly offered nothing to resolve here.
    await switchRole(page, ...LIAISON);
    await page.getByRole("tab", { name: /^Review Suggested/ }).click();

    // What the plan says before any of this, read from the record itself rather
    // than assumed, so the after-assertion is an equality and not a bare value.
    await desktopRail(page).getByRole("link", { name: "Home" }).click();
    const planBefore = await readPlanMetadata(page);
    await desktopRail(page).getByRole("link", { name: "Reviews" }).click();
    await page.getByRole("tab", { name: /^Review Suggested/ }).click();

    const resolve = page.getByRole("button", { name: "Record what was decided for Rowan Sample" });
    await expect(resolve).toBeVisible();
    await resolve.click();
    const sheet = page.getByRole("dialog", { name: "Record what was decided" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(/It changes no plan and approves nothing/i);

    // A resolution with nothing written in it is refused and the sheet stays
    // open. This is the positive control for the submit below: without it, a
    // "resolution" that silently did nothing would look identical to one that
    // worked.
    await sheet.getByRole("button", { name: "Record the decision" }).click();
    await expect(page.getByTestId("care-plan-review-resolution-error")).toContainText(
      /needs an account of what was decided/i,
    );
    await expect(sheet).toBeVisible();

    await page
      .getByLabel("What the team decided")
      .fill("Discussed with the team on Tuesday. The plan still fits; the quiet room was the problem, not the plan.");
    await sheet.getByRole("button", { name: "Record the decision" }).click();

    // It is genuinely resolved: the sheet closes, the outcome says so, and the
    // entry has left the queue.
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("care-plan-reviews-outcome")).toContainText(
      "Review Trigger resolved. No plan was changed.",
    );
    await expect(page.getByRole("button", { name: "Record what was decided for Rowan Sample" })).toHaveCount(0);

    // And the plan it was raised against is exactly what it was. A trigger
    // never changes a plan by itself, and this is the only assertion in the
    // suite that actually watches that happen.
    await desktopRail(page).getByRole("link", { name: "Home" }).click();
    await expectPlanMetadataUnchanged(page, planBefore);
  });

  test("a team's contact details are confirmed as checked, never as available", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoRoute(page, routes.reviews, "Reviews");
    await switchRole(page, ...LIAISON);
    await page.getByRole("tab", { name: /^Contact Verification/ }).click();

    await expect(page.getByText(/not a guarantee that the service is available/i).first()).toBeVisible();
    const record = page.getByRole("button", { name: /^Record that .* details were checked$/ }).first();
    await expect(record).toBeVisible();
    await record.click();
    const outcome = page.getByTestId("care-plan-reviews-outcome");
    await expect(outcome).toContainText(/recorded as checked/i);
    // The claim it must never make. A bare `not.toContainText(/available/i)`
    // would fail on the sentence that *denies* availability, which is the
    // opposite of the thing being guarded.
    await expect(outcome).toContainText(/not that the service is available/i);
    await expect(outcome).not.toContainText(/\b(reachable|answered|delivered|got through|verified as available)\b/i);
  });

  test("recording an ED Presentation writes an episode and can raise a Review Trigger", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRoute(page, routes.newPresentation, "Record ED Presentation");

    await page.getByLabel("Emergency department").selectOption({ index: 1 });
    await page.getByLabel("Disposition").selectOption({ label: "Discharged home" });
    await page
      .getByLabel("In one line: why they came and what happened")
      .fill("Came in distressed after a bad night; settled in the quiet room.");
    await page.getByLabel("Was the Current Plan available?").selectOption({ label: "Available" });
    await page.getByLabel("Was the Current Plan used?").selectOption({ label: "Used" });
    await page.getByLabel("Was the plan helpful?").selectOption({ label: "Did not help" });
    // Clicked through its label rather than `check()`. The shared checkbox
    // primitive hides the native input under a decorative box that owns the
    // pointer events, so a click aimed at the input itself is intercepted — a
    // repository-wide shape, not a Care Plan defect, and the label is how a
    // reader activates it anyway.
    // Scoped to the visible copy: a hidden streamed twin can share the DOM (#093).
    await page.locator('label[for="care-plan-presentation-form-suggestReview"]').filter({ visible: true }).click();
    await expect(page.getByLabel("Suggest a plan review")).toBeChecked();
    await page
      .getByLabel("Why is review suggested?")
      .fill("The quiet room was not available and the agreed approach did not fit.");

    const submit = page.getByRole("button", { name: "Record ED presentation" });
    await expectPhoneDockClearance(page, submit);
    await submit.click();

    await expect(page.getByTestId("care-plan-presentation-outcome")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "ED Presentation" })).toBeVisible();
  });

  test("a recorded outcome is corrected by amendment rather than overwritten", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRoute(page, routes.presentation, "ED Presentation");

    const trigger = page.getByRole("button", { name: "Amend recorded outcome" });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Correct this ED Presentation" });
    await expect(sheet).toBeVisible();

    // `portal={false}` keeps this sheet inside the Care Plan subtree so its
    // fields inherit the prototype's stylesheet. Task 7 deferred the question of
    // what that does to the overlay and the focus trap; this is the first look.
    const inTree = await sheet.evaluate((element) => element.closest("[class*='appRoot']") !== null);
    expect(inTree, "the in-tree sheet escaped the Care Plan subtree, so its fields lose the prototype stylesheet").toBe(
      true,
    );
    const textareaHeight = await sheet
      .locator("textarea")
      .first()
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(textareaHeight, "the in-tree sheet's multi-line field collapsed to a single-line height").toBeGreaterThan(
      48,
    );

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the phone More sheet traps focus, closes on Escape, and gives focus back", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRoute(page, routes.home, "Home");

    const trigger = phoneDock(page).getByRole("button", { name: "More" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: /Governance/ })).toBeVisible();

    // Focus is inside the sheet, and Tab keeps it there.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await sheet.evaluate((element) => element.contains(document.activeElement));
      expect(inside, "focus escaped the open sheet").toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a confirmation dialog closes on Escape and returns focus to what opened it", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoRoute(page, routes.managementPlan, "Management Plan");
    // Recording a formal review belongs to the named senior clinician.
    await switchRole(page, ...SENIOR);

    const trigger = page.getByRole("button", { name: "Record a formal review" });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Record a formal review" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the CMHT contact controls carry no patient detail", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRoute(page, routes.patient, "Patient overview");

    const email = page.getByRole("link", { name: "Email North River CMHT" });
    const href = await email.getAttribute("href");
    expect(href, "the email control has no address at all").not.toBeNull();
    expect(href!.startsWith("mailto:north-river.cmht@example.org")).toBe(true);
    for (const forbidden of ["Rowan", "Sample", "SYN-MRN-0001", "1986", "12/04", "distress"]) {
      expect(href!.toLowerCase(), `the mailto carries \`${forbidden}\``).not.toContain(forbidden.toLowerCase());
    }

    const call = page.getByRole("link", { name: "Call North River CMHT" });
    expect((await call.getAttribute("href"))?.startsWith("tel:")).toBe(true);
    await expect(page.getByText(/holds no evidence of delivery, readership, or reply/i)).toBeVisible();
  });

  test("a manual Identification Review is recorded without creating a plan", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    // Alex Fiction's only earlier referral is closed, so a fresh one is
    // legitimately permitted — Ruling 55.
    await gotoRoute(page, patientPath("SYN-PATIENT-005"), "Patient overview");

    // The screen says out loud that attendance counts decide nothing.
    await expect(page.getByText(/do not determine eligibility|decide nothing/i).first()).toBeVisible();
    // No plan before, and none after: a referral asks a group to consider
    // coordinated care, it does not start one.
    await expect(page.getByRole("region", { name: "Current Plan" })).toHaveCount(0);

    await page.getByRole("button", { name: "Refer Alex Fiction for Identification Review" }).click();
    const sheet = page.getByRole("dialog", { name: "Refer for Identification Review" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(/creates no plan/i);

    // A referral with no reason is refused: no numeric rule exists, so the
    // reason is the whole referral. The positive control for the submit below.
    await sheet.getByRole("button", { name: "Add to Identification Review" }).click();
    await expect(page.getByTestId("care-plan-referral-error")).toBeVisible();
    await expect(sheet).toBeVisible();

    await page
      .getByLabel("Reason for multidisciplinary review")
      .fill("Four presentations this quarter with no shared plan; the team would like to consider coordinated care.");
    await sheet.getByRole("button", { name: "Add to Identification Review" }).click();

    // Genuinely recorded: the sheet closes and the outcome says so.
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("care-plan-outcome")).toBeVisible();
    // And still no plan on this person's workspace.
    await expect(page.getByRole("region", { name: "Current Plan" })).toHaveCount(0);

    // It reaches the worklist, reached by clicking so the session survives.
    await desktopRail(page).getByRole("link", { name: "Reviews" }).click();
    await page.getByRole("tab", { name: /^Identification Review/ }).click();
    await expect(
      page.getByRole("button", { name: "Record the Identification Review decision for Alex Fiction" }),
    ).toBeVisible();
  });

  /**
   * Named for exactly what it does. It switches between the four worklists and
   * checks they stay operable at the narrowest supported width; it resolves
   * nothing. Resolving a Review Trigger end to end is `a Review Trigger is
   * resolved without the plan changing by itself` above, and the earlier name of
   * this case claimed that work as well — which is worse than not having it,
   * because the name is what a later reader trusts.
   */
  test("the four Reviews worklists switch and stay operable on a 320px phone", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 320, height: 844 });
    await gotoRoute(page, routes.reviews, "Reviews");

    // The four-tab queue strip at the narrowest supported width — Task 10 left
    // this as its own first look.
    for (const label of ["Awaiting Approval", "Review Suggested", "Contact Verification", "Identification Review"]) {
      const tab = page.getByRole("tab", { name: new RegExp(`^${label}`) });
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box, `the ${label} tab has no painted box at 320px`).not.toBeNull();
      expect(box!.height, `the ${label} tab is below the 48px tap convention at 320px`).toBeGreaterThanOrEqual(
        TAP_TARGET_FLOOR,
      );
      await tab.click();
      await expect(page.getByTestId("care-plan-review-queue")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test("the audit chronology reads as one record", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRoute(page, routes.history, "History");
    // Scoped to the visible copy: a hidden streamed twin can share the DOM (#093).
    await expect(visibleByTestId(page, "care-plan-history-list")).toBeVisible();
    await expect(visibleByTestId(page, "care-plan-history-filter-note")).toBeVisible();
    // An intent is never rendered as a delivery.
    await expect(visibleByTestId(page, "care-plan-history-list")).not.toContainText(/\b(delivered|read by|replied)\b/i);
  });

  test("every degraded specimen renders its stated reason rather than a blank screen", async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const scenario of SCENARIOS) {
      await gotoRoute(page, `${routes.patient}?scenario=${scenario}`, "Patient overview");
      await expectSyntheticBoundary(page);
      await expectNoHorizontalOverflow(page);
      const main = page.locator("main").last();
      const text = (await main.innerText()).trim();
      expect(text.length, `the \`${scenario}\` specimen renders an empty page`).toBeGreaterThan(80);
    }

    await gotoRoute(page, `${routes.patient}?scenario=identity-uncertain`, "Patient overview");
    await expect(page.getByTestId("care-plan-identity-uncertain")).toContainText(/Return to search/i);
    await expect(page.getByTestId("care-plan-first-minute-sections")).toHaveCount(0);
  });

  test("the whole family reflows at every required width without sideways scrolling", async ({ page }) => {
    test.setTimeout(300_000);
    const sample = [routes.home, routes.patient, routes.managementPlan, routes.safetyPlan, routes.reviews] as const;
    for (const width of REQUIRED_WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      for (const route of sample) {
        await gotoRoute(page, route);
        await expectNoHorizontalOverflow(page);
        if (width < 768) {
          await expect(phoneDock(page)).toBeVisible();
          await expect(desktopRail(page)).toBeHidden();
          for (const item of await phoneDock(page).getByRole("link").all()) {
            const box = await item.boundingBox();
            expect(box, "a phone dock destination has no painted box").not.toBeNull();
            expect(box!.height, "a phone dock destination is below the 48px tap convention").toBeGreaterThanOrEqual(
              TAP_TARGET_FLOOR,
            );
          }
        } else {
          await expect(desktopRail(page)).toBeVisible();
          await expect(phoneDock(page)).toBeHidden();
        }
      }
    }
  });

  /**
   * The rest of the brief's per-width list, which the first round did not
   * implement: heading and action wrapping, Current Plan readability, CMHT and
   * Safety access, and the 48 px floor on primary targets — at each of the five
   * widths, not only at one.
   *
   * The reflow case above covers overflow and rail/dock ownership and nothing
   * else, which is why this is a second case rather than more assertions inside
   * that loop: they answer different questions and should fail separately.
   */
  test("the plan stays readable and every primary action stays reachable at each width", async ({ page }) => {
    test.setTimeout(300_000);
    for (const width of REQUIRED_WIDTHS) {
      const at = `at ${width}px`;
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await gotoRoute(page, routes.managementPlan, "Management Plan");

      // Heading and action wrapping: the page heading keeps its own line, and
      // no section action is painted on top of the heading it belongs to.
      const heading = await page.getByRole("heading", { level: 1, name: "Management Plan" }).boundingBox();
      expect(heading, `the page heading has no painted box ${at}`).not.toBeNull();
      expect(heading!.width, `the page heading is crushed ${at}`).toBeGreaterThan(60);
      const planActions = page.getByRole("region", { name: "Plan actions" });
      await expect(planActions, `Plan actions is not reachable ${at}`).toBeVisible();
      const actionsHeading = await planActions.getByRole("heading", { name: "Plan actions" }).boundingBox();
      const firstAction = await planActions.getByRole("button").first().boundingBox();
      expect(actionsHeading, `the Plan actions heading has no painted box ${at}`).not.toBeNull();
      expect(firstAction, `Plan actions offers no control ${at}`).not.toBeNull();
      expect(
        firstAction!.y,
        `a plan action is painted over its own heading ${at}, so one of them is unreadable`,
      ).toBeGreaterThanOrEqual(actionsHeading!.y + actionsHeading!.height - 1);

      // Current Plan readability: the card, its five sections, and the pinned
      // boundary above them, none of it clipped.
      await expect(page.getByRole("region", { name: "Current Plan" }), `no Current Plan ${at}`).toBeVisible();
      await expectPinnedBoundaryAbovePlanContent(page);
      const fifth = page.getByRole("heading", { name: "5. What would make this presentation different" });
      await expect(fifth, `the fifth section is not visible ${at}`).toBeVisible();
      const sections = page.getByTestId("care-plan-first-minute-sections");
      const clipped = await sections.evaluate((element) => element.scrollHeight - element.clientHeight);
      expect(clipped, `the first-minute sections are clipped ${at}`).toBeLessThanOrEqual(1);
      // Measured against the space the plan is actually given rather than
      // against the viewport. The first version of this assertion guessed a
      // pixel floor from the shell's padding, was wrong by two levels of nesting
      // — the card is 238px inside a 320px viewport, not the 272 I predicted —
      // and would have been "fixed" by lowering the number until it passed,
      // which measures nothing. A share of the content column is the contract:
      // it is scale-free, it holds at every width, and a plan squeezed into a
      // sliver beside something else still fails it.
      const readability = await sections.evaluate((element) => {
        const main = element.closest("main");
        return {
          cardWidth: element.getBoundingClientRect().width,
          columnWidth:
            main === null
              ? 0
              : main.clientWidth -
                Number.parseFloat(getComputedStyle(main).paddingLeft) -
                Number.parseFloat(getComputedStyle(main).paddingRight),
        };
      });
      expect(readability.columnWidth, `the plan has no content column to measure ${at}`).toBeGreaterThan(0);
      expect(
        readability.cardWidth / readability.columnWidth,
        `the Current Plan card is squeezed into ${Math.round((readability.cardWidth / readability.columnWidth) * 100)}% of the content column ${at}, which is too narrow to read`,
      ).toBeGreaterThanOrEqual(0.6);

      // CMHT and Safety Plan access, and the 48 px floor on every primary
      // target, measured rather than assumed.
      for (const name of [
        "Email North River CMHT",
        "Call North River CMHT",
        "Call the after-hours line",
        "Personal Safety Plan",
      ]) {
        const control = page.getByRole("link", { name }).first();
        await expect(control, `\`${name}\` is not reachable ${at}`).toBeVisible();
      }
      for (const control of await page.getByRole("region", { name: "Plan actions" }).getByRole("button").all()) {
        const box = await control.boundingBox();
        const label = (await control.innerText()).replace(/\s+/g, " ").trim().slice(0, 40);
        expect(box, `\`${label}\` has no painted box ${at}`).not.toBeNull();
        expect(box!.height, `\`${label}\` is below the 48px tap convention ${at}`).toBeGreaterThanOrEqual(
          TAP_TARGET_FLOOR,
        );
      }

      // Phone dock clearance where applicable: the last plan action must not sit
      // underneath the dock at maximum scroll.
      await expectPhoneDockClearance(
        page,
        page.getByRole("region", { name: "Plan actions" }).getByRole("button").last(),
      );
      await expectNoHorizontalOverflow(page);
    }
  });

  test("content reflows at 200% zoom equivalent without sideways scrolling", async ({ page }) => {
    test.setTimeout(180_000);
    // 1280x1024 at 200% is 640x512 CSS pixels, the WCAG 1.4.10 measurement.
    await page.setViewportSize({ width: 640, height: 512 });
    for (const route of [routes.managementPlan, routes.safetyPlan, routes.patientPlan, routes.governance]) {
      await gotoRoute(page, route);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("reduced motion removes decoration without hiding a state change", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoRoute(page, routes.home, "Home");
    await phoneDock(page).getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    const duration = await sheet.evaluate((element) => getComputedStyle(element).animationDuration);
    expect(Number.parseFloat(duration) || 0, "the sheet still animates under reduced motion").toBeLessThanOrEqual(0.05);
    await page.keyboard.press("Escape");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await gotoRoute(page, routes.home, "Home");
    await phoneDock(page).getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  });

  test("keyboard traversal reaches the plan without a mouse, with a visible focus ring", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRoute(page, routes.patient, "Patient overview");

    // Walk the tab order and record what is reachable, and whether whatever
    // holds focus is actually drawn with a ring. A focus ring that resolves to
    // nothing is invisible to a keyboard reader and to `css: false` alike.
    const reached: string[] = [];
    let ringless: string | null = null;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active === null || active === document.body) return null;
        const style = getComputedStyle(active);
        return {
          name: (active.getAttribute("aria-label") ?? active.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60),
          outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
          outlineStyle: style.outlineStyle,
          outlineColour: style.outlineColor,
          boxShadow: style.boxShadow,
        };
      });
      if (focused === null) continue;
      reached.push(focused.name);
      const outlineInk = parseColour(focused.outlineColour);
      const hasRing =
        (focused.outlineWidth > 0 && focused.outlineStyle !== "none" && (outlineInk?.a ?? 0) >= 0.5) ||
        (focused.boxShadow !== "none" && focused.boxShadow.length > 0);
      if (!hasRing && ringless === null) ringless = focused.name || "(an unnamed control)";
    }
    expect(reached.length, "tabbing reached no control at all").toBeGreaterThan(5);
    expect(ringless, `\`${ringless}\` takes focus with no visible ring`).toBeNull();

    // The plan's own jump link is reachable and moves the reader to the section.
    await page.getByRole("link", { name: /What would make this presentation different/ }).click();
    await expect(page.getByRole("heading", { name: "5. What would make this presentation different" })).toBeVisible();
  });

  test("forced colours keeps Current, Draft, Review and Withdrawn distinguishable", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ forcedColors: "active" });

    await gotoRoute(page, `${patientPath("SYN-PATIENT-002")}/management-plan`, "Management Plan");
    await expect(page.getByRole("region", { name: "Current Plan" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Version in progress" })).toBeVisible();
    // The state is carried by a word, not only by a tint.
    await expect(page.getByText("Awaiting Approval").first()).toBeVisible();

    // Evelyn Demo's plan is withdrawn in the fixtures themselves, so this is the
    // state as a reader meets it rather than a specimen lens over somebody who
    // still has a Current Plan. A withdrawn plan must never look like a person
    // who never had one.
    await gotoRoute(page, patientPath("SYN-PATIENT-004"), "Patient overview");
    await expect(page.getByTestId("care-plan-withdrawn-notice")).toBeVisible();
    await expect(page.getByTestId("care-plan-withdrawn-notice")).toContainText(/withdrawn on/i);

    await page.emulateMedia({ forcedColors: "none" });
  });

  test("dark mode paints the whole prototype, not a half-themed page", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoRoute(page, routes.managementPlan, "Management Plan");
    await expect(page.locator("html")).toHaveClass(/dark/);

    const contrast = await page.evaluate(() => {
      const sample = document.querySelector("main [class*='pageTitle']") ?? document.body;
      const style = getComputedStyle(sample);
      const body = getComputedStyle(document.body);
      return { text: style.color, background: body.backgroundColor };
    });
    const text = parseColour(contrast.text);
    const background = parseColour(contrast.background);
    expect(text, `unreadable dark-mode text colour: ${contrast.text}`).not.toBeNull();
    // Fails closed. An unreadable page background used to turn the whole
    // luminance comparison off, so a dark mode that painted nothing would have
    // passed this silently.
    expect(background, `unreadable dark-mode page background: ${contrast.background}`).not.toBeNull();
    expect(
      background!.a,
      "the dark-mode page background is transparent, so nothing was painted behind the heading",
    ).toBeGreaterThan(0);
    const luminance = (c: Rgba) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(
      Math.abs(luminance(text!) - luminance(background!)),
      "dark-mode heading text is the same brightness as the page behind it",
    ).toBeGreaterThan(60);
    await page.emulateMedia({ colorScheme: "light" });
  });

  // --- Optional evidence capture ---------------------------------------------

  test("captures the Care Plan handoff atlas", async ({ page }) => {
    test.skip(!captureEvidence, "Set CARE_PLAN_CAPTURE_EVIDENCE=1 to refresh the Care Plan evidence atlas.");
    test.setTimeout(600_000);
    rmSync(captureDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    mkdirSync(captureDirectory, { recursive: true });
    const manifest: object[] = [];

    const surfaces: readonly (readonly [string, string, string])[] = [
      ["home", routes.home, "Home"],
      ["patient", routes.patient, "Patient overview"],
      ["management-plan", routes.managementPlan, "Management Plan"],
      ["management-plan-review", routes.managementPlanReview, "Review submitted version"],
      ["presentations", routes.presentations, "ED Presentations"],
      ["safety-plan-print", routes.safetyPlanPrint, "Print Personal Safety Plan"],
      ["reviews", routes.reviews, "Reviews"],
      ["system-states", routes.systemStates, "System states"],
    ];

    async function capture(name: string, route: string, note: string) {
      const target = page.locator("main").last();
      await expect(target).toBeVisible();
      await target.screenshot({ path: resolve(captureDirectory, `${name}.png`), animations: "disabled" });
      manifest.push({ file: `${name}.png`, route, viewport: page.viewportSize(), note });
    }

    for (const [device, width, height] of [
      ["320", 320, 844],
      ["390", 390, 844],
      ["1440", 1440, 1200],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const [name, route, heading] of surfaces) {
        await gotoRoute(page, route, heading);
        await capture(`${device}-${name}`, route, "normal");
      }
    }

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoRoute(page, routes.managementPlan, "Management Plan");
    await capture("dark-management-plan", routes.managementPlan, "dark");
    await page.emulateMedia({ colorScheme: "light", forcedColors: "active" });
    await gotoRoute(page, routes.managementPlan, "Management Plan");
    await capture("forced-colours-management-plan", routes.managementPlan, "forced-colours");
    await page.emulateMedia({ forcedColors: "none" });

    /*
      The three printed papers, as text, exactly as they reach a reader.
      Screenshots are visual evidence and prove nothing about wording; a
      person's own copy is the surface where wording does the harm, and the
      worst defect this project has produced was a heading on a patient's sheet
      with `Not recorded` under it. Somebody has to be able to read the sheet.
    */
    async function capturePaper(name: string, route: string, heading: string) {
      await gotoRoute(page, route, heading);
      await page.emulateMedia({ media: "print" });
      const paper = printPaper(page);
      await expect(paper).toBeVisible();
      writeFileSync(resolve(captureDirectory, `paper-${name}.txt`), `${(await paper.innerText()).trim()}\n`);
      manifest.push({ file: `paper-${name}.txt`, route, note: "printed text" });
      await page.emulateMedia({ media: "screen" });
    }

    await capturePaper("management-plan", routes.managementPlanPrint, "Print Management Plan");
    await capturePaper("safety-plan", routes.safetyPlanPrint, "Print Personal Safety Plan");

    // The patient copy has no fixture: it only exists once somebody makes one.
    await gotoRoute(page, routes.patientPlan, "Patient Plan");
    await page.getByRole("button", { name: "Create the patient copy" }).click();
    await page.getByRole("link", { name: /Continue draft version|Write a new copy with this person/ }).click();
    await fillEverySection(page);
    await page.getByRole("button", { name: "Approve patient copy" }).click();
    await page.getByRole("link", { name: "Print this copy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Print Patient Plan" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const patientPaper = printPaper(page);
    await expect(patientPaper).toBeVisible();
    writeFileSync(resolve(captureDirectory, "paper-patient-plan.txt"), `${(await patientPaper.innerText()).trim()}\n`);
    manifest.push({ file: "paper-patient-plan.txt", route: routes.patientPlanPrint, note: "printed text" });
    await page.emulateMedia({ media: "screen" });

    const images = readdirSync(captureDirectory).filter((name) => name.endsWith(".png"));
    expect(images.length).toBe(surfaces.length * 3 + 2);
    expect(readdirSync(captureDirectory).filter((name) => name.startsWith("paper-"))).toHaveLength(3);
    writeFileSync(
      resolve(captureDirectory, "manifest.json"),
      `${JSON.stringify(
        {
          sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          generatedAt: new Date().toISOString(),
          captures: manifest,
        },
        null,
        2,
      )}\n`,
    );
  });
});

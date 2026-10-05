/** @vitest-environment jsdom */

/**
 * THE CME VISUAL CONTRACT.
 *
 * The owner asked that this mode "enforce perfected visual implementation".
 * No test can assert *perfected* — that is his eye, and the screenshot
 * channel in `tests/ui-visual-artifacts.spec.ts` is how he judges it. What a
 * test CAN do is hold the handful of things `docs/cme/design/cme-design-decisions.md`
 * states in absolute terms, so a future change cannot erode them without a
 * test failing here first — see that file's §4, §12 and §13.
 *
 * Every check below renders one of the *already-built* CME screens
 * (`src/components/cme/*`) exactly as shipped. This file adds no test ids and
 * changes no component — it holds the contract against the real render
 * output, mode-wide, in one place, rather than leaving each invariant to be
 * separately (and incompletely) re-derived per screen.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CmeCustomisePage } from "@/components/cme/cme-customise-page";
import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { CmeEntryForm } from "@/components/cme/cme-entry-form";
import { CmeEntryPage } from "@/components/cme/cme-entry-page";
import { CmeLogPage } from "@/components/cme/cme-log-page";
import { CmeProgrammePage } from "@/components/cme/cme-programme-page";
import { CmeRoutinesPage } from "@/components/cme/cme-routines-page";
import { CmeSetupPage } from "@/components/cme/cme-setup-page";
import { DEMO_CME_ENTRIES, DEMO_CME_INSTANT, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import { cmeDashboardModuleLabels } from "@/lib/cme/module-order";
import { cmeModuleOrderStorageKey } from "@/lib/cme/module-order-keys";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeRequirementSet } from "@/lib/cme/types";

// The quick-log button refreshes the page after a save.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cme",
}));

/**
 * Design decision §12, "What this deliberately does not do": "No red." — and,
 * by the same rule, no amber and no green. This mode reads shortfall through
 * position, weight and wording, never through a status colour, so a literal
 * Tailwind colour-scale utility for one of the clinical status hues is always
 * a defect here, on every screen, in every state. CSS-custom-property colour
 * (`bg-[color:var(--clinical-accent)]`, `text-[color:var(--tone-indigo)]`,
 * …) is not a Tailwind colour-scale utility and is deliberately not matched:
 * the mode's one sanctioned accent lives there, not here.
 */
const CLINICAL_STATUS_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:red|amber|green|orange|rose|emerald|yellow)-[0-9]/;

/**
 * Design decision §13: "48 px is the floor for anything tappable, matching
 * the repo's `min-h-12` production rule." Production expresses that floor
 * three ways in this mode, all resolving to the same `--spacing-tap` (3rem =
 * 48px) token: `min-h-tap` (a `Button`/`Link`-shaped control), `size-tap`
 * (an `IconButton` or the setup screen's capture switch), and the
 * `h-tap`/`w-tap` pair `toolbarButton` composes onto an `IconButton`. Never
 * `min-h-11` — that is the known `ui-smoke` flake the brief calls out by
 * name, and it is 44px, one token short of the floor this mode holds to.
 */
// min-h-13 is the kit's two-line grouped-list row (52 px), above the 48 px floor.
const TAP_TARGET_CLASS = /\b(?:min-h-(?:12|13|tap)|size-(?:12|tap))\b/;

/**
 * The 5 Oct mock-up's compact controls (the Year page's 40 px button and 32 px
 * chips) keep a smaller face and widen the tap area with an absolutely placed
 * 48 px pseudo-element, the mock-up's own `::after` pattern.
 */
const PSEUDO_TAP_AREA = /\bafter:absolute\b/;
const PSEUDO_TAP_HEIGHT = /\bafter:h-12\b/;

function hasTapTarget(className: string): boolean {
  if (TAP_TARGET_CLASS.test(className)) return true;
  if (PSEUDO_TAP_AREA.test(className) && PSEUDO_TAP_HEIGHT.test(className)) return true;
  return /\bh-tap\b/.test(className) && /\bw-tap\b/.test(className);
}

function clinicalStatusColourOffenders(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[class]")].filter((node) =>
    CLINICAL_STATUS_CLASS.test(node.className),
  );
}

function shortTapTargets(container: HTMLElement): HTMLElement[] {
  const interactive = [...container.querySelectorAll<HTMLElement>("button, a[href], [role='button']")];
  return interactive.filter((node) => !hasTapTarget(node.className));
}

const dueRoutine: CmeRoutine = {
  id: "routine-due",
  title: "Peer review group",
  cadence: "monthly",
  usualHours: 0.5,
  usualAllocations: [{ category: "reviewing", hours: 0.5 }],
  nextDue: "2026-09-19",
  archivedAt: null,
};

const notYetDueRoutine: CmeRoutine = {
  id: "routine-not-due",
  title: "Journal club",
  cadence: "quarterly",
  usualHours: 1,
  usualAllocations: [],
  nextDue: "2026-12-01",
  archivedAt: null,
};

/** A fully-populated entry: cost, evidence, a routine link — every branch `CmeEntryPage` draws. */
const FULL_ENTRY_ID = "cme-2026-005";
/** Not-yet-transcribed, no cost, no evidence, no routine — the opposite end of the same screen. */
const BARE_ENTRY_ID = "cme-2026-047";

/**
 * Every already-built CME screen, in a representative state. This is the
 * mode-wide surface the colour and tap-target invariants below are checked
 * against — "on any CME screen, in any state" (task brief) means this table
 * grows before those invariants are ever narrowed.
 */
function cmeScreens() {
  return [
    {
      name: "dashboard — tracking season, a routine due",
      render: () =>
        render(
          <CmeDashboard
            set={DEMO_CME_YEAR}
            entries={DEMO_CME_ENTRIES}
            now={DEMO_CME_INSTANT}
            routines={[dueRoutine, notYetDueRoutine]}
            onLogRoutine={vi.fn()}
            onOpenCustomise={vi.fn()}
          />,
        ),
    },
    {
      name: "dashboard — early January, no pace",
      render: () =>
        render(<CmeDashboard set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={new Date("2026-01-06T02:00:00Z")} />),
    },
    {
      name: "dashboard — closing fortnight",
      render: () =>
        render(<CmeDashboard set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={new Date("2026-12-28T02:00:00Z")} />),
    },
    {
      name: "log — populated",
      render: () => render(<CmeLogPage entries={DEMO_CME_ENTRIES} set={DEMO_CME_YEAR} />),
    },
    {
      name: "log — nothing logged yet",
      render: () => render(<CmeLogPage entries={[]} set={DEMO_CME_YEAR} />),
    },
    {
      name: "one entry — fully populated",
      render: () => render(<CmeEntryPage entryId={FULL_ENTRY_ID} entries={DEMO_CME_ENTRIES} set={DEMO_CME_YEAR} />),
    },
    {
      name: "one entry — bare, not yet transcribed",
      render: () => render(<CmeEntryPage entryId={BARE_ENTRY_ID} entries={DEMO_CME_ENTRIES} set={DEMO_CME_YEAR} />),
    },
    {
      name: "one entry — not found",
      render: () => render(<CmeEntryPage entryId="does-not-exist" entries={DEMO_CME_ENTRIES} set={DEMO_CME_YEAR} />),
    },
    {
      name: "new entry form",
      render: () => render(<CmeEntryForm onSubmit={vi.fn().mockResolvedValue(undefined)} />),
    },
    {
      name: "routines — one due",
      render: () =>
        render(
          <CmeRoutinesPage
            routines={[dueRoutine, notYetDueRoutine]}
            now={DEMO_CME_INSTANT}
            onLogDueRoutine={vi.fn()}
            onLogRoutine={vi.fn()}
            onNewRoutine={vi.fn()}
          />,
        ),
    },
    {
      name: "routines — none added yet",
      render: () =>
        render(
          <CmeRoutinesPage
            routines={[]}
            now={DEMO_CME_INSTANT}
            onLogDueRoutine={vi.fn()}
            onLogRoutine={vi.fn()}
            onNewRoutine={vi.fn()}
          />,
        ),
    },
    {
      name: "programme",
      render: () =>
        render(<CmeProgrammePage set={DEMO_CME_YEAR} onReconfirm={vi.fn()} onAddCollegeRequirement={vi.fn()} />),
    },
    {
      name: "setup — targets not yet confirmed",
      render: () => render(<CmeSetupPage set={null} />),
    },
    {
      name: "setup — targets confirmed",
      render: () => render(<CmeSetupPage set={DEMO_CME_YEAR} />),
    },
    {
      name: "customise",
      render: () => render(<CmeCustomisePage />),
    },
  ] as const;
}

describe("CME visual contract", () => {
  beforeEach(() => {
    // The module-order store persists to localStorage, which jsdom keeps
    // alive across tests in the same file. Reset it so every render starts
    // from the product default order, regardless of test order.
    window.localStorage.removeItem(cmeModuleOrderStorageKey);
  });

  describe("paints no clinical status colour anywhere in the mode", () => {
    for (const screenCase of cmeScreens()) {
      it(`${screenCase.name}`, () => {
        const { container } = screenCase.render();
        expect(clinicalStatusColourOffenders(container).map((node) => node.className)).toEqual([]);
      });
    }
  });

  describe("gives every interactive control a 48px tap target, mode-wide", () => {
    for (const screenCase of cmeScreens()) {
      it(`${screenCase.name}`, () => {
        const { container } = screenCase.render();
        const interactiveCount = container.querySelectorAll("button, a[href], [role='button']").length;
        expect(interactiveCount).toBeGreaterThan(0);
        const short = shortTapTargets(container);
        expect(short.map((node) => node.textContent?.trim() || node.getAttribute("aria-label"))).toEqual([]);
      });
    }
  });

  describe("the pace projection", () => {
    it("is stated as a sentence tied to the year's end date, once the rate means something", () => {
      render(<CmeDashboard set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={DEMO_CME_INSTANT} />);
      expect(screen.getByTestId("cme-pace-sentence")).toHaveTextContent(/^17\.5 h to go, about 1\.2 h a week\./);
      // The year's end sits in the same card's label, so the rate is always read against it.
      expect(screen.getByTestId("cme-year-label")).toHaveTextContent("2026 · about 15 weeks left");
    });

    it("gives no weekly rate and no mark before 28 days have elapsed", () => {
      const earlyYearSet: CmeRequirementSet = {
        ...DEMO_CME_YEAR,
        requirements: DEMO_CME_YEAR.requirements.map((requirement) =>
          requirement.id === "plan" ? { ...requirement, completedOn: null } : requirement,
        ),
      };
      render(<CmeDashboard set={earlyYearSet} entries={DEMO_CME_ENTRIES} now={new Date("2026-01-06T02:00:00Z")} />);
      expect(screen.queryByTestId("cme-pace-sentence")?.textContent ?? "").not.toMatch(/a week/);
      expect(screen.queryByTestId("progress-mark")).toBeNull();
      expect(screen.getByTestId("cme-next-action")).toHaveTextContent(/development plan/i);
    });

    it("says nothing at all for a year the instant is not inside", () => {
      // DEMO_CME_YEAR is 2026; DEMO_CME_INSTANT is well past day 28 of it, but
      // this instant falls in 2027 — outside the year the set was confirmed
      // for, where a rate would be confidently wrong rather than merely early.
      render(<CmeDashboard set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={new Date("2027-02-14T02:00:00Z")} />);
      expect(screen.queryByTestId("cme-pace-sentence")).toBeNull();
      expect(screen.queryByTestId("progress-mark")).toBeNull();
    });
  });

  describe("every target displayed carries its provenance", () => {
    it("on the dashboard", () => {
      render(<CmeDashboard set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={DEMO_CME_INSTANT} />);
      const provenance = screen.getByTestId("cme-provenance");
      expect(provenance).toHaveTextContent(/you confirmed .* on 8 Jan/i);
      expect(provenance).toHaveTextContent(DEMO_CME_YEAR.confirmedSource);
    });

    it("on the programme screen, beside every national and college target", () => {
      render(<CmeProgrammePage set={DEMO_CME_YEAR} />);
      const provenance = screen.getByTestId("cme-provenance");
      expect(provenance).toHaveTextContent(/confirmed by you on/i);
      expect(provenance).toHaveTextContent(DEMO_CME_YEAR.confirmedSource);
      // The provenance block is not decoration off to one side: the same
      // screen that states it is the one carrying the numbers it backs.
      expect(screen.getByTestId("cme-national-baseline")).toHaveTextContent(String(DEMO_CME_YEAR.totalHours));
    });
  });

  describe("reordering the dashboard's modules is never drag-only", () => {
    it("offers a move-up and a move-down button beside every module", () => {
      render(<CmeCustomisePage />);
      const list = screen.getByTestId("cme-module-order");
      expect(within(list).getAllByRole("button", { name: /move .* up/i }).length).toBeGreaterThan(0);
      expect(within(list).getAllByRole("button", { name: /move .* down/i }).length).toBeGreaterThan(0);
    });

    it("actually moves a module from the keyboard alone, with no pointer involved", async () => {
      const user = userEvent.setup();
      render(<CmeCustomisePage />);
      const labelsOf = () =>
        within(screen.getByTestId("cme-module-order"))
          .getAllByRole("listitem")
          .map((item) => item.textContent ?? "");
      const before = labelsOf();
      expect(before[2]).toContain(cmeDashboardModuleLabels["audited-today"]);

      const moveDown = screen.getByRole("button", { name: `Move ${cmeDashboardModuleLabels["audited-today"]} down` });
      moveDown.focus();
      expect(moveDown).toHaveFocus();
      await user.keyboard("{Enter}");

      const after = labelsOf();
      expect(after[2]).toContain(cmeDashboardModuleLabels["year-dates"]);
      expect(after).not.toEqual(before);
    });

    it("the up control at the top of the list, and the down control at the bottom, are genuinely disabled", () => {
      render(<CmeCustomisePage />);
      const list = screen.getByTestId("cme-module-order");
      const items = within(list).getAllByRole("listitem");
      const firstUp = within(items[0]!).getByRole("button", { name: /move .* up/i });
      const lastDown = within(items[items.length - 1]!).getByRole("button", { name: /move .* down/i });
      expect(firstUp).toBeDisabled();
      expect(lastDown).toBeDisabled();
    });
  });
});

// No explicit afterEach/cleanup here: `tests/setup/jsdom.setup.ts` (this
// project's global jsdom setup) already unmounts every rendered tree after
// each test, which is what keeps testids like `cme-provenance` and
// `cme-next-action` — mounted by several screens above — from matching a
// leaked tree from an earlier case.

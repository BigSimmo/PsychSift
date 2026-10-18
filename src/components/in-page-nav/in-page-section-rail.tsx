"use client";

import { useMemo, type ReactNode } from "react";

import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { planModeNavBands, type ModeNavDensityProfile } from "@/components/mode-nav/mode-nav-bands";
import { ModeNavSlotInk, modeNavSlotBase } from "@/components/mode-nav/nav-slot-ink";
import { cn } from "@/components/ui-primitives";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--focus)]";

/**
 * Therapy-style priority navigation for discrete in-page panels.
 *
 * Medication is the sole adopter. The first two destinations stay visible at
 * the three-slot band and the tail folds into More; the complete set returns at
 * the four-slot band. Below the minimum bar width, the header's existing title
 * disclosure remains the safe non-overflow fallback.
 *
 * Defaults to `extended-counted`, not `extended` — the two happen to share a
 * label family, but `extended` is Therapy's mode-nav profile and free to
 * change for Therapy's own reasons. Coupling this rail to it by relying on a
 * shared name is the mistake `extended-counted` exists to rule out.
 *
 * This is deliberately not a tablist. The panel is a plain region and all
 * sections are also reachable from the sheet, so ordinary buttons keep every
 * visible destination in the normal Tab order.
 */
export function InPageSectionRail({
  sections,
  activeId,
  onSelect,
  onOpenSectionSheet,
  sectionSheetOpen,
  label,
  testIdPrefix,
  density,
  countedLabels = false,
  modeIdentity,
  flush = false,
  collapsedControl,
}: {
  sections: readonly PageSection[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenSectionSheet: (opener: HTMLButtonElement) => void;
  sectionSheetOpen: boolean;
  /** Accessible name for the rail, e.g. "Medication sections". */
  label: string;
  testIdPrefix: string;
  /**
   * Which calibrated label family this rail's labels belong to. It only moves
   * the container width at which each band becomes active — never the order,
   * and never which item folds first.
   *
   * Required, with no default, and that is the point. It used to default to
   * `extended`, so medication's rail inherited Therapy's profile without ever
   * naming it — invisible to `registryModeNavDensityProfiles`, which lists only
   * the modes that render the top bar. Retuning `extended` for Therapy in
   * PR #2686 therefore silently unfolded medication's counted labels early, and
   * `ui-smoke`'s prescribing journey was the only thing that caught it.
   *
   * A default cannot be safe here: the value is a calibration against one
   * label family's measured widths, so inheriting someone else's is always a
   * guess. Making it required costs each call site one line and makes the
   * consumer set answerable by `git grep "density:"`.
   */
  density: ModeNavDensityProfile;
  /**
   * `true` when every slot carries a count badge beside its label, which needs
   * roughly a third more width per slot.
   */
  countedLabels?: boolean;
  /**
   * An app-mode id, when this bar should carry that mode's identity hue rather
   * than the product accent. Stamped as `data-mode-identity`, which remaps
   * `--clinical-accent` inside this `<nav>` only — see the `--mode-identity`
   * block in `globals.css`. A mode that declares no identity resolves to the
   * product accent, so passing one is never a change on its own.
   */
  modeIdentity?: string;
  /**
   * `true` when the bar is the header's ONLY content, so it sits directly under
   * the chrome above rather than under a title row.
   *
   * It then drops its top margin: the 8px gap exists to separate the bar from
   * that row, and with no row it left the bar's own rule floating in space
   * under the universal header. Measured on On Call at 390px: 73px of header
   * for a 48px bar, against 57px with this on.
   */
  flush?: boolean;
  /** Optional disclosure for headers whose title trigger is hidden; shares the rail's exact density breakpoint. */
  collapsedControl?: ReactNode;
}) {
  const plan = useMemo(() => {
    const sharedPlan = planModeNavBands(sections.length);
    if (sections.length !== 4 || !countedLabels) return sharedPlan;
    // Counted labels (icon + label + count badge) clip at the generic four-slot
    // band, so those rails hold two priority destinations plus More until the
    // 42rem band fits all four completely. A rail whose labels carry no badge
    // does not pay that, which is why this is opt-in rather than keyed on the
    // section count: it cost Therapy's rail two of its four destinations, both
    // of them behind More on every phone.
    return {
      firstVisibleBand: new Map([
        [0, 3],
        [1, 3],
        [2, 5],
        [3, 5],
      ] as const),
      moreUntil: 4,
    } satisfies ReturnType<typeof planModeNavBands>;
  }, [sections.length, countedLabels]);
  const activeIndex = sections.findIndex((section) => section.id === activeId);
  const activeBand = activeIndex >= 0 ? plan.firstVisibleBand.get(activeIndex) : undefined;
  const activeFrom = plan.moreUntil !== null && activeIndex >= 0 ? (activeBand ?? "none") : undefined;
  const activeSection = activeIndex >= 0 ? sections[activeIndex] : undefined;
  const moreAccessibleLabel =
    activeSection && activeFrom !== undefined && activeFrom !== 3
      ? `More, current section: ${activeSection.label}`
      : "More";

  if (sections.length === 0) return null;

  return (
    <nav
      aria-label={label}
      data-testid={`${testIdPrefix}-section-rail`}
      data-mode-identity={modeIdentity}
      className={cn(
        "border-t border-[color:var(--border)] sm:rounded-xl sm:border sm:border-[color:var(--border-lux)] sm:bg-[color:var(--surface-raised)] sm:px-1 sm:shadow-[var(--shadow-inset)]",
        flush ? "sm:mt-2" : "mt-2",
      )}
    >
      <div className="mode-nav" data-density-profile={density}>
        {collapsedControl ? <div className="mode-nav__control">{collapsedControl}</div> : null}
        <ul className="mode-nav__bar h-12 items-stretch px-1">
          {sections.map((section, index) => {
            const band = plan.firstVisibleBand.get(index);
            const selected = section.id === activeId;

            return (
              <li
                key={section.id}
                data-band={band ?? "none"}
                className={cn(modeNavSlotBase, band ? undefined : "hidden")}
              >
                <button
                  type="button"
                  onClick={() => onSelect(section.id)}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex h-full w-full items-center justify-center rounded-lg transition-colors motion-reduce:transition-none sm:hover:bg-[color:var(--surface-subtle)]",
                    selected && "sm:bg-[color:var(--clinical-accent-soft)] sm:shadow-[var(--shadow-inset)]",
                    focusRing,
                  )}
                >
                  <ModeNavSlotInk
                    icon={section.icon}
                    label={section.label}
                    count={typeof section.count === "number" ? String(section.count) : undefined}
                    state={selected ? "on" : "off"}
                  />
                </button>
              </li>
            );
          })}
          {plan.moreUntil !== null ? (
            <li
              data-until={plan.moreUntil}
              data-active-from={activeFrom}
              className={cn(modeNavSlotBase, "mode-nav__more flex")}
            >
              <button
                type="button"
                onClick={(event) => onOpenSectionSheet(event.currentTarget)}
                aria-haspopup="dialog"
                aria-expanded={sectionSheetOpen}
                aria-label={moreAccessibleLabel}
                data-testid={`${testIdPrefix}-section-overflow`}
                className={cn("flex h-full w-full items-center justify-center rounded-lg", focusRing)}
              >
                <ModeNavSlotInk label="More" state="off" trailing />
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </nav>
  );
}

"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useRef, useState, type MouseEvent } from "react";

import { cn } from "@/components/ui-primitives";
import { Sheet } from "@/components/ui/sheet";

import { MODE_NAV_MIN_ITEMS, planModeNavBands, type ModeNavDensityProfile } from "./mode-nav-bands";
import { ModeNavHeaderPortal } from "./mode-nav-portal";

export type ModeNavItem = {
  id: string;
  /** The only label. Never abbreviated — a slot shows its real word or folds into More. */
  label: string;
  /** A real URL. Never an onClick-only control: deep links, back and prefetch must work. */
  href: string;
  icon: LucideIcon;
  /**
   * State, not size: "3/4" for a basket that holds four, never "205" for a
   * catalogue. A total is noise on every screen; a fill is worth a glance.
   */
  count?: string;
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--focus)]";

/**
 * 48px hit area — matches `--spacing-tap`, clear of the `expectMinTouchTarget` rounding flake. The link or
 * button inside reaches back over the slot's `px-3` (`-mx-3 px-3`, at least 48px wide), so a short word
 * ("Act", "Map") is a full-width target while its ink stays exactly where it was.
 */
const slotBase =
  "mode-nav__slot relative flex min-h-12 min-w-0 items-center justify-center px-3 no-underline transition-colors";

function SlotInk({
  icon: Icon,
  label,
  count,
  state,
  trailing,
}: {
  icon?: LucideIcon;
  label: string;
  count?: string;
  state: "on" | "trail" | "off";
  trailing?: boolean;
}) {
  return (
    <span
      className={cn(
        // One weight in every state. Bolding the active label changes its width,
        // which shifts the rule and every neighbour on each navigation.
        "mode-nav__ink relative flex h-5 min-w-0 items-center gap-2 text-sm-minus font-semibold tracking-display",
        // The 2px rule takes space at the bottom of the bar, so a centred label
        // sits optically high without this compensating offset.
        "mt-0.5",
        state === "on" ? "text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className={cn(
            "mode-nav__icon size-icon-md shrink-0",
            state === "on"
              ? "text-[color:var(--clinical-accent)]"
              : state === "trail"
                ? "text-[color:var(--clinical-accent)]/55"
                : "opacity-70",
          )}
        />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
      {count ? (
        <span
          className={cn(
            "nums grid h-[1.125rem] min-w-[1.125rem] shrink-0 place-items-center rounded-full border px-1.5 text-3xs font-bold leading-none",
            state === "on"
              ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent-hover)]"
              : "border-[color:var(--border-strong)] text-[color:var(--text-muted)]",
          )}
        >
          {count}
        </span>
      ) : null}
      {trailing ? <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-55" /> : null}
      {/* The rule hangs off the ink, so it is exactly as wide as icon plus word:
          short under "Search", long under "Recommend". A rule sized to the
          padding box always looks a few pixels wrong.
          The 2px cap stays a literal: it is a hairline on a 2px-tall bar, below
          the radius ladder's 4px floor, and rounding it to `rounded-t-xs` would
          double it into a visible dome. */}
      <span
        aria-hidden="true"
        className={cn(
          "mode-nav__rule absolute inset-x-0 -bottom-[0.8125rem] rounded-t-[2px]",
          state === "on"
            ? "h-0.5 bg-[color:var(--clinical-accent)]"
            : state === "trail"
              ? "h-px bg-[color:var(--clinical-accent)]/35"
              : "h-0.5 bg-transparent",
        )}
      />
    </span>
  );
}

/**
 * Navigation for the pages of one mode, pinned inside the universal header.
 *
 * Only destinations belong here. Anything needing an already-selected record —
 * a therapy's brief intervention, its patient sheet — belongs on that record's
 * page; putting it in a bar is what let the old Therapy strip silently retarget
 * to a different therapy when the selected one had no artifact.
 *
 * Density is chosen by container width in `globals.css`; see the "Mode
 * navigation" block there for why the unit is `rem` rather than `px`.
 */
export function ModeNav({
  items,
  label,
  densityProfile,
  activeId,
  originId,
  title,
}: {
  items: ModeNavItem[];
  /**
   * The section's name, drawn as a calm title above the tabs (clinical-mode.css).
   * A label, not a heading: the page keeps its own h1.
   */
  title?: string;
  /** Names the landmark, e.g. "Therapy pages". */
  label: string;
  /** Calibrated against this destination set's complete icon-and-label widths. */
  densityProfile: ModeNavDensityProfile;
  /** Defaults to the item whose href matches the current path. Pass `null` to force no current page. */
  activeId?: string | null;
  /** The page arrived from; marked with a half-weight trail while on a record. */
  originId?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The sheet has two openers and CSS decides which one exists: below the
  // profile's first safe band only the collapsed control is displayed; above
  // it only More can open the sheet. Both stay in the DOM either way, so a ref
  // pinned to one of them hands the Sheet a `display: none` element to restore
  // focus to half the time — the browser refuses to focus it and the keyboard
  // user is dropped on <body>. Capture whichever button was actually clicked;
  // by definition it is the displayed one.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const openSheet = (event: MouseEvent<HTMLButtonElement>) => {
    openerRef.current = event.currentTarget;
    setOpen(true);
  };
  const plan = useMemo(() => planModeNavBands(items.length), [items.length]);

  if (items.length < MODE_NAV_MIN_ITEMS) return null;

  // Record routes (`/therapy-compass/<slug>`) match no item, so nothing claims
  // to be the current page and the origin trail carries lineage instead.
  // `activeId === null` is an explicit "no current" from callers that already
  // resolved ownership (RegistryModeNav); omit/`undefined` still derives from path.
  const derived = items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const active =
    activeId === undefined ? derived : activeId === null ? undefined : items.find((item) => item.id === activeId);
  const activeIndex = active ? items.indexOf(active) : -1;

  // The band at which the current page gets a slot of its own, or "none" when
  // it never does. Published as an attribute because deciding whether More
  // should carry the page's rule needs BOTH halves of the answer and neither
  // layer has both: the component knows which band would reveal the item, and
  // only CSS knows which band the container is actually in. A JS-only test can
  // ask "does this item have a band at all", which is what the old flag did —
  // and that is silent for every item that has a band the current width has
  // not reached. With Therapy's seven destinations that was five of seven
  // pages showing nothing active on a phone.
  //
  // More carries the RULE and an off-screen name, never the label. The
  // thresholds in globals.css are the measured sum of the slots' intrinsic
  // widths, so at the 22rem band Search + Compare + the bar's padding leave the
  // More slot ~107px, of which its own box, icon, gap and chevron take ~71px —
  // a ~36px label allowance, three characters after the CI font-metric
  // headroom. "Brief Intervention" wants ~213px. Shortening labels does not
  // rescue it either; the icon alone is most of the slack. Borrowing that word
  // would make the required width route-dependent inside one profile.
  //
  // `ModeNavItem.label`'s never-abbreviated contract is intact: the label is
  // not shortened, it is declined. The rule and the chevron say "the page you
  // are on is in here", the sheet marks the row `aria-current`, and the
  // collapsed control below the profile's first band names the page in full.
  const activeBand = activeIndex >= 0 ? plan.firstVisibleBand.get(activeIndex) : undefined;
  const activeFrom = plan.moreUntil !== null && activeIndex >= 0 ? (activeBand ?? "none") : undefined;

  const bar = (
    // The rule spans the viewport while the slots sit on the same centred
    // column as the header row above them, so the first tab's ink lands on the
    // header's content edge rather than the viewport's.
    <nav
      aria-label={label}
      data-testid="mode-nav"
      className="mode-nav-rail border-b border-[color:var(--border)] bg-[color:var(--surface)]"
    >
      <div className="mode-nav" data-density-profile={densityProfile}>
        {title ? (
          <p className="mode-nav__heading" data-testid="mode-nav-title">
            {title}
          </p>
        ) : null}
        {/* Collapsed: the default, and the only state that cannot overflow. */}
        <div className="mode-nav__control px-4 pb-2.5 pt-1.5">
          <button
            type="button"
            onClick={openSheet}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={cn(
              "flex min-h-12 w-full items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 text-left text-sm-minus font-semibold text-[color:var(--text-heading)] shadow-[var(--shadow-lift)]",
              "transition-colors motion-reduce:transition-none hover:border-[color:var(--border-strong)]",
              focusRing,
            )}
          >
            {active ? (
              <active.icon aria-hidden="true" className="size-icon-md text-[color:var(--clinical-accent)]" />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{active ? active.label : label}</span>
            {active ? (
              <span className="nums shrink-0 text-3xs font-bold text-[color:var(--text-muted)]">
                {activeIndex + 1}/{items.length}
              </span>
            ) : null}
            <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
          </button>
        </div>

        {/* Enhanced: the bar, once the container can hold at least three slots.
          Left padding is the gutter minus the slot padding, so the INK aligns
          to the mark above it rather than the box. Together with the slot's own
          `px-3` this is 1rem, the base header gutter — `.mode-nav-rail` adds
          only whatever the header gutter has above that. */}
        <ul className="mode-nav__bar h-12 items-stretch px-1">
          {items.map((item, index) => {
            const band = plan.firstVisibleBand.get(index);
            const isActive = item.id === active?.id;
            const isOrigin = !isActive && item.id === originId;
            return (
              <li
                key={item.id}
                data-band={band ?? "none"}
                className={cn(slotBase, focusRing, band ? undefined : "hidden")}
              >
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "-mx-3 flex h-full min-w-12 flex-1 items-center px-3 justify-center rounded-lg no-underline transition-colors motion-reduce:transition-none",
                    // Background only, and pointer-only. Never the rule: the
                    // density spec counts PAINTED `.mode-nav__rule` elements and
                    // asserts exactly one, so a hovered rule would make "which
                    // page am I on" depend on where the mouse came to rest. And
                    // on touch a hover fill sticks after a tap until the next
                    // one, reading as a second active state beside the real one
                    // — same `sm:` guard as `in-page-section-rail`.
                    !isActive && "sm:hover:bg-[color:var(--surface-subtle)]",
                    focusRing,
                  )}
                >
                  <SlotInk
                    icon={item.icon}
                    label={item.label}
                    count={item.count}
                    state={isActive ? "on" : isOrigin ? "trail" : "off"}
                  />
                </Link>
              </li>
            );
          })}
          {plan.moreUntil !== null ? (
            <li
              data-until={plan.moreUntil}
              data-active-from={activeFrom}
              className={cn(slotBase, "mode-nav__more", "flex")}
            >
              <button
                type="button"
                onClick={openSheet}
                aria-haspopup="dialog"
                aria-expanded={open}
                className={cn(
                  "-mx-3 flex h-full min-w-12 flex-1 items-center px-3 justify-center rounded-lg transition-colors motion-reduce:transition-none sm:hover:bg-[color:var(--surface-subtle)]",
                  focusRing,
                )}
              >
                <SlotInk label="More" state="off" trailing />
                {/* Composed into the accessible name rather than set as an
                    `aria-label`, because whether it applies depends on the
                    container band and only CSS can answer that. `display: none`
                    takes it out of the accessibility tree at the widths where
                    the page has its own visible `aria-current` tab, so it is
                    never announced twice. The visible word stays the name's
                    prefix (WCAG 2.5.3), so speech input still reaches it by
                    saying "More". */}
                {active ? <span className="mode-nav__more-name sr-only">, current page: {active.label}</span> : null}
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </nav>
  );

  return (
    <>
      <ModeNavHeaderPortal>{bar}</ModeNavHeaderPortal>
      {/* Portaled to the body so the sheet is never inside the collapsing grid:
          the scroll signal must not be able to hide an open dialog. */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        returnFocusRef={openerRef}
        portal
        testId="mode-nav-sheet"
      >
        <ul className="space-y-0.5">
          {items.map((item) => {
            const isActive = item.id === active?.id;
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-lg px-2.5 text-sm font-semibold no-underline",
                    focusRing,
                    isActive
                      ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent-hover)]"
                      : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn("size-icon-lg shrink-0", isActive && "text-[color:var(--clinical-accent)]")}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.count ? (
                    <span className="nums shrink-0 text-2xs font-bold text-[color:var(--text-muted)]">
                      {item.count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}

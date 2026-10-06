"use client";

import { ChevronDown, Menu, MoreHorizontal, Plus, Search, Star } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/components/ui-primitives";

/**
 * The device chrome for the phone Favourites study.
 *
 * Everything here is hand-drawn rather than imported. `InPageNavHeader`
 * (`src/components/in-page-nav/in-page-nav-header.tsx`) is the production
 * template this header follows, but it wraps itself in
 * `PhoneHeaderCollapsePortal`, which portals into the real universal header's
 * slot. Inside a mockup phone frame that slot does not exist, so importing the
 * component would teleport the header out of the frame it is meant to sit in.
 */

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

export { focusRing };

/* ═══════════════════════════  frame  ═══════════════════════════ */

/**
 * Geometry is pinned inline rather than through `max-w-phone-frame`,
 * `h-phone-frame` and `rounded-phone-frame`.
 *
 * Those three utilities read `--container-phone-frame`, `--spacing-phone-frame`
 * and `--radius-phone-frame` from the `@theme` block in `globals.css`, and
 * Tailwind only emits a theme key some scanned source actually uses. Measured
 * on this route while building it, all three were absent: `max-width` computed
 * to `none`, `--spacing-phone-frame` to the empty string, and the frame
 * rendered 2661px tall with square corners. Whether they resolve depends on
 * what else happens to be compiled into the same sheet, which is not a
 * property this file can rely on -- `mockups/README.md` records the same trap
 * against a bare `grid-cols-6`. Values are 390 x 844 and a 1.85rem radius,
 * verbatim from those tokens.
 */
const PHONE_FRAME = { width: "24.375rem", height: "52.75rem", radius: "1.85rem" } as const;

export function PhoneFrame({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <figure className="mx-auto w-full" style={{ maxWidth: PHONE_FRAME.width }}>
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-3xs font-extrabold uppercase tracking-kicker text-[color:var(--text-soft)]">{label}</span>
        {note ? <span className="text-3xs font-bold text-[color:var(--text-soft)]">{note}</span> : null}
      </figcaption>
      <div
        className="relative flex flex-col overflow-hidden border border-[color:var(--border)] bg-[color:var(--background)] shadow-[var(--e4)]"
        style={{ height: PHONE_FRAME.height, borderRadius: PHONE_FRAME.radius }}
      >
        {children}
      </div>
    </figure>
  );
}

export function StatusBar() {
  return (
    <div className="flex shrink-0 items-center justify-between bg-[color:var(--surface-chrome)] px-6 pb-1 pt-2.5">
      <span className="text-2xs font-bold text-[color:var(--text-heading)]">9:41</span>
      <span className="flex items-center gap-1" aria-hidden>
        <span className="h-2.5 w-4 rounded-xs bg-[color:var(--text-soft)]" />
        <span className="h-2.5 w-2.5 rounded-xs bg-[color:var(--text-soft)]" />
        <span className="h-2.5 w-6 rounded-xs bg-[color:var(--text-heading)]" />
      </span>
    </div>
  );
}

/* ═══════════════════════════  chrome  ═══════════════════════════ */

/** The universal app header every phone route already carries: menu, the mode
 *  pill, new chat. Drawn so the page header below it can be measured honestly
 *  against the space it actually has. */
export function UniversalHeader() {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--surface-chrome)] px-3">
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => undefined}
        className={cn(
          "inline-flex size-12 items-center justify-center rounded-lg text-[color:var(--text-muted)]",
          focusRing,
        )}
      >
        <Menu className="size-icon-lg" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => undefined}
        className={cn(
          "inline-flex min-h-12 items-center gap-1.5 rounded-pill border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 text-sm-minus font-bold text-[color:var(--text-heading)]",
          focusRing,
        )}
      >
        <Star className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden />
        Favourites
        <ChevronDown className="size-icon-sm text-[color:var(--text-soft)]" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="New chat"
        onClick={() => undefined}
        className={cn(
          "inline-flex size-12 items-center justify-center rounded-lg text-[color:var(--text-muted)]",
          focusRing,
        )}
      >
        <Plus className="size-icon-lg" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The page header: title, live count, one ellipsis sheet. Nothing else.
 *
 * `count` is the honest pair — matched and total — because a filtered library
 * that reports only one number is the defect `#091` closed on the results band.
 */
export function PageHeader({
  matched,
  total,
  onOpenActions,
  statusNote,
}: {
  matched: number;
  total: number;
  onOpenActions: () => void;
  statusNote?: string;
}) {
  const filtered = matched !== total;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg-minus font-extrabold leading-6 tracking-display text-[color:var(--text-heading)]">
          Favourites
        </h2>
        <p className="mt-0.5 truncate text-2xs font-semibold leading-4 text-[color:var(--text-muted)]">
          {statusNote ?? (filtered ? `${matched} of ${total} saved` : `${total} saved`)}
        </p>
      </div>
      <button
        type="button"
        aria-label="Favourites options"
        aria-haspopup="dialog"
        onClick={onOpenActions}
        className={cn(
          "inline-flex size-12 shrink-0 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
          focusRing,
        )}
      >
        <MoreHorizontal className="size-icon-md" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The set rail.
 *
 * A weighted segment track — the shape `DocumentSectionTrack` draws — was the
 * first attempt and was dropped: eight sets across 390px gives each segment
 * about 48px, which is under the width a set name needs, so the track degrades
 * to eight unlabelled slivers and the labels move into a sheet nobody opens.
 * A scrolling chip rail keeps every set name and its count legible, and pays
 * for it by putting the later sets off-screen until you scroll.
 */
export function SetRail({
  sets,
  activeId,
  onSelect,
}: {
  sets: ReadonlyArray<{ id: string; label: string; count: number }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="shrink-0 border-b border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="flex gap-1.5 overflow-x-auto px-3 py-1.5 [scrollbar-width:none]">
        {sets.map((set) => {
          const active = set.id === activeId;
          return (
            <button
              key={set.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(set.id)}
              className={cn(
                "inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-pill border px-3 text-2xs font-bold transition",
                focusRing,
                active
                  ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
              )}
            >
              {set.label}
              <span
                className={cn(
                  "tabular-nums font-extrabold",
                  active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-soft)]",
                )}
              >
                {set.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════  composer  ═══════════════════════════ */

/**
 * The shared bottom composer, edge-to-edge and painting its own home-indicator
 * region. There is no search field in the header: the composer is the page's
 * only input, and typing into it filters the list in place — which is already
 * how `/favourites` behaves through `useSearchCommand`.
 */
export function PhoneComposer({ query = "" }: { query?: string }) {
  return (
    <div className="shrink-0 border-t border-[color:var(--border)] bg-[color:var(--surface-chrome)] px-3 pb-4 pt-2.5">
      <div
        className={cn(
          // 44px, and deliberately so: SPEC 4.10 carves the phone composer and
          // its icon buttons out of the 48px knob below 431px, because the
          // edge-to-edge dock height is part of the search-chrome contract.
          // This is the one control on the page that is not min-h-12.
          "flex min-h-11 items-center gap-2 rounded-pill border border-[color:var(--border)] bg-[color:var(--surface)] px-3",
          query ? "border-[color:var(--clinical-accent-border)]" : null,
        )}
      >
        <Plus className="size-icon-md shrink-0 text-[color:var(--text-soft)]" aria-hidden />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm-minus font-medium",
            query ? "text-[color:var(--text-heading)]" : "text-[color:var(--text-placeholder)]",
          )}
        >
          {query || "Search favourites…"}
        </span>
        {query ? <span className="h-4 w-px bg-[color:var(--clinical-accent)]" aria-hidden /> : null}
        <Search className="size-icon-md shrink-0 text-[color:var(--text-soft)]" aria-hidden />
      </div>
    </div>
  );
}

/* ═══════════════════════════  in-frame sheet  ═══════════════════════════ */

/**
 * A bottom sheet drawn inside the frame. The production `Sheet`
 * (`src/components/ui/sheet.tsx`) portals to the overlay root, which would
 * escape the phone frame, so this is the frame-local stand-in. The geometry —
 * rounded-xl top corners, a grab handle, a titled header, a bordered footer —
 * matches what `Sheet` renders on a phone.
 */
export function FrameSheet({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className="absolute inset-0 bg-[color:var(--overlay-backdrop)]"
      />
      <div
        role="dialog"
        aria-label={title}
        className="relative max-h-[78%] overflow-y-auto rounded-t-xl border-t border-[color:var(--border)] bg-[color:var(--surface)] pb-5 shadow-[var(--e4)]"
      >
        <div className="sticky top-0 rounded-t-xl bg-[color:var(--surface)] px-4 pb-2 pt-2.5">
          <div className="mx-auto mb-3 h-1 w-9 rounded-pill bg-[color:var(--border-strong)]" aria-hidden />
          <h3 className="text-base-minus font-extrabold text-[color:var(--text-heading)]">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">{description}</p>
          ) : null}
        </div>
        <div className="px-3 pt-1">{children}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════  desktop  ═══════════════════════════ */

export function DesktopFrame({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    // Width pinned so the caption's "1280 wide" is the truth rather than
    // whatever the surrounding container happens to give it.
    <figure className="w-full" style={{ maxWidth: "80rem" }}>
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-3xs font-extrabold uppercase tracking-kicker text-[color:var(--text-soft)]">{label}</span>
        {note ? <span className="text-3xs font-bold text-[color:var(--text-soft)]">{note}</span> : null}
      </figcaption>
      <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--background)] shadow-[var(--e2)]">
        {children}
      </div>
    </figure>
  );
}

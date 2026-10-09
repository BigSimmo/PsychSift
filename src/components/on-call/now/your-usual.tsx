"use client";

import { Phone, Pin, PinOff, Shield, Trash2, type LucideIcon } from "lucide-react";
import { useId, useRef, useState, type RefObject } from "react";

import { focusRing } from "@/components/card-recipes";
import { OnCallDialSheet, onCallMobileRoute } from "@/components/on-call/kit/dial-sheet";
import { toHandbookDial } from "@/components/on-call/kit/dial-row";
import { onCallActionLink, onCallOutlineButton, onCallOutlineDisc } from "@/components/on-call/kit/calm";
import { OnCallRow } from "@/components/on-call/kit/grouped-list";
import { modePressable, modeTapArea } from "@/components/mode-kit/recipes";
import { Sheet } from "@/components/ui/sheet";
import { OnCallStateLabel } from "@/components/on-call/kit/state-label";
import { modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { useOnCallYouCalledAt } from "@/components/on-call/kit/use-you-called";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { rememberOnCallYouCalled } from "@/lib/on-call/call-marks";
import { formatOnCallTime } from "@/lib/on-call/display-dates";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { ON_CALL_YOU_CALLED_ENABLED } from "@/lib/on-call/feature-flags";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import {
  resolveOnCallNumber,
  spokenOnCallNumber,
  type HandbookDial,
  type OnCallNumberFields,
} from "@/lib/on-call/number-resolver";
import {
  clearOnCallRecent,
  recordOnCallRecent,
  resolveOnCallUsual,
  setOnCallUsualPinned,
  type OnCallRecentItem,
} from "@/lib/on-call/recent-storage";

/** Four identical tiles, then "Show all" (v6 Now). */
const ON_CALL_USUAL_TILE_LIMIT = 4;

export type UsualTile =
  | {
      readonly kind: "handbook";
      readonly id: string;
      readonly title: string;
      readonly item: HandbookItem;
      readonly pinnable: boolean;
      readonly pinned: boolean;
    }
  | {
      readonly kind: "entry";
      readonly id: string;
      readonly title: string;
      readonly entry: OnCallEntry;
      readonly pinnable: boolean;
      readonly pinned: boolean;
    }
  | { readonly kind: "removed"; readonly id: string };

/**
 * "Your usual" as tiles, in this shift's frozen order.
 *
 *  - Every stored row goes through `resolveOnCallUsual` (review B2): a hospital
 *    row takes its title and number from the signed-in handbook at render and
 *    is hidden when the handbook no longer has it. A hospital row this device
 *    saw withdrawn shows the removed notice instead of a number.
 *  - The reader's own entries ticked "Call first on the home" that are not
 *    listed yet join at the end, in their own order: that is how a new
 *    reader's list starts.
 *  - An own entry must still exist to be shown; its digits are read from the
 *    live entry, never from storage.
 */
export function usualTiles({
  usual,
  handbookItems,
  removedIds,
  entries,
}: {
  readonly usual: readonly OnCallRecentItem[];
  readonly handbookItems: readonly HandbookItem[];
  readonly removedIds: ReadonlySet<string>;
  readonly entries: readonly OnCallEntry[];
}): UsualTile[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const resolved = new Map(resolveOnCallUsual(usual, handbookItems).map((row) => [row.item.id, row]));
  const tiles: UsualTile[] = [];
  const listed = new Set<string>();
  for (const item of usual) {
    const row = resolved.get(item.id);
    if (row?.handbook) {
      tiles.push({
        kind: "handbook",
        id: item.id,
        title: row.handbook.parsed.label,
        item: row.handbook,
        pinnable: true,
        pinned: item.pinned,
      });
    } else if (row) {
      const entry = entriesById.get(item.id);
      if (entry)
        tiles.push({ kind: "entry", id: item.id, title: entry.title, entry, pinnable: true, pinned: item.pinned });
    } else if (item.source === "handbook" && removedIds.has(item.id)) {
      tiles.push({ kind: "removed", id: item.id });
    }
    listed.add(item.id);
  }
  const callFirst = entries
    .filter((entry) => entry.tags.includes("call-first") && !listed.has(entry.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  for (const entry of callFirst) {
    tiles.push({ kind: "entry", id: entry.id, title: entry.title, entry, pinnable: false, pinned: false });
  }
  return tiles;
}

function recordCall(tile: Extract<UsualTile, { kind: "handbook" | "entry" }>): void {
  // A hospital row is remembered by id and kind only; its title stays in the
  // signed-in handbook (review B2).
  recordOnCallRecent(
    tile.kind === "handbook" ? { id: tile.id, source: "handbook" } : { id: tile.id, title: tile.title },
  );
  if (ON_CALL_YOU_CALLED_ENABLED) rememberOnCallYouCalled(tile.id);
}

function PinToggle({ tile }: { readonly tile: Extract<UsualTile, { kind: "handbook" | "entry" }> }) {
  if (!tile.pinnable) return null;
  const Icon = tile.pinned ? PinOff : Pin;
  return (
    <button
      type="button"
      aria-pressed={tile.pinned}
      aria-label={`${tile.pinned ? "Unpin" : "Pin"} ${tile.title}`}
      onClick={() => setOnCallUsualPinned(tile.id, !tile.pinned)}
      data-testid={`on-call-now-usual-${tile.id}-pin`}
      className={cn(modeTapArea, focusRing, "rounded-md text-[color:var(--mode-identity)]")}
    >
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
    </button>
  );
}

/**
 * A tile's badge: a short label the title already carries ("W2" for "Ward 2",
 * "ED"), or a glyph. Never invented: anything else wears the phone glyph.
 */
function usualBadge(title: string): { readonly text: string } | { readonly icon: LucideIcon } {
  const ward = /\bward\s+([0-9][0-9a-z]{0,2}|[a-z][0-9]{1,2})\b/i.exec(title);
  if (ward) return { text: `W${ward[1]!.toUpperCase()}`.slice(0, 3) };
  if (/\b(ED|emergency department|emergency dept)\b/i.test(title)) return { text: "ED" };
  if (/\bsecurity\b/i.test(title)) return { icon: Shield };
  return { icon: Phone };
}

function BadgeFace({ title }: { readonly title: string }) {
  const badge = usualBadge(title);
  return (
    <span aria-hidden="true" className={cn(onCallOutlineDisc, "size-12 text-sm font-semibold")}>
      {"text" in badge ? badge.text : <badge.icon aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />}
    </span>
  );
}

const tileClass = "grid min-w-0 justify-items-center gap-1.5 text-center";
const tileLabel = cn(modeSecondaryText, "line-clamp-2 break-words text-[color:var(--text)]");

function DialTile({
  tile,
  hospitalName,
  now,
}: {
  readonly tile: Extract<UsualTile, { kind: "handbook" | "entry" }>;
  readonly hospitalName: string | null;
  readonly now: Date;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const calledAt = useOnCallYouCalledAt(tile.id);
  let dial: HandbookDial | null;
  let mobileDial: HandbookDial | null = null;
  let withhold = false;
  let label: string | null = null;
  if (tile.kind === "handbook") {
    dial = tile.item.dial.kind === "none" ? null : tile.item.dial;
    mobileDial = tile.item.mobileDial;
  } else {
    const resolved = resolveOnCallNumber(tile.entry.details as OnCallNumberFields, now);
    dial = toHandbookDial(resolved);
    // A personal number does not print on Now, as Contacts treats it; the
    // tile still dials it.
    withhold = tile.entry.isPersonal;
    // "After hours", "Pager": which of the entry's lines this tile rings now.
    label = resolved?.label && resolved.label !== "Direct" ? resolved.label : null;
  }
  const route = dial ? onCallMobileRoute(dial, mobileDial) : null;
  const viaMobile = Boolean(route && route !== dial);
  const onCall = () => recordCall(tile);
  const name = withhold
    ? `Call ${tile.title}`
    : route
      ? `Call ${tile.title}${viaMobile ? " from a mobile" : ""}, ${spokenOnCallNumber(route.display)}`
      : "";

  return (
    <li className={tileClass} data-testid={`on-call-now-usual-${tile.id}`}>
      {route?.tel ? (
        <a href={route.tel} onClick={onCall} aria-label={name} className={cn(focusRing, "rounded-full")}>
          <BadgeFace title={tile.title} />
        </a>
      ) : dial && !withhold ? (
        // A desk-only number: the badge opens its dialling details instead.
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`${tile.title}, ${dial.display}. From a hospital phone. Dialling details`}
          onClick={() => setSheetOpen(true)}
          className={cn(focusRing, "rounded-full")}
        >
          <BadgeFace title={tile.title} />
        </button>
      ) : (
        <BadgeFace title={tile.title} />
      )}
      {dial && !withhold ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`${tile.title}, ${dial.display}. Dialling details`}
          onClick={() => setSheetOpen(true)}
          className={cn(focusRing, modePressable, "min-h-12 w-full rounded-md px-0.5")}
        >
          <span className={tileLabel}>{tile.title}</span>
          {label ? <span className="block text-xs text-[color:var(--text-muted)]">{label}</span> : null}
          {calledAt ? (
            <span className={cn(modeNumberText, "block text-xs text-[color:var(--text-muted)]")}>
              {`Called ${formatOnCallTime(calledAt)}`}
            </span>
          ) : null}
        </button>
      ) : (
        <span className="grid min-h-12 content-start">
          <span className={tileLabel}>{tile.title}</span>
          {!dial ? <OnCallStateLabel state={{ kind: "not-recorded" }} /> : null}
        </span>
      )}
      {dial && !withhold ? (
        <OnCallDialSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={tile.title}
          hospitalName={tile.kind === "handbook" ? hospitalName : null}
          dial={dial}
          mobileDial={mobileDial}
          updatedAt={tile.kind === "handbook" ? tile.item.updatedAt : null}
          sources={tile.kind === "handbook" ? tile.item.sources : undefined}
          now={now}
          onCall={onCall}
          testId={`on-call-now-usual-${tile.id}-sheet`}
        />
      ) : null}
    </li>
  );
}

function TileOutlines({ count }: { readonly count: number }) {
  return (
    <ul aria-hidden="true" className={tilesGrid} data-testid="on-call-now-usual-outlines">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} data-skeleton-row="" className={tileClass}>
          <span className="size-12 rounded-full bg-[color:var(--surface-subtle)]" />
          <span className="h-3 w-3/5 rounded-sm bg-[color:var(--surface-subtle)]" />
        </li>
      ))}
    </ul>
  );
}

/** Four across; enlarged text drops to two, so a label is never cut off. */
const tilesGrid = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,4.5rem),1fr))] gap-2";

/** "Edit": pin or unpin each tile, or clear the list, in one sheet. */
function EditSheet({
  open,
  onClose,
  returnFocusRef,
  tiles,
  canClear,
}: {
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly tiles: readonly UsualTile[];
  readonly canClear: boolean;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      title="Your usual"
      testId="on-call-now-usual-edit"
    >
      <div data-mode-identity="on-call" className="grid gap-3">
        <p className={modeSecondaryText}>Numbers you call join this list on their own. Pin one to keep it in place.</p>
        <ul role="list" className="min-w-0">
          {tiles.map((tile) =>
            tile.kind === "removed" ? null : (
              <OnCallRow
                key={tile.id}
                title={tile.title}
                trailing={<PinToggle tile={tile} />}
                testId={`on-call-now-usual-edit-${tile.id}`}
              />
            ),
          )}
        </ul>
        {canClear ? (
          <button
            type="button"
            onClick={() => {
              clearOnCallRecent();
              onClose();
            }}
            data-testid="on-call-home-recent-clear"
            className={cn(onCallOutlineButton, focusRing)}
          >
            <Trash2 aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
            Clear the list
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

export function NowYourUsual({
  tiles,
  outlineCount,
  canClear,
  hospitalName,
  now,
}: {
  readonly tiles: readonly UsualTile[];
  /** Whether this device holds a list to clear (the call-first entries are not part of it). */
  readonly canClear: boolean;
  /** Held as static outlines while the hospital's numbers load; null once they have. */
  readonly outlineCount: number | null;
  readonly hospitalName: string | null;
  readonly now: Date;
}) {
  const headingId = useId();
  // Clearing the list can remove the Edit button itself, so focus comes back to the heading.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const shown = expanded ? tiles : tiles.slice(0, ON_CALL_USUAL_TILE_LIMIT);
  const editable = outlineCount === null && tiles.some((tile) => tile.kind !== "removed" && tile.pinnable);
  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-1" data-testid="on-call-home-recent">
      <div className="flex min-h-12 min-w-0 items-center justify-between gap-2 px-1">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className={cn(eyebrowText, "focus:outline-none")}>
          Your usual
        </h2>
        {editable || (canClear && outlineCount === null) ? (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setEditing(true)}
            data-testid="on-call-now-usual-edit-open"
            className={cn(onCallActionLink, focusRing)}
          >
            Edit
          </button>
        ) : null}
      </div>
      {outlineCount !== null ? (
        <TileOutlines count={Math.max(1, Math.min(outlineCount, ON_CALL_USUAL_TILE_LIMIT))} />
      ) : tiles.length === 0 ? (
        <p className={cn(modeSecondaryText, "px-1")} data-testid="on-call-now-usual-empty">
          To add a number, tick &quot;Call first on the home&quot; on your own entry.
        </p>
      ) : (
        <>
          <ul role="list" className={cn(tilesGrid, "work-card p-1")} data-testid="on-call-now-usual">
            {shown.map((tile) =>
              tile.kind === "removed" ? (
                <li key={tile.id} className={tileClass} data-testid={`on-call-now-usual-${tile.id}`}>
                  <OnCallStateLabel state={{ kind: "removed" }} />
                </li>
              ) : (
                <DialTile key={tile.id} tile={tile} hospitalName={hospitalName} now={now} />
              ),
            )}
          </ul>
          {tiles.length > ON_CALL_USUAL_TILE_LIMIT ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
              data-testid="on-call-now-usual-more"
              className={cn(onCallActionLink, focusRing, "justify-self-start px-1")}
            >
              {expanded ? "Show fewer" : `Show all ${tiles.length}`}
            </button>
          ) : null}
        </>
      )}
      <EditSheet
        open={editing}
        onClose={() => setEditing(false)}
        returnFocusRef={headingRef}
        tiles={tiles}
        canClear={canClear}
      />
    </section>
  );
}

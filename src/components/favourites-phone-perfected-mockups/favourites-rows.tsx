"use client";

import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  FolderInput,
  History,
  ListFilter,
  MoreHorizontal,
  Pin,
  PinOff,
  RotateCw,
  Search,
  Star,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn, EmptyState } from "@/components/ui-primitives";

import { focusRing } from "./favourites-phone-shell";
import { kindIdentity, setLabels, setOrder, type FavouriteRow, type FavouriteSetId } from "./fixtures";

/* ═══════════════════════════  the row  ═══════════════════════════ */

/**
 * One favourite, one line.
 *
 * The production phone card (`FavouriteMobileCard`,
 * favourites-command-library-page.tsx:591) measures 228px at 390px wide: a
 * two-line description, two chips, a two-row definition list, an Open button
 * and a kebab. Everything below the title moves onto a single metadata line or
 * into the actions sheet, and the row falls to 72px — seven fully above the
 * fold, where the shipped page puts the first one at y=1141 and shows none.
 *
 * The whole row opens the item; the trailing control opens its actions. They
 * are siblings rather than nested so a keyboard user gets two clean stops, and
 * both clear 44px.
 */
export function FavouriteListRow({
  row,
  showPinGlyph,
  typeAs = "word",
  onOpen,
  onOpenActions,
}: {
  row: FavouriteRow;
  /** `chip` is the pill the shipped Recent card uses. It scans faster and
   *  costs about 14px of the metadata line's width. */
  typeAs?: "word" | "chip";
  /** Only when the list is ungrouped. Inside the Pinned group the glyph
   *  repeats the label above it, and a title that wraps to two lines leaves it
   *  stranded on a line of its own. */
  showPinGlyph: boolean;
  onOpen: (row: FavouriteRow) => void;
  onOpenActions: (row: FavouriteRow) => void;
}) {
  const identity = kindIdentity[row.kind];
  const Glyph = identity.icon;

  return (
    <li className="relative border-b border-[color:var(--border)] last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(row)}
        className={cn("absolute inset-0 hover:bg-[color:var(--surface-subtle)]", focusRing)}
      >
        <span className="sr-only">Open {row.title}</span>
      </button>

      <div className="pointer-events-none relative flex min-h-18 items-center gap-3 px-3 py-3">
        <span
          aria-hidden
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border"
          style={{ background: identity.soft, borderColor: identity.border, color: identity.ink }}
        >
          <Glyph className="size-icon-md" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-sm-minus font-bold leading-5 text-[color:var(--text-heading)]">
            {row.title}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs font-semibold leading-4 text-[color:var(--text-muted)]">
            {showPinGlyph && row.pinned ? (
              <Pin className="size-icon-xs shrink-0 text-[color:var(--clinical-accent)]" aria-label="Pinned" />
            ) : null}
            {typeAs === "chip" ? (
              <span
                className="shrink-0 rounded-pill border px-1.5 py-px text-3xs font-extrabold"
                style={{ background: identity.soft, borderColor: identity.border, color: identity.ink }}
              >
                {identity.label}
              </span>
            ) : (
              <>
                <span className="shrink-0" style={{ color: identity.ink }}>
                  {identity.label}
                </span>
                <span aria-hidden className="text-[color:var(--decoration-soft)]">
                  ·
                </span>
              </>
            )}
            <span className="truncate">{row.detail}</span>
            <span aria-hidden className="text-[color:var(--decoration-soft)]">
              ·
            </span>
            <span className="shrink-0 text-[color:var(--text-soft)]">{row.lastOpened}</span>
          </span>
        </span>

        <button
          type="button"
          aria-label={`Actions for ${row.title}`}
          aria-haspopup="dialog"
          onClick={() => onOpenActions(row)}
          className={cn(
            "pointer-events-auto relative z-10 inline-flex size-12 shrink-0 items-center justify-center rounded-lg text-[color:var(--text-soft)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-muted)]",
            focusRing,
          )}
        >
          <MoreHorizontal className="size-icon-md" aria-hidden />
        </button>
      </div>
    </li>
  );
}

/**
 * Continue — resume what you were last doing.
 *
 * This is the one derived card from the shipped page that survives, because it
 * answers a different question from the list beneath it: "what was I in the
 * middle of" rather than "what have I saved". It sits above the pinned group
 * and does not scroll away, which is the whole point of a resume affordance.
 *
 * The shipped Continue card measures 113px because the title, the metadata and
 * a full-width Continue button are three stacked things. Here the strip IS the
 * button, so it costs 72px — one row — and keeps a 48px target.
 *
 * The Recent card deliberately did not survive: it measures 277px to show the
 * three most recently opened items, and the list below it is already sorted by
 * recency, so those same three are the first three rows. It buys nothing.
 */
export function ContinueStrip({ row, onOpen }: { row: FavouriteRow; onOpen: (row: FavouriteRow) => void }) {
  const identity = kindIdentity[row.kind];
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className={cn(
        "flex w-full min-h-18 items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--clinical-accent-soft)] py-3 pl-3 pr-2 text-left shadow-[var(--rule-accent)] hover:brightness-[0.98]",
        focusRing,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-3xs font-extrabold uppercase tracking-kicker text-[color:var(--clinical-accent)]">
          <History className="size-icon-xs shrink-0" aria-hidden />
          Continue
          <span aria-hidden className="text-[color:var(--decoration-soft)]">
            ·
          </span>
          <span className="truncate font-bold normal-case tracking-normal text-[color:var(--text-muted)]">
            {setLabels[row.setId]} · {row.lastOpened}
          </span>
        </span>
        <span className="mt-1 line-clamp-1 block text-sm-minus font-bold leading-5 text-[color:var(--text-heading)]">
          {row.title}
        </span>
      </span>
      <span
        aria-hidden
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border"
        style={{ background: identity.soft, borderColor: identity.border, color: identity.ink }}
      >
        <ExternalLink className="size-icon-md" aria-hidden />
      </span>
    </button>
  );
}

/**
 * Continue, as the shipped page draws it: the title and its metadata, then a
 * full-width action beneath them. 113px measured.
 *
 * `ContinueStrip` above is the 72px compression of the same idea. Both are
 * kept because the choice between them is a real one — this version is a
 * bigger, more obvious target and reads as an action; the strip reads as the
 * first row of the list and costs a third as much.
 *
 * The shipped card tints its rule and kicker with `--success`. That token is
 * the clinical-state layer, and TOKENS.md scopes it to source state and
 * sanctioned urgency only — a resume affordance is neither. The accent is used
 * here instead, which is the same visual job inside the information layer.
 */
export function ContinueCard({ row, onOpen }: { row: FavouriteRow; onOpen: (row: FavouriteRow) => void }) {
  const identity = kindIdentity[row.kind];
  const Glyph = identity.icon;
  return (
    <section
      aria-label="Continue where you left off"
      className="overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3 shadow-[var(--e1),var(--rule-accent)]"
    >
      <div className="flex min-w-0 items-start gap-2 pl-1.5">
        <Glyph className="mt-px size-icon-md shrink-0" style={{ color: identity.ink }} aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="text-2xs font-extrabold uppercase tracking-kicker text-[color:var(--clinical-accent)]">
            Continue
          </span>{" "}
          <span className="text-sm-minus font-bold leading-5 text-[color:var(--text-heading)]">{row.title}</span>
        </p>
      </div>
      <p className="mt-1 pl-1.5 text-2xs font-semibold leading-4 text-[color:var(--text-muted)]">
        {setLabels[row.setId]} · last opened {row.lastOpened}
      </p>
      <button
        type="button"
        onClick={() => onOpen(row)}
        className={cn(
          "mt-2.5 flex w-full min-h-12 items-center justify-center gap-2 rounded-lg bg-[color:var(--command)] px-4 text-sm-minus font-bold text-[color:var(--command-contrast)] hover:bg-[color:var(--command-hover)]",
          focusRing,
        )}
      >
        <ExternalLink className="size-icon-md" aria-hidden />
        Continue
      </button>
    </section>
  );
}

/**
 * Recent, as the shipped page draws it: a titled card, a View all escape, and
 * three rows each carrying a type pill and its own Open button. 277px measured.
 *
 * It only earns that space if the list beneath it is NOT sorted by recency —
 * otherwise its three rows are that list's first three rows and the card is a
 * second copy. So a page that keeps this card should default the list to the
 * user's own filing (grouped by set), which is what `FavouritesList`'s
 * `groupBy="set"` does. Continue, Recent and the library then answer three
 * different questions: what was I mid-way through, what did I just touch, and
 * what have I organised.
 */
export function RecentCard({
  rows,
  onOpen,
  onViewAll,
}: {
  rows: readonly FavouriteRow[];
  onOpen: (row: FavouriteRow) => void;
  onViewAll: () => void;
}) {
  return (
    <section
      aria-label="Recently opened"
      className="overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--e1)]"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="inline-flex items-center gap-1.5 text-2xs font-extrabold uppercase tracking-kicker text-[color:var(--text-muted)]">
          <History className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden />
          Recent
        </p>
        <button
          type="button"
          onClick={onViewAll}
          className={cn(
            "-mr-1 inline-flex min-h-12 items-center rounded-lg px-2 text-2xs font-bold text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)]",
            focusRing,
          )}
        >
          View all
        </button>
      </div>
      <ul className="border-t border-[color:var(--border)]">
        {rows.map((row) => {
          const identity = kindIdentity[row.kind];
          return (
            <li
              key={row.id}
              className="flex min-h-18 items-center gap-2.5 border-b border-[color:var(--border)] px-3 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="shrink-0 rounded-pill border px-1.5 py-px text-3xs font-extrabold"
                    style={{ background: identity.soft, borderColor: identity.border, color: identity.ink }}
                  >
                    {identity.label}
                  </span>
                  <span className="line-clamp-1 text-sm-minus font-bold leading-5 text-[color:var(--text-heading)]">
                    {row.title}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-2xs font-semibold text-[color:var(--text-muted)]">
                  {setLabels[row.setId]} · {row.lastOpened}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onOpen(row)}
                aria-label={`Open ${row.title}`}
                className={cn(
                  "inline-flex min-h-12 shrink-0 items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm-minus font-bold text-[color:var(--text-heading)] hover:border-[color:var(--border-strong)]",
                  focusRing,
                )}
              >
                Open
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-1.5 text-3xs font-extrabold uppercase tracking-kicker text-[color:var(--text-soft)]">
      {children}
    </p>
  );
}

/**
 * Pinned rows lead every view under one label, then the rest follow.
 *
 * `pinnedAt` has been in the schema since `20260823090000_user_favourite_sets`
 * and in the `PATCH setPinned` contract, with no control anywhere in the app.
 * This is the control. It costs one 24px label, and when nothing is pinned the
 * label does not render, so an unpinned library pays nothing for it.
 */
export function FavouritesList({
  rows,
  showPinnedGroup,
  groupBySet = false,
  typeAs = "word",
  onOpen,
  onOpenActions,
}: {
  rows: readonly FavouriteRow[];
  showPinnedGroup: boolean;
  /** Group under set names instead. The shape a page keeping the Recent card
   *  needs, so the library is the user's own filing rather than a second
   *  recency list. */
  groupBySet?: boolean;
  typeAs?: "word" | "chip";
  onOpen: (row: FavouriteRow) => void;
  onOpenActions: (row: FavouriteRow) => void;
}) {
  const pinned = showPinnedGroup ? rows.filter((row) => row.pinned) : [];
  const rest = showPinnedGroup ? rows.filter((row) => !row.pinned) : rows;

  if (groupBySet) {
    const pinnedInView = rows.filter((row) => row.pinned);
    const restInView = rows.filter((row) => !row.pinned);
    const bySet = setOrder
      .filter((id) => id !== "all")
      .map((id) => ({ id, label: setLabels[id], items: restInView.filter((row) => row.setId === id) }))
      .filter((group) => group.items.length > 0);

    return (
      <div className="bg-[color:var(--surface)]">
        {pinnedInView.length > 0 ? (
          <>
            <GroupLabel>Pinned</GroupLabel>
            <ul>
              {pinnedInView.map((row) => (
                <FavouriteListRow
                  key={row.id}
                  row={row}
                  showPinGlyph={false}
                  typeAs={typeAs}
                  onOpen={onOpen}
                  onOpenActions={onOpenActions}
                />
              ))}
            </ul>
          </>
        ) : null}
        {bySet.map((group) => (
          <section key={group.id}>
            <GroupLabel>
              {group.label} · {group.items.length}
            </GroupLabel>
            <ul>
              {group.items.map((row) => (
                <FavouriteListRow
                  key={row.id}
                  row={row}
                  showPinGlyph
                  typeAs={typeAs}
                  onOpen={onOpen}
                  onOpenActions={onOpenActions}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-[color:var(--surface)]">
      {pinned.length > 0 ? (
        <>
          <GroupLabel>Pinned</GroupLabel>
          <ul>
            {pinned.map((row) => (
              <FavouriteListRow
                key={row.id}
                row={row}
                showPinGlyph={!showPinnedGroup}
                typeAs={typeAs}
                onOpen={onOpen}
                onOpenActions={onOpenActions}
              />
            ))}
          </ul>
        </>
      ) : null}

      {rest.length > 0 ? (
        <>
          {pinned.length > 0 ? <GroupLabel>Everything else</GroupLabel> : null}
          <ul>
            {rest.map((row) => (
              <FavouriteListRow
                key={row.id}
                row={row}
                showPinGlyph={!showPinnedGroup}
                typeAs={typeAs}
                onOpen={onOpen}
                onOpenActions={onOpenActions}
              />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════  states  ═══════════════════════════ */

/** One no-match state, rendered once. Three simultaneous live regions was the
 *  defect `#225` closed; the shape it settled on is one. */
export function NoMatchesState({ query, total }: { query: string; total: number }) {
  return (
    <div className="px-4 py-10">
      <EmptyState
        icon={Search}
        headingLevel={3}
        title={`No favourites match "${query}"`}
        body={`This searches your saved items only. Clear the search to see all ${total}, or search the whole library from any other mode.`}
        actions={
          <button
            type="button"
            onClick={() => undefined}
            className={cn(
              "inline-flex min-h-12 items-center gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-4 text-sm-minus font-bold text-[color:var(--clinical-accent)]",
              focusRing,
            )}
          >
            Clear search
          </button>
        }
      />
    </div>
  );
}

/**
 * First run. The version worth building is the one that answers "what is this
 * page for" without a marketing lockup: name the four things that can be
 * saved, because a user who has saved nothing cannot infer them, and give one
 * route out.
 */
export function NothingSavedState() {
  return (
    <div className="px-4 py-8">
      <EmptyState
        icon={Star}
        headingLevel={3}
        title="Nothing saved yet"
        body="Tap the star on anything you want back quickly. It syncs to your account, so it follows you to any device you sign in on."
      />
      <ul className="mt-5 space-y-1.5">
        {(["service", "form", "differential", "therapy"] as const).map((kind) => {
          const identity = kindIdentity[kind];
          const Glyph = identity.icon;
          return (
            <li
              key={kind}
              className="flex items-center gap-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2"
            >
              <span
                aria-hidden
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border"
                style={{ background: identity.soft, borderColor: identity.border, color: identity.ink }}
              >
                <Glyph className="size-icon-sm" />
              </span>
              <span className="text-2xs font-bold text-[color:var(--text-heading)]">{identity.plural}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={() => undefined}
          className={cn(
            "inline-flex min-h-12 items-center gap-2 rounded-lg bg-[color:var(--command)] px-4 text-sm-minus font-bold text-[color:var(--command-contrast)]",
            focusRing,
          )}
        >
          Browse services
          <ArrowRight className="size-icon-md" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * Partial load. `foldSavedFavouritesStatus` can return `partial`, and the rule
 * the results band settled on (`#091`) is that a partial failure reports the
 * honest loaded count and an explicit retry — never a fabricated zero and
 * never a total that includes rows it could not fetch.
 */
export function PartialLoadNotice({ failed }: { failed: number }) {
  return (
    <div className="border-b border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-3 py-2.5">
      <div className="flex gap-2.5">
        <CircleAlert className="mt-px size-icon-md shrink-0 text-[color:var(--warning-text)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-bold leading-4 text-[color:var(--warning-text)]">
            {failed} favourites could not be loaded
          </p>
          <p className="mt-0.5 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
            The count above is what actually loaded. Nothing has been removed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => undefined}
          className={cn(
            "inline-flex min-h-12 shrink-0 items-center gap-1.5 self-start rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--surface)] px-2.5 text-2xs font-bold text-[color:var(--warning-text)]",
            focusRing,
          )}
        >
          <RotateCw className="size-icon-sm" aria-hidden />
          Retry
        </button>
      </div>
    </div>
  );
}

/** The gate. `canAccessFavouritesMode` is `demoMode || authenticated`, so this
 *  is the boundary of "for logged-in users" and worth drawing once. */
export function SignedOutGate() {
  return (
    <div className="px-4 py-10">
      <EmptyState
        icon={UserRoundCheck}
        headingLevel={3}
        title="Favourites are tied to your account"
        body="Sign in and your saved services, forms, differentials and therapies appear here on every device."
        actions={
          <button
            type="button"
            onClick={() => undefined}
            className={cn(
              "inline-flex min-h-12 items-center gap-2 rounded-lg bg-[color:var(--command)] px-4 text-sm-minus font-bold text-[color:var(--command-contrast)]",
              focusRing,
            )}
          >
            Sign in
          </button>
        }
      />
    </div>
  );
}

/* ═══════════════════════════  sheet bodies  ═══════════════════════════ */

function SheetRow({
  icon: Glyph,
  label,
  hint,
  tone = "default",
  trailing,
  onClick,
}: {
  icon: typeof Pin;
  label: string;
  hint?: string;
  tone?: "default" | "danger";
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full min-h-12 items-center gap-3 rounded-lg px-3 text-left hover:bg-[color:var(--surface-subtle)]",
        focusRing,
      )}
    >
      <Glyph
        className={cn(
          "size-icon-md shrink-0",
          tone === "danger" ? "text-[color:var(--danger-text)]" : "text-[color:var(--text-soft)]",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm-minus font-bold",
            tone === "danger" ? "text-[color:var(--danger-text)]" : "text-[color:var(--text-heading)]",
          )}
        >
          {label}
        </span>
        {hint ? (
          <span className="mt-0.5 block truncate text-2xs font-medium text-[color:var(--text-muted)]">{hint}</span>
        ) : null}
      </span>
      {trailing}
    </button>
  );
}

/** Everything the production card carried inline, and the pin toggle the API
 *  has always supported. Four rows, each a full-width 48px target. */
export function ItemActionsSheetBody({ row, onClose }: { row: FavouriteRow; onClose: () => void }) {
  return (
    <div className="space-y-0.5 pb-1">
      <SheetRow
        icon={row.pinned ? PinOff : Pin}
        label={row.pinned ? "Unpin from the top" : "Pin to the top"}
        hint={row.pinned ? "Returns it to its set order" : "Keeps it first in every view"}
        onClick={onClose}
      />
      <SheetRow
        icon={FolderInput}
        label="Move to a set"
        hint={`Currently in ${setLabels[row.setId]}`}
        onClick={onClose}
      />
      <SheetRow icon={Copy} label="Copy link" onClick={onClose} />
      <SheetRow icon={Trash2} label="Remove from favourites" tone="danger" onClick={onClose} />
    </div>
  );
}

/**
 * Set management. The six names are a controlled vocabulary
 * (`favouriteSetNames`) with a database CHECK behind them, so this sheet is a
 * picker and not a text field — showing which are already in use and which are
 * still available is the whole job.
 */
export function SetsSheetBody({ counts, onClose }: { counts: Record<FavouriteSetId, number>; onClose: () => void }) {
  const controlled = setOrder.filter((id) => id !== "all" && id !== "unfiled");
  return (
    <div className="space-y-0.5 pb-1">
      {controlled.map((id) => {
        const count = counts[id];
        const inUse = count > 0;
        return (
          <SheetRow
            key={id}
            icon={inUse ? Check : ListFilter}
            label={setLabels[id]}
            hint={inUse ? `${count} saved` : "Not used yet"}
            onClick={onClose}
          />
        );
      })}
      <p className="px-3 pt-2 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
        Set names are limited to these six approved clinical workflows. Items you have not filed stay in Unfiled (
        {counts.unfiled}).
      </p>
    </div>
  );
}

/** Confirmation step for the destructive clear-all action. Kept separate from
 *  set management so the page-options row cannot open the wrong sheet. */
export function ClearAllSheetBody({
  total,
  onCancel,
  onConfirm,
}: {
  total: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-3 pb-1">
      <p className="px-3 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
        This removes all {total} saved favourites from your account on every device. It cannot be undone.
      </p>
      <div className="space-y-1.5 px-3">
        <button
          type="button"
          onClick={onConfirm}
          className={cn(
            "flex w-full min-h-12 items-center justify-center rounded-lg bg-[color:var(--danger-solid)] px-4 text-sm-minus font-bold text-[color:var(--danger-solid-contrast)]",
            focusRing,
          )}
        >
          Remove all favourites
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "flex w-full min-h-12 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 text-sm-minus font-bold text-[color:var(--text-heading)]",
            focusRing,
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The page-level sheet: sort, sets, and the destructive action, which belongs
 *  behind a sheet rather than on the header where it can be hit by accident. */
export function PageActionsSheetBody({
  sort,
  onSelectSort,
  onOpenSets,
  onRequestClearAll,
}: {
  sort: "recent" | "title" | "set";
  onSelectSort: (value: "recent" | "title" | "set") => void;
  onOpenSets: () => void;
  onRequestClearAll: () => void;
}) {
  const options: ReadonlyArray<{ value: "recent" | "title" | "set"; label: string; hint: string }> = [
    { value: "recent", label: "Recently opened", hint: "Default" },
    { value: "title", label: "Title, A to Z", hint: "" },
    { value: "set", label: "Grouped by set", hint: "" },
  ];
  return (
    <div className="space-y-0.5 pb-1">
      <p className="px-3 pb-1 pt-1 text-3xs font-extrabold uppercase tracking-kicker text-[color:var(--text-soft)]">
        Sort
      </p>
      {options.map((option) => (
        <SheetRow
          key={option.value}
          icon={Check}
          label={option.label}
          hint={option.hint || undefined}
          trailing={
            sort === option.value ? (
              <Check className="size-icon-md shrink-0 text-[color:var(--clinical-accent)]" aria-label="Selected" />
            ) : undefined
          }
          onClick={() => onSelectSort(option.value)}
        />
      ))}
      <p className="px-3 pb-1 pt-3 text-3xs font-extrabold uppercase tracking-kicker text-[color:var(--text-soft)]">
        Library
      </p>
      <SheetRow icon={FolderInput} label="Manage sets" hint="Six approved workflows" onClick={onOpenSets} />
      <SheetRow icon={Trash2} label="Remove all favourites" tone="danger" onClick={onRequestClearAll} />
    </div>
  );
}

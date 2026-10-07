"use client";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  Copy,
  Folder,
  FolderPlus,
  Layers,
  PenLine,
  Pin,
  PinOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { FavouriteTypeTile } from "@/components/favourites/favourite-type-tile";
import {
  favouriteScopeOf,
  isSourceBacked,
  UNSORTED_SET_NAME,
  type FavouriteItem,
} from "@/components/favourites/favourites-view-model";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import { checkFavouriteSetName, favouriteSetNameMaxLength } from "@/lib/favourite-set-name";
import type { AccountFavouriteSet, FavouriteSetName } from "@/lib/favourites-client-contract";

export type FavouriteSheetState =
  | { kind: "actions"; item: FavouriteItem }
  | { kind: "move"; items: FavouriteItem[] }
  | { kind: "new-set"; items: FavouriteItem[] }
  | { kind: "rename-set"; set: AccountFavouriteSet }
  | null;

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

// Sheets portal to <body>, outside the page's work-mode token scope, so these
// use the app tokens the work-mode ones map to (white card, hairline rows).
const actionCard =
  "grid overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] [&>*+*]:border-t [&>*+*]:border-[color:var(--border)]";

const actionRow = cn(
  "flex min-h-tap w-full items-center gap-3 px-3 py-1.5 text-left text-sm font-bold text-[color:var(--text-heading)] active:bg-[color:var(--surface-wash)]",
  focusRing,
  "focus-visible:-outline-offset-2",
);

function ActionIcon({ icon: Icon, tone = "neutral" }: { icon: LucideIcon; tone?: "neutral" | "accent" | "danger" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full",
        tone === "danger"
          ? "bg-[color:var(--danger-bg)] text-[color:var(--danger)]"
          : "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
      )}
    >
      <Icon className="size-icon-sm" aria-hidden="true" />
    </span>
  );
}

function RowText({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <span className="grid min-w-0 flex-1">
      <span className="truncate">{title}</span>
      {sub ? <span className="truncate text-xs font-medium text-[color:var(--text-muted)]">{sub}</span> : null}
    </span>
  );
}

const setNamesNote = "Name sets by workflow, never by patient. Set names are saved to your account.";

/**
 * Open, pin, edit, move, copy and remove for one favourite. A work page or a
 * number cannot go into a set and has no source to copy, so those two rows are
 * left out for it. Edit gives it the person's own name and note, kept on this
 * phone; when renamed, its own title shows as "Original".
 */
export function FavouriteActionsSheet({
  item,
  open,
  onClose,
  canMutate,
  onOpen,
  onTogglePin,
  onCopyCitation,
  onMove,
  onRemove,
  onEdit,
  returnFocusTarget,
}: {
  item: FavouriteItem;
  open: boolean;
  onClose: () => void;
  /** The control focus goes back to when the sheet closes, such as the row's actions button. */
  returnFocusTarget?: () => HTMLElement | null;
  /** Saved items can be removed (and account items moved); examples cannot. Anything can be pinned. */
  canMutate: boolean;
  onOpen: (item: FavouriteItem) => void;
  onTogglePin: (item: FavouriteItem) => void;
  onCopyCitation: (item: FavouriteItem) => Promise<boolean>;
  onMove: (item: FavouriteItem) => void;
  onRemove: (item: FavouriteItem) => void;
  /** Rename it and add a note. Omitted where the item cannot be changed, such as an example. */
  onEdit?: (item: FavouriteItem) => void;
}) {
  const nameId = useId();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const actionLabel = item.action === "Copy" ? "Open" : item.action;
  const isWork = favouriteScopeOf(item) === "work";
  const pinLabel = item.pinned ? "Unpin from My Day" : "Pin to My Day";
  const description = isWork
    ? [item.type === "Number" ? (item.phone ?? "Number") : (item.areaName ?? "Work page"), "This phone"].join(" · ")
    : [item.type, item.set, isSourceBacked(item) ? "Source-backed" : ""].filter(Boolean).join(" · ");

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item.title}
      labelledBy={nameId}
      headerLeading={<FavouriteTypeTile item={item} size="lg" />}
      description={description}
      closeLabel="Close actions"
      resolveReturnFocusTarget={returnFocusTarget}
      testId="favourite-actions-sheet"
      bodyClassName="p-3 pb-5"
    >
      <span id={nameId} className="sr-only">
        Actions for {item.title}
      </span>
      {item.originalTitle ? (
        <p
          className="m-0 truncate px-1 pb-2 text-xs text-[color:var(--text-muted)]"
          data-testid="favourite-original-title"
        >
          Original: {item.originalTitle}
        </p>
      ) : null}
      {item.note ? (
        <p className="m-0 line-clamp-3 px-1 pb-2 text-sm text-[color:var(--text-muted)]">{item.note}</p>
      ) : null}
      <div className={actionCard}>
        <Link
          href={item.href}
          aria-label={`${actionLabel} ${item.title}`}
          onClick={() => {
            onOpen(item);
            onClose();
          }}
          className={actionRow}
        >
          <ActionIcon icon={ArrowRight} />
          <RowText title={actionLabel} />
        </Link>
        {/* Pinning works for every item: saved ones on the account or this phone, examples in this browser. */}
        <button
          type="button"
          aria-label={pinLabel}
          className={actionRow}
          onClick={() => {
            onTogglePin(item);
            onClose();
          }}
        >
          <ActionIcon icon={item.pinned ? PinOff : Pin} />
          <RowText title={pinLabel} sub="Pinned items sit first on My Day" />
        </button>
        {onEdit ? (
          <button type="button" className={actionRow} onClick={() => onEdit(item)}>
            <ActionIcon icon={PenLine} />
            <RowText title="Edit name and note" sub="Kept on this phone" />
          </button>
        ) : null}
        {canMutate && !isWork ? (
          <button type="button" aria-label="Move to a set" className={actionRow} onClick={() => onMove(item)}>
            <ActionIcon icon={Folder} />
            <RowText title="Move to a set" sub={item.set} />
          </button>
        ) : null}
        {isWork ? null : (
          <button
            type="button"
            className={actionRow}
            onClick={async () => {
              const copied = await onCopyCitation(item);
              setCopyStatus(copied ? "copied" : "failed");
            }}
          >
            <ActionIcon icon={copyStatus === "copied" ? Check : Copy} />
            <RowText
              title={
                copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy link with source"
              }
            />
          </button>
        )}
        {canMutate ? (
          <button
            type="button"
            className={cn(actionRow, "text-[color:var(--danger)] active:bg-[color:var(--danger-soft)]")}
            onClick={() => {
              onRemove(item);
              onClose();
            }}
          >
            <ActionIcon icon={X} tone="danger" />
            <RowText title="Remove from Favourites" />
          </button>
        ) : null}
      </div>
      {canMutate ? null : (
        <p className="px-1 pt-3 text-sm text-[color:var(--text-muted)]">
          This is an example. Save your own favourites to move them into sets or remove them.
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {copyStatus === "copied"
          ? `${item.title} link copied`
          : copyStatus === "failed"
            ? "Unable to copy the link"
            : ""}
      </span>
    </Sheet>
  );
}

function ChoiceList({ children }: { children: ReactNode }) {
  return <div className={actionCard}>{children}</div>;
}

function CurrentMark() {
  return (
    <>
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-md bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
      >
        <Check className="size-icon-xs" strokeWidth={3} aria-hidden="true" />
      </span>
      <span className="sr-only">(current set)</span>
    </>
  );
}

/** Choose the set for one or more favourites. A tap moves them at once, with Undo after. */
export function FavouriteMoveSheet({
  items,
  open,
  sets,
  canCreateSet,
  onClose,
  onPick,
  onNewSet,
  returnFocusTarget,
}: {
  items: FavouriteItem[];
  open: boolean;
  returnFocusTarget?: () => HTMLElement | null;
  sets: AccountFavouriteSet[];
  canCreateSet: boolean;
  onClose: () => void;
  onPick: (setId: string | null) => void;
  onNewSet: () => void;
}) {
  const single = items.length === 1 ? items[0] : null;
  const currentSetId = single ? (single.setId ?? null) : undefined;
  const title = single ? "Move to a set" : `Move ${items.length} favourites`;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={single?.title}
      closeLabel="Close move"
      resolveReturnFocusTarget={returnFocusTarget}
      bodyClassName="grid gap-3 p-3 pb-5"
    >
      <ChoiceList>
        {sets.map((set) => (
          <button key={set.id} type="button" className={actionRow} onClick={() => onPick(set.id)}>
            <ActionIcon icon={Folder} />
            <RowText title={set.name} />
            {currentSetId === set.id ? <CurrentMark /> : null}
          </button>
        ))}
        <button type="button" className={actionRow} onClick={() => onPick(null)}>
          <ActionIcon icon={Layers} />
          <RowText title={`${UNSORTED_SET_NAME} (no set)`} />
          {currentSetId === null ? <CurrentMark /> : null}
        </button>
      </ChoiceList>
      {canCreateSet ? (
        <div className={actionCard}>
          <button type="button" className={cn(actionRow, "text-[color:var(--clinical-accent)]")} onClick={onNewSet}>
            <ActionIcon icon={FolderPlus} />
            <RowText title="New set" />
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}

/** Create or rename a set: type a name, or tap one of the suggested names still free. */
export function FavouriteSetNameSheet({
  mode,
  open,
  currentName,
  existingNames,
  suggestedNames,
  movingCount,
  onClose,
  onChoose,
  returnFocusTarget,
}: {
  mode: "create" | "rename";
  open: boolean;
  returnFocusTarget?: () => HTMLElement | null;
  /** The set's name today, when renaming. */
  currentName?: string;
  /** Every set name the account already uses, for the duplicate check. */
  existingNames: readonly string[];
  /** Suggested names not yet in use. */
  suggestedNames: readonly FavouriteSetName[];
  /** Favourites that will move into a newly created set. */
  movingCount: number;
  onClose: () => void;
  onChoose: (name: FavouriteSetName) => void;
}) {
  const [draft, setDraft] = useState(currentName ?? "");
  const [error, setError] = useState<string | undefined>(undefined);

  function submit(value: string) {
    const check = checkFavouriteSetName(value);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const taken = existingNames.some((name) => name.toLowerCase() === check.name.toLowerCase() && name !== currentName);
    if (taken) {
      setError(`You already have a set called ${check.name}.`);
      return;
    }
    if (check.name === currentName) {
      onClose();
      return;
    }
    onChoose(check.name);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "create" ? "New set" : "Rename set"}
      description={setNamesNote}
      closeLabel={mode === "create" ? "Close new set" : "Close rename"}
      resolveReturnFocusTarget={returnFocusTarget}
      bodyClassName="p-3 pb-5"
    >
      <form
        className="grid gap-3 px-2 pt-1"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <TextField
          label="Set name"
          value={draft}
          maxLength={favouriteSetNameMaxLength}
          autoComplete="off"
          enterKeyHint="done"
          hint={`Up to ${favouriteSetNameMaxLength} characters.`}
          error={error}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(undefined);
          }}
        />
        <Button type="submit" variant="primary" block>
          {mode === "create" ? "Create set" : "Save name"}
        </Button>
      </form>
      {suggestedNames.length > 0 ? (
        <>
          <p className="px-2 pt-4 pb-1.5 text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
            Suggestions
          </p>
          <ChoiceList>
            {suggestedNames.map((name) => (
              <button key={name} type="button" className={actionRow} onClick={() => submit(name)}>
                <ActionIcon icon={Folder} />
                <RowText title={name} />
              </button>
            ))}
          </ChoiceList>
        </>
      ) : null}
      {mode === "create" && movingCount > 0 ? (
        <p className="px-2 pt-2 text-sm text-[color:var(--text-muted)]">
          {movingCount === 1 ? "The favourite will move" : `${movingCount} favourites will move`} into the new set.
        </p>
      ) : null}
    </Sheet>
  );
}

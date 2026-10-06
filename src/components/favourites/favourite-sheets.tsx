"use client";

import Link from "next/link";
import { Check, Copy, ExternalLink, Folder, FolderPlus, Pin, PinOff, Trash2, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { FavouriteTypeTile } from "@/components/favourites/favourite-type-tile";
import { isSourceBacked, UNSORTED_SET_NAME, type FavouriteItem } from "@/components/favourites/favourites-view-model";
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

const actionRow = cn(
  "flex min-h-tap w-full items-center gap-3.5 rounded-lg px-2 text-left text-base-minus font-medium text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)]",
  focusRing,
);

function ActionIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon className={cn("size-icon-lg shrink-0 text-[color:var(--text-muted)]", className)} aria-hidden="true" />;
}

const setNamesNote = "Name sets by workflow, never by patient. Set names are saved to your account.";

/** Open, pin, copy, move and remove for one favourite. */
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
  returnFocusTarget,
}: {
  item: FavouriteItem;
  open: boolean;
  onClose: () => void;
  /** The control focus goes back to when the sheet closes, such as the row's actions button. */
  returnFocusTarget?: () => HTMLElement | null;
  /** Saved account items can be moved and removed; examples cannot. Anything can be pinned. */
  canMutate: boolean;
  onOpen: (item: FavouriteItem) => void;
  onTogglePin: (item: FavouriteItem) => void;
  onCopyCitation: (item: FavouriteItem) => Promise<boolean>;
  onMove: (item: FavouriteItem) => void;
  onRemove: (item: FavouriteItem) => void;
}) {
  const nameId = useId();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const actionLabel = item.action === "Copy" ? "Open" : item.action;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item.title}
      labelledBy={nameId}
      headerLeading={<FavouriteTypeTile item={item} size="lg" />}
      description={[item.type, item.set, isSourceBacked(item) ? "Source-backed" : ""].filter(Boolean).join(" · ")}
      closeLabel="Close actions"
      resolveReturnFocusTarget={returnFocusTarget}
      testId="favourite-actions-sheet"
      bodyClassName="p-2 sm:p-3"
    >
      <span id={nameId} className="sr-only">
        Actions for {item.title}
      </span>
      <div className="grid gap-0.5">
        <Link
          href={item.href}
          aria-label={`${actionLabel} ${item.title}`}
          onClick={() => {
            onOpen(item);
            onClose();
          }}
          className={cn(actionRow, "font-semibold text-[color:var(--clinical-accent)]")}
        >
          <ActionIcon icon={ExternalLink} className="text-[color:var(--clinical-accent)]" />
          {actionLabel}
        </Link>
        {/* Pinning works for every item: saved ones on the account, others in this browser. */}
        <button
          type="button"
          className={actionRow}
          onClick={() => {
            onTogglePin(item);
            onClose();
          }}
        >
          <ActionIcon icon={item.pinned ? PinOff : Pin} />
          {item.pinned ? "Remove from quick launch" : "Add to quick launch"}
        </button>
        <button
          type="button"
          className={actionRow}
          onClick={async () => {
            const copied = await onCopyCitation(item);
            setCopyStatus(copied ? "copied" : "failed");
          }}
        >
          <ActionIcon icon={copyStatus === "copied" ? Check : Copy} />
          {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy citation"}
        </button>
        {canMutate ? (
          <>
            <button type="button" className={actionRow} onClick={() => onMove(item)}>
              <ActionIcon icon={Folder} />
              Move to set
              <span className="ml-auto truncate pl-2 text-sm text-[color:var(--text-muted)]">{item.set}</span>
            </button>
            <button
              type="button"
              className={cn(actionRow, "text-[color:var(--danger)] hover:bg-[color:var(--danger-soft)]")}
              onClick={() => {
                onRemove(item);
                onClose();
              }}
            >
              <ActionIcon icon={Trash2} className="text-[color:var(--danger)]" />
              Remove from favourites
            </button>
          </>
        ) : (
          <p className="px-2 pb-2 pt-1 text-sm text-[color:var(--text-muted)]">
            This is an example. Save your own favourites to move them into sets or remove them.
          </p>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {copyStatus === "copied"
            ? `${item.title} citation copied`
            : copyStatus === "failed"
              ? "Unable to copy citation"
              : ""}
        </span>
      </div>
    </Sheet>
  );
}

function ChoiceList({ children }: { children: ReactNode }) {
  return <div className="grid gap-0.5">{children}</div>;
}

/** Choose the set for one or more favourites. */
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
  const title = single ? `Move ${single.title}` : `Move ${items.length} favourites`;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      closeLabel="Close move"
      resolveReturnFocusTarget={returnFocusTarget}
      bodyClassName="p-2 sm:p-3"
    >
      <ChoiceList>
        {sets.map((set) => (
          <button key={set.id} type="button" className={actionRow} onClick={() => onPick(set.id)}>
            <ActionIcon icon={Folder} />
            {set.name}
            {currentSetId === set.id ? (
              <>
                <Check className="ml-auto size-icon-md text-[color:var(--clinical-accent)]" aria-hidden="true" />
                <span className="sr-only">(current set)</span>
              </>
            ) : null}
          </button>
        ))}
        <button type="button" className={actionRow} onClick={() => onPick(null)}>
          <ActionIcon icon={Folder} className="text-[color:var(--decoration-soft)]" />
          {UNSORTED_SET_NAME} (no set)
          {currentSetId === null ? (
            <>
              <Check className="ml-auto size-icon-md text-[color:var(--clinical-accent)]" aria-hidden="true" />
              <span className="sr-only">(current set)</span>
            </>
          ) : null}
        </button>
        {canCreateSet ? (
          <button
            type="button"
            className={cn(actionRow, "font-semibold text-[color:var(--clinical-accent)]")}
            onClick={onNewSet}
          >
            <ActionIcon icon={FolderPlus} className="text-[color:var(--clinical-accent)]" />
            New set
          </button>
        ) : null}
      </ChoiceList>
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
      bodyClassName="p-2 sm:p-3"
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
          <p className="px-2 pt-4 pb-1 text-sm font-semibold text-[color:var(--text-muted)]">Suggestions</p>
          <ChoiceList>
            {suggestedNames.map((name) => (
              <button key={name} type="button" className={actionRow} onClick={() => submit(name)}>
                <ActionIcon icon={Folder} />
                {name}
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

"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Globe2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import type {
  ModeActionId,
  ModeActionItem,
  ModeActionModeOption,
} from "@/components/clinical-dashboard/mode-action-popup";
import { SectionHeading } from "@/components/ui/section-heading";
import { controlDisabled, cn } from "@/components/ui-primitives";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { appModeIcons } from "@/lib/app-mode-icons";
import {
  maximumSearchPins,
  normalizeSearchPins,
  readSearchPins,
  searchPinDestinationIds,
  searchPinsChangeEvent,
  searchPinsStorageKey,
  writeSearchPins,
  type SearchPin,
  type SearchPinDestinationId,
} from "@/lib/search-pins";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const destinationLabels: Record<SearchPinDestinationId, string> = {
  documents: "Documents",
  prescribing: "Medications",
  forms: "Forms",
  services: "Services",
  differentials: "Differentials",
  tools: "Clinical tools",
};

const destinationTone: Record<SearchPinDestinationId, string> = {
  documents:
    "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  prescribing:
    "border-[color:var(--tone-slate-border)] bg-[color:var(--tone-slate-soft)] text-[color:var(--tone-slate)]",
  forms: "border-[color:var(--tone-purple-border)] bg-[color:var(--tone-purple-soft)] text-[color:var(--tone-purple)]",
  services:
    "border-[color:var(--tone-indigo-border)] bg-[color:var(--tone-indigo-soft)] text-[color:var(--tone-indigo)]",
  differentials:
    "border-[color:var(--tone-rose-border)] bg-[color:var(--tone-rose-soft)] text-[color:var(--tone-rose)]",
  tools: "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
};

function PinIcons({ pin }: { pin: SearchPin }) {
  const shown = pin.destinationIds.slice(0, 3);
  const labels = pin.destinationIds.map((id) => destinationLabels[id]).join(", ");
  return (
    <span className="inline-flex shrink-0 items-center" role="img" aria-label={`${pin.name} contains ${labels}`}>
      {shown.map((id, index) => {
        const Icon = appModeIcons[id];
        return (
          <span
            key={id}
            aria-hidden="true"
            className={cn(
              "grid h-7 w-7 place-items-center rounded-full border-2 border-[color:var(--surface)] shadow-sm",
              index > 0 && "-ml-1.5",
              destinationTone[id],
            )}
            style={{ zIndex: shown.length - index }}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
        );
      })}
      {pin.destinationIds.length > shown.length ? (
        <span
          aria-hidden="true"
          className="-ml-1 inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-[color:var(--surface)] bg-[color:var(--surface-subtle)] px-1 text-3xs font-extrabold text-[color:var(--text-muted)] shadow-sm"
        >
          +{pin.destinationIds.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}

type EditorState = { pinId: string | null; name: string; destinationIds: SearchPinDestinationId[] };

let pinIdFallbackCounter = 0;

function createPinId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  pinIdFallbackCounter += 1;
  return `pin-${Date.now().toString(36)}-${pinIdFallbackCounter.toString(36)}`;
}

export function SearchPinsMenu({
  currentModeId,
  modeOptions,
  actions,
  globalSearchAvailable = true,
  onClose,
  onCurrentSearch,
  onGlobalSearch,
  onModeSelect,
  onAction,
}: {
  currentModeId: AppModeId;
  modeOptions: readonly ModeActionModeOption[];
  actions: readonly ModeActionItem[];
  globalSearchAvailable?: boolean;
  onClose: () => void;
  onCurrentSearch: () => void;
  onGlobalSearch: () => void;
  onModeSelect: (modeId: string) => void;
  onAction: (actionId: ModeActionId) => void;
}) {
  const [pins, setPins] = useState<SearchPin[]>(() => readSearchPins());
  const [expandedPinId, setExpandedPinId] = useState<string | null>(null);
  const [showModePicker, setShowModePicker] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const editorDescriptionId = useId();
  const editorNoticeId = useId();
  const currentMode = appModeDefinition(currentModeId);
  const CurrentModeIcon = appModeIcons[currentModeId];
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLElement | null>(null);

  function focusActionItem(index: number) {
    if (!actions.length) return;
    const nextIndex = (index + actions.length) % actions.length;
    actionRefs.current[nextIndex]?.focus();
  }

  function handleActionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focusActionItem(index + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusActionItem(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusActionItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusActionItem(actions.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  useEffect(() => {
    const syncStoredPins = (event: StorageEvent) => {
      if (event.key === null || event.key === searchPinsStorageKey) setPins(readSearchPins());
    };
    const syncPins = (event: Event) => {
      // CustomEvent without an init object exposes detail === null, not undefined.
      // Treat both as "re-read storage" so a bare change signal cannot resurrect defaults.
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      setPins(detail == null ? readSearchPins() : normalizeSearchPins(detail));
    };
    window.addEventListener("storage", syncStoredPins);
    window.addEventListener(searchPinsChangeEvent, syncPins);
    return () => {
      window.removeEventListener("storage", syncStoredPins);
      window.removeEventListener(searchPinsChangeEvent, syncPins);
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setConfirmDelete(false);
      setEditorNotice(null);
      setEditor(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  useEffect(() => {
    if (!editor && triggerRef.current) {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      if (trigger.isConnected) {
        trigger.focus();
      } else {
        const label = trigger.getAttribute("aria-label");
        const text = trigger.textContent?.trim();
        let restored = false;
        if (label) {
          try {
            const el = document.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(label)}"]`);
            if (el) {
              el.focus();
              restored = true;
            }
          } catch {
            // CSS.escape fallback
          }
        }
        if (!restored && text) {
          const buttons = Array.from(document.querySelectorAll<HTMLElement>("button"));
          const match = buttons.find((b) => b.textContent?.trim() === text);
          if (match) {
            match.focus();
            restored = true;
          }
        }
        if (!restored && actionRefs.current[0]?.isConnected) {
          actionRefs.current[0].focus();
        }
      }
    }
  }, [editor]);

  useEffect(() => {
    if (!showModePicker) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setShowModePicker(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [showModePicker]);

  function persistPins(next: SearchPin[]) {
    const normalized = writeSearchPins(next);
    setPins(normalized);
    window.dispatchEvent(new CustomEvent(searchPinsChangeEvent, { detail: normalized }));
  }

  function beginNewPin() {
    if (pins.length >= maximumSearchPins) return;
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    setExpandedPinId(null);
    setShowModePicker(false);
    setConfirmDelete(false);
    setEditorNotice(null);
    setEditor({ pinId: null, name: "", destinationIds: ["documents"] });
  }

  function beginEditPin(pin: SearchPin) {
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    setExpandedPinId(null);
    setShowModePicker(false);
    setConfirmDelete(false);
    setEditorNotice(null);
    setEditor({ pinId: pin.id, name: pin.name, destinationIds: [...pin.destinationIds] });
  }

  function toggleEditorDestination(destinationId: SearchPinDestinationId) {
    if (!editor) return;
    const selected = editor.destinationIds.includes(destinationId);
    if (selected && editor.destinationIds.length === 1) return;
    setEditor({
      ...editor,
      destinationIds: selected
        ? editor.destinationIds.filter((id) => id !== destinationId)
        : [...editor.destinationIds, destinationId],
    });
  }

  function saveEditor() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) return;
    if (editor.pinId) {
      if (!pins.some((pin) => pin.id === editor.pinId)) {
        setEditorNotice("This pin was removed elsewhere. Close the editor and create it again if needed.");
        return;
      }
      persistPins(
        pins.map((pin) => (pin.id === editor.pinId ? { ...pin, name, destinationIds: editor.destinationIds } : pin)),
      );
      setExpandedPinId(editor.pinId);
    } else {
      if (pins.length >= maximumSearchPins) {
        setEditorNotice(`Maximum ${maximumSearchPins} pins reached. Delete a pin before creating another.`);
        return;
      }
      const pin = { id: createPinId(), name, destinationIds: editor.destinationIds };
      persistPins([...pins, pin]);
      setExpandedPinId(pin.id);
    }
    setConfirmDelete(false);
    setEditorNotice(null);
    setEditor(null);
  }

  function deleteEditorPin() {
    if (!editor?.pinId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    persistPins(pins.filter((pin) => pin.id !== editor.pinId));
    setConfirmDelete(false);
    setEditorNotice(null);
    setEditor(null);
  }

  if (editor) {
    return (
      <div className="mode-action-body polished-scroll p-3" aria-describedby={editorDescriptionId}>
        <div className="mb-3 flex items-start justify-between gap-3 px-1">
          <div>
            <h3 className="text-sm font-extrabold text-[color:var(--text-heading)]">
              {editor.pinId ? "Edit pin" : "Create a new pin"}
            </h3>
            <p id={editorDescriptionId} className="mt-0.5 text-xs leading-5 text-[color:var(--text-muted)]">
              Name this shortcut and choose the app destinations it should contain.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(false);
              setEditorNotice(null);
              setEditor(null);
            }}
            className={cn("min-h-12 min-w-12 rounded-xl", focusRing)}
            aria-label="Close pin editor"
          >
            <X aria-hidden="true" className="mx-auto h-4 w-4" />
          </button>
        </div>

        <label className="block text-xs font-bold text-[color:var(--text-muted)]">
          Pin name
          <input
            autoFocus
            value={editor.name}
            maxLength={48}
            onChange={(event) => setEditor({ ...editor, name: event.target.value })}
            className={cn(
              "mt-1.5 h-12 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-base font-semibold text-[color:var(--text-heading)]",
              focusRing,
            )}
          />
        </label>

        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-bold text-[color:var(--text-muted)]">App destinations</legend>
          <div className="grid gap-1.5">
            {searchPinDestinationIds.map((destinationId) => {
              const Icon = appModeIcons[destinationId];
              const selected = editor.destinationIds.includes(destinationId);
              return (
                <button
                  key={destinationId}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleEditorDestination(destinationId)}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left transition motion-reduce:transition-none",
                    selected
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]/55"
                      : "border-transparent hover:bg-[color:var(--surface-subtle)]",
                    focusRing,
                  )}
                >
                  <span
                    className={cn("grid h-8 w-8 place-items-center rounded-lg border", destinationTone[destinationId])}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="flex-1 text-sm font-bold text-[color:var(--text-heading)]">
                    {destinationLabels[destinationId]}
                  </span>
                  <span
                    className={cn(
                      "grid h-6 w-6 place-items-center rounded-full border",
                      selected
                        ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                        : "border-[color:var(--border)] text-transparent",
                    )}
                  >
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {editorNotice ? (
          <p id={editorNoticeId} role="status" className="mt-3 text-xs font-semibold text-[color:var(--danger)]">
            {editorNotice}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2 border-t border-[color:var(--border)] pt-3">
          {editor.pinId ? (
            <button
              type="button"
              onClick={deleteEditorPin}
              className={cn(
                "inline-flex min-h-12 items-center gap-2 rounded-xl border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 text-sm font-bold text-[color:var(--danger)] hover:bg-[color:var(--danger-soft)]",
                focusRing,
              )}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              {confirmDelete ? "Confirm delete" : "Delete"}
            </button>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(false);
              setEditorNotice(null);
              setEditor(null);
            }}
            className={cn(
              "min-h-12 rounded-xl px-4 text-sm font-bold hover:bg-[color:var(--surface-subtle)]",
              focusRing,
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveEditor}
            disabled={!editor.name.trim()}
            aria-describedby={editorNotice ? editorNoticeId : undefined}
            className={cn(
              controlDisabled,
              "min-h-12 rounded-xl bg-[color:var(--clinical-accent)] px-4 text-sm font-extrabold text-[color:var(--clinical-accent-contrast)] disabled:cursor-not-allowed",
              focusRing,
            )}
          >
            {editor.pinId ? "Save pin" : "Create pin"}
          </button>
        </div>
      </div>
    );
  }

  if (showModePicker) {
    return (
      <div className="mode-action-body polished-scroll p-2.5">
        <div className="mb-1 flex items-center gap-2 px-1">
          <button
            type="button"
            onClick={() => setShowModePicker(false)}
            className={cn(
              "min-h-12 rounded-xl px-3 text-sm font-bold hover:bg-[color:var(--surface-subtle)]",
              focusRing,
            )}
          >
            Back
          </button>
          <div>
            <h3 className="text-sm font-extrabold text-[color:var(--text-heading)]">Choose a search area</h3>
            <p className="text-xs text-[color:var(--text-muted)]">Your query stays in the composer.</p>
          </div>
        </div>
        <div className="grid gap-1.5">
          {modeOptions.map((mode) => {
            const Icon = mode.icon;
            const active = mode.id === currentModeId;
            return (
              <button
                key={mode.id}
                type="button"
                disabled={mode.disabled}
                onClick={() => onModeSelect(mode.id)}
                className={cn(
                  controlDisabled,
                  "group flex min-h-12 items-center gap-3 rounded-xl px-3 text-left hover:bg-[color:var(--surface-subtle)]",
                  active && "bg-[color:var(--clinical-accent-soft)]/55",
                  focusRing,
                )}
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--clinical-accent)] group-disabled:text-[color:var(--disabled)]">
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-[color:var(--text-heading)] group-disabled:text-[color:var(--disabled)]">
                    {mode.label}
                  </span>
                  {mode.description ? (
                    <span className="block truncate text-xs text-[color:var(--text-muted)] group-disabled:text-[color:var(--disabled)]">
                      {mode.description}
                    </span>
                  ) : null}
                </span>
                {active ? (
                  <Check
                    aria-hidden="true"
                    className="h-4 w-4 text-[color:var(--clinical-accent)] group-disabled:text-[color:var(--disabled)]"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mode-action-body polished-scroll p-2.5" data-testid="pins-and-search-menu">
      <SectionHeading
        variant="menu-kicker"
        headingLevel={3}
        action={
          <button
            type="button"
            onClick={beginNewPin}
            disabled={pins.length >= maximumSearchPins}
            title={pins.length >= maximumSearchPins ? `Maximum ${maximumSearchPins} pins reached` : undefined}
            className={cn(
              controlDisabled,
              "inline-flex min-h-12 items-center gap-1 rounded-lg px-2 text-xs font-extrabold text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)] disabled:cursor-not-allowed",
              focusRing,
            )}
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            New pin
          </button>
        }
      >
        Your pins
      </SectionHeading>

      <div className="grid gap-1">
        {pins.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[color:var(--border)] px-3 py-4 text-center text-xs leading-5 text-[color:var(--text-muted)]">
            No pins yet. Create one for the app destinations you use together.
          </p>
        ) : null}
        {pins.map((pin) => {
          const expanded = expandedPinId === pin.id;
          return (
            <div
              key={pin.id}
              className={cn(
                "rounded-xl",
                expanded ? "bg-[color:var(--clinical-accent-soft)]/45" : "hover:bg-[color:var(--surface-subtle)]",
              )}
            >
              <div className="flex min-h-14 items-center">
                <button
                  type="button"
                  data-sheet-autofocus={pin === pins[0] ? "true" : undefined}
                  aria-label={`${expanded ? "Close" : "Open"} ${pin.name} pin, ${pin.destinationIds.length} destinations`}
                  aria-expanded={expanded}
                  onClick={() => setExpandedPinId(expanded ? null : pin.id)}
                  className={cn(
                    "flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 text-left",
                    focusRing,
                  )}
                >
                  <PinIcons pin={pin} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-[color:var(--text-heading)]">
                      {pin.name}
                    </span>
                    <span className="block truncate text-xs text-[color:var(--text-muted)]">
                      {pin.destinationIds.length} destinations
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4 shrink-0 transition motion-reduce:transition-none",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => beginEditPin(pin)}
                  aria-label={`Edit ${pin.name}`}
                  className={cn(
                    "mr-1 grid min-h-12 min-w-12 place-items-center rounded-xl text-[color:var(--text-muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--clinical-accent)]",
                    focusRing,
                  )}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              {expanded ? (
                <div className="grid gap-1 px-2 pb-2 sm:grid-cols-2">
                  {pin.destinationIds.map((destinationId) => {
                    const Icon = appModeIcons[destinationId];
                    return (
                      <Link
                        key={destinationId}
                        href={appModeHomeHref(destinationId)}
                        onClick={onClose}
                        className={cn(
                          "flex min-h-12 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-bold text-[color:var(--text-heading)] hover:border-[color:var(--clinical-accent-border)]",
                          focusRing,
                        )}
                      >
                        <Icon aria-hidden="true" className="h-4 w-4 text-[color:var(--clinical-accent)]" />
                        <span className="truncate">{destinationLabels[destinationId]}</span>
                        <ChevronRight
                          aria-hidden="true"
                          className="ml-auto h-3.5 w-3.5 text-[color:var(--text-muted)]"
                        />
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="my-2 border-t border-[color:var(--border)] pt-2">
        <SectionHeading variant="menu-kicker" headingLevel={3}>
          Search in
        </SectionHeading>
        <button
          type="button"
          onClick={onCurrentSearch}
          className={cn(
            "flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 text-left hover:bg-[color:var(--surface-subtle)]",
            focusRing,
          )}
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
            <CurrentModeIcon aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-extrabold text-[color:var(--text-heading)]">
              Search {currentMode.label}
            </span>
            <span className="block text-xs text-[color:var(--text-muted)]">Current search area</span>
          </span>
          <Check aria-hidden="true" className="h-4 w-4 text-[color:var(--clinical-accent)]" />
        </button>
        {globalSearchAvailable ? (
          <button
            type="button"
            onClick={onGlobalSearch}
            className={cn(
              "flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 text-left hover:bg-[color:var(--surface-subtle)]",
              focusRing,
            )}
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--clinical-accent)]">
              <Globe2 aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">
                Search all clinical areas
              </span>
              <span className="block text-xs text-[color:var(--text-muted)]">
                Open universal results for this query
              </span>
            </span>
            <Search aria-hidden="true" className="h-4 w-4 text-[color:var(--text-muted)]" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowModePicker(true)}
          className={cn(
            "flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 text-left hover:bg-[color:var(--surface-subtle)]",
            focusRing,
          )}
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--clinical-accent)]">
            <Plus aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">
              Choose another search area
            </span>
            <span className="block text-xs text-[color:var(--text-muted)]">
              Keep the query and change mode explicitly
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 text-[color:var(--text-muted)]" />
        </button>
      </div>

      <div className="border-t border-[color:var(--border)] pt-2">
        <SectionHeading variant="menu-kicker" headingLevel={3}>
          Useful actions
        </SectionHeading>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Useful actions">
          {actions.map((action, index) => {
            const Icon: LucideIcon = action.icon;
            return (
              <button
                key={action.id}
                ref={(element) => {
                  actionRefs.current[index] = element;
                }}
                type="button"
                aria-label={action.label}
                onClick={() => onAction(action.id)}
                onKeyDown={(event) => handleActionKeyDown(event, index)}
                className={cn(
                  "flex min-h-12 items-center gap-2 rounded-xl px-2.5 text-left hover:bg-[color:var(--surface-subtle)]",
                  focusRing,
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" />
                <span
                  aria-hidden="true"
                  className="min-w-0 truncate text-xs font-extrabold text-[color:var(--text-heading)]"
                >
                  {action.shortLabel ?? action.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

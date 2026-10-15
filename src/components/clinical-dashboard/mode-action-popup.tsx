"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  BookOpenText,
  TriangleAlert,
  CalendarDays,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Filter,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  Heart,
  ListChecks,
  Lock,
  MessageSquarePlus,
  Network,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
  Table2,
  Waypoints,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { useDismissableLayer } from "@/components/use-dismissable-layer";
import { Sheet } from "@/components/ui/sheet";
import { cn, chatComposerIconButton, glassOverlaySurface, toolbarButton } from "@/components/ui-primitives";

export type ModeActionSetId =
  | "answer"
  | "documents"
  | "services"
  | "forms"
  | "favourites"
  | "tools"
  | "calculators"
  | "differentials"
  | "dsm"
  | "specifiers"
  | "formulation"
  | "prescribing"
  | "factsheets"
  | "dictionary";
export type ModeActionPlacement = "up" | "down";

const actionSurfaceId = "daily-actions-sheet";
const customBodyFocusScopeId = "daily-actions-sheet-body";

type IntegratedSurfaceLayout = {
  placement: ModeActionPlacement;
  left: number;
  width: number;
  caretLeft: number;
  top?: number;
  bottom?: number;
};

// The menu is a single-column vertical list; heights estimate one row per item so
// the anchored popover can pick an up/down placement and a scroll cap that fit.
function estimateActionListHeights(itemCount: number, integrated: boolean) {
  const rowHeight = 60;
  const rowGap = 6;
  const bodyPadding = integrated ? 24 : 20;
  const minBodyHeight = itemCount * rowHeight + Math.max(0, itemCount - 1) * rowGap + bodyPadding;
  const headerHeight = 76;
  return { minBodyHeight, minSurfaceHeight: minBodyHeight + headerHeight, headerHeight };
}

export type ModeActionModeOption = {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export type ModeActionId =
  | "answer-quotes"
  | "answer-evidence-map"
  | "answer-new"
  | "documents-search"
  | "documents-admin"
  | "documents-scope"
  | "documents-recent"
  | "documents-tables"
  | "documents-status"
  | "documents-collections"
  | "documents-viewer"
  | "services-search"
  | "services-pathways"
  | "services-records"
  | "services-documents"
  | "forms-records"
  | "forms-documents"
  | "favourites-browse"
  | "favourites-sets"
  | "medication-dose"
  | "medication-safety"
  | "medication-monitoring"
  | "medication-escalation"
  | "medication-access"
  | "tools-browse"
  | "tools-new"
  | "calculators-browse"
  | "differentials-build"
  | "differentials-criteria"
  | "differentials-documents"
  | "differentials-evidence"
  | "dsm-search"
  | "dsm-compare"
  | "dsm-criteria"
  | "specifiers-search"
  | "specifiers-builder"
  | "specifiers-compare"
  | "specifiers-map"
  | "formulation-search"
  | "formulation-builder"
  | "formulation-compare"
  | "formulation-map"
  | "factsheets-search"
  | "factsheets-browse"
  | "dictionary-search"
  | "dictionary-topics"
  | "dictionary-compare"
  | "dictionary-sources";

export type ModeActionItem = {
  id: ModeActionId;
  label: string;
  shortLabel?: string;
  description?: string;
  icon: LucideIcon;
  primary?: boolean;
  /**
   * Administrator-only row. Hidden unless the caller passes `canManageDocuments`,
   * because `modeActionItemsFor` filters it out by default — a caller that forgets
   * the flag under-shows rather than leaking an admin affordance to a clinician.
   */
  adminOnly?: boolean;
};

// One curated, primary-first action list per mode. Keep the accessible name of each
// item (its `label`) test-stable: Answer must expose "Scope"; Documents "Browse library".
const modeActionSets = {
  answer: [
    {
      id: "answer-new",
      label: "New question",
      description: "Clear the current thread",
      icon: MessageSquarePlus,
      primary: true,
    },
    { id: "documents-scope", label: "Scope", description: "Limit answers to chosen sources", icon: Filter },
    {
      id: "answer-evidence-map",
      label: "View evidence",
      description: "Trace quotes and source support",
      icon: ListChecks,
    },
    { id: "documents-search", label: "Search sources", description: "Find indexed sources", icon: Search },
    { id: "tools-browse", label: "Clinical tools", description: "Open clinical tools", icon: Wrench },
  ],
  documents: [
    {
      id: "documents-collections",
      label: "Browse library",
      description: "All indexed sources",
      icon: FolderOpen,
      primary: true,
    },
    { id: "documents-scope", label: "Scope sources", description: "Limit answers to selected sources", icon: Filter },
    {
      id: "documents-admin",
      label: "Manage library",
      description: "Indexing, jobs and setup",
      icon: Wrench,
      adminOnly: true,
    },
    { id: "documents-recent", label: "Recent documents", description: "Browse recently updated", icon: Clock3 },
    { id: "documents-tables", label: "Tables", description: "Search table evidence", icon: Table2 },
    { id: "documents-viewer", label: "Open source PDF", description: "View a source document", icon: FileText },
  ],
  services: [
    {
      id: "services-records",
      label: "Browse directory",
      description: "Verified service records",
      icon: ShieldCheck,
      primary: true,
    },
    { id: "services-pathways", label: "Referral pathways", description: "Find referral pathways", icon: ListChecks },
    { id: "services-documents", label: "Find in documents", description: "Search supporting guidance", icon: FileText },
  ],
  forms: [
    {
      id: "forms-records",
      label: "Browse form library",
      description: "Open clinical forms",
      icon: FolderOpen,
      primary: true,
    },
    { id: "forms-documents", label: "Find in documents", description: "Search supporting guidance", icon: FileText },
  ],
  favourites: [
    {
      id: "favourites-browse",
      label: "Browse favourites",
      description: "Open saved clinical items",
      icon: Heart,
      primary: true,
    },
    { id: "favourites-sets", label: "Saved sets", description: "Review grouped favourites", icon: FolderOpen },
  ],
  tools: [
    {
      id: "tools-browse",
      label: "Browse tools",
      description: "Open the applications registry",
      icon: Wrench,
      primary: true,
    },
    { id: "tools-new", label: "New answer", description: "Clear the current thread", icon: Sparkles },
  ],
  calculators: [
    {
      id: "calculators-browse",
      label: "Browse calculators",
      description: "Open the calculator catalogue",
      icon: Calculator,
      primary: true,
    },
  ],
  differentials: [
    {
      id: "differentials-build",
      label: "Build differential",
      description: "Start a structured differential",
      icon: GitBranch,
      primary: true,
    },
    {
      id: "differentials-criteria",
      label: "Compare criteria",
      description: "Review distinguishing features",
      icon: ListChecks,
    },
    {
      id: "differentials-documents",
      label: "Supporting documents",
      description: "Search supporting documents",
      icon: FileText,
    },
    { id: "differentials-evidence", label: "View evidence", description: "Review cited support", icon: ShieldCheck },
  ],
  dsm: [
    {
      id: "dsm-search",
      label: "Search diagnoses",
      description: "Find criteria and ICD codes",
      icon: Search,
      primary: true,
    },
    {
      id: "dsm-compare",
      label: "Compare diagnoses",
      description: "Review distinctions side by side",
      icon: GitBranch,
    },
    {
      id: "dsm-criteria",
      label: "Review criteria",
      description: "Open core diagnostic criteria",
      icon: ListChecks,
    },
  ],
  specifiers: [
    {
      id: "specifiers-search",
      label: "Find a specifier",
      description: "Match presentation features",
      icon: Tags,
      primary: true,
    },
    {
      id: "specifiers-builder",
      label: "Build wording",
      description: "Assemble diagnostic wording",
      icon: ListChecks,
    },
    {
      id: "specifiers-compare",
      label: "Compare specifiers",
      description: "Clarify close clinical calls",
      icon: GitCompareArrows,
    },
    { id: "specifiers-map", label: "Specifier map", description: "Browse by diagnostic role", icon: Waypoints },
  ],
  formulation: [
    {
      id: "formulation-search",
      label: "Find a mechanism",
      description: "Match clinical clues and patient language",
      icon: Network,
      primary: true,
    },
    {
      id: "formulation-builder",
      label: "Build formulation",
      description: "Structure and review a working draft",
      icon: ListChecks,
    },
    {
      id: "formulation-compare",
      label: "Compare mechanisms",
      description: "Test alternative hypotheses",
      icon: GitCompareArrows,
    },
    { id: "formulation-map", label: "Mechanism map", description: "Browse by formulation domain", icon: Waypoints },
  ],
  prescribing: [
    {
      id: "medication-dose",
      label: "Dose & thresholds",
      description: "Check dosing and thresholds",
      icon: CalendarDays,
      primary: true,
    },
    {
      id: "medication-safety",
      label: "Contraindications",
      description: "Cautions and interactions",
      icon: ShieldCheck,
    },
    { id: "medication-monitoring", label: "Monitoring", description: "Baseline and ongoing checks", icon: Activity },
    {
      id: "medication-escalation",
      label: "Escalation criteria",
      description: "Red flags and urgent review",
      icon: TriangleAlert,
    },
    { id: "medication-access", label: "Documentation", description: "Required forms and eligibility", icon: Lock },
  ],
  factsheets: [
    {
      id: "factsheets-search",
      label: "Search factsheets",
      description: "Find a medicine, condition, therapy, or test",
      icon: Search,
      primary: true,
    },
    {
      id: "factsheets-browse",
      label: "Browse all sheets",
      description: "Open the full patient-information library",
      icon: BookOpenText,
    },
  ],
  dictionary: [
    {
      id: "dictionary-search",
      // Search and Browse were one catalogue behind two destinations, so the
      // pair collapsed to one action naming the content rather than the verb.
      label: "Terms",
      description: "Search or browse the governed catalogue",
      icon: Search,
      primary: true,
    },
    {
      id: "dictionary-topics",
      label: "Browse topics",
      description: "Open clinical collections",
      icon: Tags,
    },
    {
      id: "dictionary-compare",
      label: "Compare terms",
      description: "Align stored fields",
      icon: GitCompareArrows,
    },
    {
      id: "dictionary-sources",
      label: "Sources and review",
      description: "See governance and coverage",
      icon: ShieldCheck,
    },
  ],
} as const satisfies Record<ModeActionSetId, readonly ModeActionItem[]>;

/**
 * The rows for a mode, with administrator-only rows filtered out unless the caller
 * says the viewer can manage documents.
 *
 * The admin row exists because the indexing drawer is otherwise unreachable from a
 * cold load: every `setIndexingAdminDrawerOpen(true)` call lives inside
 * `openLibraryHealthTarget`, and both `LibraryHealthStrip` render sites are behind
 * the drawer already being open. Without an entry point here an administrator has
 * no first move to document management, setup, jobs or quality controls.
 *
 * The flag defaults to `false` so a caller that forgets it hides the row rather than
 * exposing an admin affordance to a clinician; `openLibraryHealthTarget` re-checks
 * `canUseAdministrativeApis` server-side of this anyway, so the filter is presentation,
 * never the authorization boundary.
 */
export function modeActionItemsFor(
  setId: ModeActionSetId,
  options?: { readonly canManageDocuments?: boolean },
): readonly ModeActionItem[] {
  // Annotated rather than inferred: `modeActionSets` is `as const`, so the inferred union
  // has `adminOnly` only on the arms that set it and the filter below would not typecheck.
  const items: readonly ModeActionItem[] = modeActionSets[setId];
  if (options?.canManageDocuments) return items;
  return items.filter((item) => !item.adminOnly);
}

function assignTriggerRef(ref: Ref<HTMLButtonElement> | undefined, element: HTMLButtonElement | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(element);
    return;
  }
  ref.current = element;
}

export function ModeActionPopup({
  open,
  title,
  titleIcon: TitleIcon,
  subtitle,
  buttonLabel,
  items,
  modeOptions,
  selectedModeId,
  onOpenChange,
  onBeforeOpen,
  onAction,
  onModeSelect,
  onPlacementChange,
  triggerClassName,
  integrated = false,
  integratedChipRow = true,
  useSheet = false,
  triggerRef,
  sheetReturnFocusRef,
  dismissIgnoreRefs,
  customBody,
}: {
  open: boolean;
  title: string;
  titleIcon: LucideIcon;
  subtitle?: string;
  buttonLabel: string;
  items: readonly ModeActionItem[];
  modeOptions?: readonly ModeActionModeOption[];
  selectedModeId?: string;
  onOpenChange: (open: boolean) => void;
  onBeforeOpen?: () => void;
  onAction: (actionId: ModeActionId) => void;
  onModeSelect?: (modeId: string) => void;
  onPlacementChange?: (placement: ModeActionPlacement) => void;
  triggerClassName?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  integrated?: boolean;
  /** When false, the integrated menu skips the footer chip-row clearance offset. */
  integratedChipRow?: boolean;
  /** Render the actions in a bottom sheet / centred dialog (phones + tablets ≤1023px)
   *  instead of the anchored desktop popover. */
  useSheet?: boolean;
  /** Optional dynamic focus target for Sheet closes that intentionally leave the menu. */
  sheetReturnFocusRef?: RefObject<HTMLElement | null>;
  /** Header-owned controls (e.g. app mode trigger) that must stay clickable above the portaled menu. */
  dismissIgnoreRefs?: readonly RefObject<HTMLElement | null>[];
  /** Optional richer body for the shared + surface. The popup continues to own
   *  positioning, dismissal, focus restoration, and responsive Sheet behavior. */
  customBody?: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const modeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const actionDescId = useId();
  const [placement, setPlacement] = useState<ModeActionPlacement>("up");
  const [surfaceMaxHeight, setSurfaceMaxHeight] = useState<number | null>(null);
  const [bodyMaxHeight, setBodyMaxHeight] = useState<number | null>(null);
  const [integratedSurfaceLayout, setIntegratedSurfaceLayout] = useState<IntegratedSurfaceLayout | null>(null);
  const [modeSelectorOpen, setModeSelectorOpen] = useState(false);
  const canSwitchMode = Boolean(modeOptions?.length && onModeSelect);
  const selectedModeOption = modeOptions?.find((mode) => mode.id === selectedModeId);
  // Truthiness only — callers pass inline JSX for customBody, so the element
  // identity must not invalidate placement measurement every parent render.
  const hasCustomBody = Boolean(customBody);

  const closeAndRestoreFocus = useCallback(() => {
    setModeSelectorOpen(false);
    onOpenChange(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, [onOpenChange, setModeSelectorOpen]);
  const resolveSheetReturnFocusTarget = useCallback(
    () => sheetReturnFocusRef?.current ?? buttonRef.current,
    [sheetReturnFocusRef],
  );

  // The sheet owns its own focus trap, Escape, and backdrop dismissal; only the
  // anchored popover needs the outside-click dismissable layer.
  useDismissableLayer({
    enabled: open && !useSheet,
    refs: [rootRef, surfaceRef, ...(dismissIgnoreRefs ?? [])],
    restoreFocusRef: buttonRef,
    onDismiss: () => {
      setModeSelectorOpen(false);
      onOpenChange(false);
    },
  });

  function focusActionItem(index: number) {
    if (customBody) {
      const body = document.getElementById(customBodyFocusScopeId);
      const focusable = body?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      focusable[index < 0 ? focusable.length - 1 : Math.min(index, focusable.length - 1)]?.focus();
      return;
    }
    const nextIndex = (index + items.length) % items.length;
    itemRefs.current[nextIndex]?.focus();
  }

  const updatePlacement = useCallback(() => {
    if (typeof window === "undefined") return;
    const anchor = buttonRef.current ?? rootRef.current?.parentElement ?? rootRef.current;
    if (!anchor) return;

    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;
    const rect = anchor.getBoundingClientRect();
    const edgePadding = 12;
    const availableAbove = Math.max(0, rect.top - viewportTop - edgePadding);
    const availableBelow = Math.max(0, viewportBottom - rect.bottom - edgePadding);
    // Custom bodies (pins + search) are substantially taller than one row per
    // mode action; size placement against a pin-panel floor so "fits above"
    // is not chosen from an unrelated action-count estimate.
    const estimatedItemCount = hasCustomBody ? Math.max(items.length, 10) : items.length;
    const { minSurfaceHeight, headerHeight } = estimateActionListHeights(estimatedItemCount, integrated);
    const detachedUpOffset = 16;
    const integratedDownOffset = integratedChipRow ? 58 : 14;
    const detachedDownOffset = integrated ? integratedDownOffset : 14;
    const spaceAbove = Math.max(0, availableAbove - detachedUpOffset);
    const spaceBelow = Math.max(0, availableBelow - detachedDownOffset);

    let nextPlacement: ModeActionPlacement;
    if (integrated) {
      const canFitAbove = spaceAbove >= minSurfaceHeight;
      const canFitBelow = spaceBelow >= minSurfaceHeight;
      if (canFitAbove && !canFitBelow) {
        nextPlacement = "up";
      } else if (canFitBelow && !canFitAbove) {
        nextPlacement = "down";
      } else {
        // In-flow hero composers sit above page content; opening upward avoids
        // clipping inside scroll containers and the dead space below centred homes.
        nextPlacement = spaceBelow > spaceAbove + 80 ? "down" : "up";
      }
    } else {
      nextPlacement = availableBelow > availableAbove + 40 ? "down" : "up";
    }

    // Cap an upward-opening menu so it stays clear of the sticky header + mode
    // switcher (which otherwise gets covered, blocking its pointer events) when the
    // trigger sits low enough that a full-height list would reach the top nav.
    const headerSafeInset = 84;
    const upwardHeightLimit = Math.max(0, rect.top - viewportTop - headerSafeInset);
    const available = nextPlacement === "up" ? Math.min(spaceAbove, upwardHeightLimit) : spaceBelow;
    const nextSurfaceMaxHeight = Math.max(220, Math.floor(Math.min(available, viewportHeight - edgePadding * 2)));
    const nextBodyMaxHeight = Math.max(156, nextSurfaceMaxHeight - headerHeight);

    setPlacement((current) => (current === nextPlacement ? current : nextPlacement));
    setSurfaceMaxHeight((current) => (current === nextSurfaceMaxHeight ? current : nextSurfaceMaxHeight));
    setBodyMaxHeight((current) => (current === nextBodyMaxHeight ? current : nextBodyMaxHeight));

    if (integrated) {
      const maxSurfaceWidth = Math.min(window.innerWidth - edgePadding * 2, 384);
      const surfaceLeft = Math.max(edgePadding, Math.min(rect.left, window.innerWidth - maxSurfaceWidth - edgePadding));
      setIntegratedSurfaceLayout({
        placement: nextPlacement,
        left: surfaceLeft,
        width: maxSurfaceWidth,
        // Keep the caret centred on the "+" trigger even when the surface is
        // clamped to the viewport edge and no longer starts at the trigger.
        caretLeft: Math.max(20, rect.left - surfaceLeft + rect.width / 2),
        ...(nextPlacement === "up"
          ? { bottom: window.innerHeight - rect.top + 14 }
          : { top: rect.bottom + integratedDownOffset }),
      });
    } else {
      setIntegratedSurfaceLayout(null);
    }
  }, [hasCustomBody, integrated, integratedChipRow, items.length]);

  function openWithFocus(index: number) {
    onBeforeOpen?.();
    setModeSelectorOpen(false);
    updatePlacement();
    onOpenChange(true);
    window.requestAnimationFrame(() => focusActionItem(index));
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    openWithFocus(event.key === "ArrowUp" ? -1 : 0);
  }

  function handleItemKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusActionItem(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusActionItem(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusActionItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusActionItem(items.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
    }
  }

  function runActionAndClose(actionId: ModeActionId) {
    setModeSelectorOpen(false);
    onOpenChange(false);
    onAction(actionId);
  }

  function focusModeOption(index: number) {
    if (!modeOptions?.length) return;
    const nextIndex = (index + modeOptions.length) % modeOptions.length;
    modeOptionRefs.current[nextIndex]?.focus();
  }

  const selectedModeIndex = Math.max(0, modeOptions?.findIndex((mode) => mode.id === selectedModeId) ?? 0);

  function openModeSelectorWithFocus(index: number) {
    if (!canSwitchMode) return;
    setModeSelectorOpen(true);
    window.requestAnimationFrame(() => focusModeOption(index));
  }

  function handleModeButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openModeSelectorWithFocus(selectedModeIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openModeSelectorWithFocus(selectedModeIndex - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setModeSelectorOpen(false);
    }
  }

  function handleModeOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusModeOption(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusModeOption(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusModeOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      if (modeOptions?.length) focusModeOption(modeOptions.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setModeSelectorOpen(false);
      window.requestAnimationFrame(() => modeButtonRef.current?.focus());
    }
  }

  function selectMode(mode: ModeActionModeOption) {
    if (mode.disabled) return;
    onModeSelect?.(mode.id);
    setModeSelectorOpen(false);
    window.requestAnimationFrame(() => modeButtonRef.current?.focus());
  }

  const headerSubtitle =
    subtitle ||
    (title.toLowerCase() === "answer"
      ? "Source-backed mode"
      : selectedModeOption?.description ||
        items.find((item) => item.primary)?.description ||
        items[0]?.description ||
        "Mode actions");

  function assignActionRef(element: HTMLButtonElement | null, index: number) {
    itemRefs.current[index] = element;
  }

  useLayoutEffect(() => {
    if (!open || useSheet) return;
    updatePlacement();
  }, [items.length, open, title, updatePlacement, useSheet]);

  useEffect(() => {
    if (open) return;
    queueMicrotask(() => setIntegratedSurfaceLayout(null));
  }, [open]);

  useEffect(() => {
    if (!open || useSheet) return;
    onPlacementChange?.(placement);
  }, [onPlacementChange, open, placement, useSheet]);

  useEffect(() => {
    if (!open || useSheet) return;

    let placementFrame: number | null = null;
    const schedulePlacementUpdate = () => {
      if (placementFrame !== null) return;
      placementFrame = window.requestAnimationFrame(() => {
        placementFrame = null;
        updatePlacement();
      });
    };
    const scrollOptions: AddEventListenerOptions = { capture: true, passive: true };

    updatePlacement();
    window.addEventListener("resize", schedulePlacementUpdate);
    window.addEventListener("scroll", schedulePlacementUpdate, scrollOptions);
    window.visualViewport?.addEventListener("resize", schedulePlacementUpdate);
    window.visualViewport?.addEventListener("scroll", schedulePlacementUpdate, { passive: true });
    return () => {
      if (placementFrame !== null) window.cancelAnimationFrame(placementFrame);
      window.removeEventListener("resize", schedulePlacementUpdate);
      window.removeEventListener("scroll", schedulePlacementUpdate, scrollOptions);
      window.visualViewport?.removeEventListener("resize", schedulePlacementUpdate);
      window.visualViewport?.removeEventListener("scroll", schedulePlacementUpdate);
    };
  }, [open, updatePlacement, useSheet]);

  const surfaceStyle = {
    "--mode-action-max-height": surfaceMaxHeight ? `${surfaceMaxHeight}px` : undefined,
    "--mode-action-body-max-height": bodyMaxHeight ? `${bodyMaxHeight}px` : undefined,
    ...(integrated && integratedSurfaceLayout
      ? {
          left: `${integratedSurfaceLayout.left}px`,
          width: `${integratedSurfaceLayout.width}px`,
          "--mode-action-caret-left": `${integratedSurfaceLayout.caretLeft}px`,
          ...(integratedSurfaceLayout.top !== undefined ? { top: `${integratedSurfaceLayout.top}px` } : {}),
          ...(integratedSurfaceLayout.bottom !== undefined ? { bottom: `${integratedSurfaceLayout.bottom}px` } : {}),
        }
      : {}),
  } as CSSProperties;

  const integratedDownOffsetClass = integratedChipRow ? "top-[calc(100%+3.65rem)]" : "top-[calc(100%+0.875rem)]";

  // Shared, presentation-agnostic action list — the same rows render inside the
  // desktop popover and the phone/tablet sheet. Each row's accessible name is set
  // via aria-label to the `label` only; the visible secondary description is linked
  // with aria-describedby (and must not use aria-hidden, which conflicts with it).
  // That keeps exact-match queries like "Scope"/"Browse library" stable.
  function renderActionRows() {
    return (
      <div
        id={actionSurfaceId}
        data-testid="daily-actions-menu"
        role="menu"
        aria-label={title}
        className={cn("polished-scroll", useSheet ? "" : cn("mode-action-body p-2.5", integrated && "p-3 sm:p-3.5"))}
      >
        <div className="grid gap-1.5">
          {items.map((item, index) => {
            const Icon = item.icon;
            const descriptionId = item.description ? `${actionDescId}-${index}` : undefined;
            return (
              <button
                key={item.id}
                ref={(element) => assignActionRef(element, index)}
                type="button"
                role="menuitem"
                aria-label={item.label}
                aria-describedby={descriptionId}
                onKeyDown={(event) => handleItemKeyDown(event, index)}
                onClick={() => runActionAndClose(item.id)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl border px-3 text-left transition motion-safe:duration-[var(--duration-quick)]",
                  useSheet ? "min-h-14 py-2" : "min-h-12 py-1.5",
                  item.primary
                    ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]/45 hover:bg-[color:var(--clinical-accent-soft)]/60"
                    : "border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--clinical-accent)]/40 hover:bg-[color:var(--clinical-accent-soft)]/24",
                  "motion-safe:active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                )}
              >
                <span
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition",
                    item.primary
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-heading)] group-hover:text-[color:var(--clinical-accent)]",
                  )}
                >
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-[color:var(--text-heading)]">
                    {item.label}
                  </span>
                  {item.description ? (
                    <span
                      id={descriptionId}
                      className="mt-0.5 block truncate text-xs font-medium text-[color:var(--text-muted)]"
                    >
                      {item.description}
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] transition group-hover:text-[color:var(--clinical-accent)]"
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // In-place mode picker: while the header's mode switcher is open, the popover
  // body swaps the action rows for this list (same scroll area, so it can never
  // be clipped by the panel the way a layered dropdown was). Escape or a second
  // press of the title returns to the actions.
  function renderModeList() {
    if (!modeOptions?.length) return null;
    return (
      <div
        id="mode-action-mode-menu"
        role="menu"
        aria-label="Choose search mode"
        className="mode-action-body polished-scroll p-2.5"
      >
        <div className="grid gap-1.5">
          {modeOptions.map((mode, index) => {
            const Icon = mode.icon;
            const active = mode.id === selectedModeId;
            return (
              <button
                key={mode.id}
                ref={(element) => {
                  modeOptionRefs.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={mode.disabled}
                onKeyDown={(event) => handleModeOptionKeyDown(event, index)}
                onClick={() => selectMode(mode)}
                className={cn("mode-action-mode-option", active && "mode-action-mode-option-active")}
              >
                <span className="mode-action-mode-option-icon">
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold">{mode.label}</span>
                  {mode.description ? (
                    <span className="block truncate text-2xs font-semibold text-[color:var(--text-muted)]">
                      {mode.description}
                    </span>
                  ) : null}
                </span>
                {active ? (
                  <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Statement form (not a JSX ternary): react-hooks/refs treats helpers invoked
  // conditionally inside JSX as possible non-render callbacks and then flags the
  // ref writes/handlers inside both list renderers.
  function renderPopoverBody() {
    if (modeSelectorOpen && modeOptions?.length) return renderModeList();
    return renderActionRows();
  }

  // Invoke the default renderer unconditionally so its ref-owning helpers remain
  // ordinary render work even when a richer body replaces the resulting node.
  const defaultPopoverBody = renderPopoverBody();
  const customBodyWithFocusScope = customBody ? <div id={customBodyFocusScopeId}>{customBody}</div> : null;
  const popoverBody = customBodyWithFocusScope ?? defaultPopoverBody;

  // Desktop popover header — same anatomy as the Sheet header the ≤1023px surface
  // uses (accent icon tile + stacked title/subtitle + close), so the menu reads as
  // one design across breakpoints. The title doubles as the mode switcher; the
  // subtitle sits on its own full-width line so it can never be crushed.
  function renderPopoverHeader() {
    return (
      <div className="relative z-10 flex items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--surface-raised)] px-4 py-3.5">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]"
        >
          <TitleIcon aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            ref={modeButtonRef}
            disabled={!canSwitchMode}
            aria-haspopup={canSwitchMode ? "menu" : undefined}
            aria-expanded={canSwitchMode ? modeSelectorOpen : undefined}
            aria-controls={modeSelectorOpen ? "mode-action-mode-menu" : undefined}
            onKeyDown={handleModeButtonKeyDown}
            onClick={() => canSwitchMode && setModeSelectorOpen((current) => !current)}
            className={cn(
              "-mx-1.5 flex min-h-tap max-w-full items-center gap-1 rounded-lg px-1.5 py-0.5 text-left transition",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
              canSwitchMode ? "hover:bg-[color:var(--surface-subtle)]" : "cursor-default",
            )}
          >
            <span className="min-w-0 truncate text-base font-semibold text-[color:var(--text-heading)]">{title}</span>
            {canSwitchMode ? (
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] transition",
                  modeSelectorOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            ) : null}
          </button>
          <p className="truncate text-sm leading-5 text-[color:var(--text-muted)]">
            {modeSelectorOpen ? "Choose search mode" : headerSubtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={closeAndRestoreFocus}
          className={toolbarButton}
          aria-label={`Close ${title.toLowerCase()} options`}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const actionSurface =
    open && !useSheet ? (
      <div
        ref={surfaceRef}
        data-placement={placement}
        style={surfaceStyle}
        id={customBody ? actionSurfaceId : undefined}
        data-testid={customBody ? "daily-actions-menu" : undefined}
        role={customBody ? "dialog" : undefined}
        aria-label={customBody ? title : undefined}
        className={cn(
          "mode-action-surface z-[60] text-[color:var(--text)]",
          integrated && integratedSurfaceLayout ? "fixed" : "absolute",
          integrated && integratedSurfaceLayout
            ? null
            : integrated
              ? "inset-x-0"
              : "inset-x-0 sm:inset-x-auto sm:left-0",
          !integrated || !integratedSurfaceLayout
            ? placement === "up"
              ? "bottom-[calc(100%+0.875rem)]"
              : integrated
                ? integratedDownOffsetClass
                : "top-[calc(100%+0.875rem)]"
            : null,
          !integrated && "sm:w-[min(24rem,100%)]",
        )}
      >
        <div
          className={cn(
            glassOverlaySurface,
            "mode-action-panel overflow-hidden bg-[color:var(--surface-raised)] shadow-[var(--shadow-elevated)]",
            integrated ? "rounded-2xl shadow-[var(--shadow-elevated)]" : "rounded-xl",
          )}
        >
          {renderPopoverHeader()}
          {popoverBody}
        </div>
      </div>
    ) : null;

  return (
    <>
      {useSheet ? (
        <Sheet
          open={open}
          onClose={closeAndRestoreFocus}
          title={title}
          description={headerSubtitle}
          closeLabel={`Close ${title.toLowerCase()} options`}
          returnFocusRef={buttonRef}
          resolveReturnFocusTarget={resolveSheetReturnFocusTarget}
          id={customBody ? actionSurfaceId : undefined}
          testId={customBody ? "daily-actions-menu" : undefined}
          headerLeading={
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
              <TitleIcon className="h-5 w-5" aria-hidden="true" />
            </span>
          }
          mobilePlacement="bottom"
          mobileSize="content"
          portal
        >
          {customBodyWithFocusScope ?? defaultPopoverBody}
        </Sheet>
      ) : integrated && open && typeof document !== "undefined" ? (
        createPortal(actionSurface, document.body)
      ) : (
        actionSurface
      )}

      <div ref={rootRef} className="relative shrink-0">
        <button
          type="button"
          ref={(element) => {
            buttonRef.current = element;
            assignTriggerRef(triggerRef, element);
          }}
          className={cn(
            chatComposerIconButton,
            triggerClassName,
            // `rotate-45` (not `motion-safe:rotate-45`): the open "+"→"×" state is
            // information, not decoration. The global reduced-motion rule makes the
            // transform instant, so gating it on motion-safe wrongly dropped the
            // affordance entirely for those users.
            open && "bg-[color:var(--surface-subtle)] text-[color:var(--text)] rotate-45",
          )}
          aria-label={buttonLabel}
          aria-controls={open ? actionSurfaceId : undefined}
          aria-expanded={open}
          aria-haspopup={customBody ? "dialog" : "menu"}
          title={buttonLabel}
          onKeyDown={handleTriggerKeyDown}
          onClick={() => {
            if (!open) {
              onBeforeOpen?.();
              setModeSelectorOpen(false);
              updatePlacement();
            } else {
              setModeSelectorOpen(false);
            }
            onOpenChange(!open);
          }}
        >
          <Plus aria-hidden="true" className="size-icon-lg" />
        </button>
      </div>
    </>
  );
}

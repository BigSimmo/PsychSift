"use client";

import {
  useEffect,
  useCallback,
  useId,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
} from "react";
import { X } from "lucide-react";
import { OverlayPortal } from "@/components/ui/overlay-root";
import { cn, toolbarButton } from "@/components/ui-primitives";
import {
  canRestoreFocusTo,
  isTopmostSheet,
  popSheet,
  pushSheet,
  startSheetOpenFocus,
  updateSheetRoot,
  type SheetFocusController,
} from "@/components/ui/sheet-focus";

export type SheetMobileSize = "content" | "viewport";
export type SheetMobileHeaderSafeArea = "none" | "padding" | "offset";

type SheetAccessibleName =
  | { title: string; labelledBy?: string; ariaLabel?: string }
  | { title?: undefined; labelledBy: string; ariaLabel?: string }
  | { title?: undefined; labelledBy?: undefined; ariaLabel: string };

type SheetBaseProps = {
  open: boolean;
  onClose: () => void;
  /** When true, registers a history entry so browser/phone Back dismisses the sheet instead of leaving the page. */
  dismissOnBack?: boolean;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Read at close time (not capture-on-open). Mutating `.current` while open retargets restore. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Optional late resolver consulted before `returnFocusRef` / prior active element.
   * Must be referentially stable (e.g. `useCallback`); an inline arrow re-runs the
   * open-effect and fights the sheet for focus on every parent render.
   */
  resolveReturnFocusTarget?: () => HTMLElement | null;
  headerLeading?: ReactNode;
  titleAccessory?: ReactNode;
  descriptionContent?: ReactNode;
  headerActions?: ReactNode;
  headerBottom?: ReactNode;
  headerHidden?: boolean;
  headerRef?: RefObject<HTMLDivElement | null>;
  headerClassName?: string;
  titleClassName?: string;
  closeButtonClassName?: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
  bodyClassName?: string;
  bodyRef?: RefObject<HTMLDivElement | null>;
  /**
   * Makes the scrollable body reachable by keyboard when its content may not
   * always include a focusable descendant (WCAG 2.1.1 / axe
   * scrollable-region-focusable). Omit for bodies that always contain
   * interactive content.
   */
  bodyTabIndex?: number;
  onBodyScroll?: UIEventHandler<HTMLDivElement>;
  footerClassName?: string;
  /**
   * Stamps `data-footer-variant` on the footer wrapper. Only meaningful when the
   * footer opts into the shared phone dock chrome (`.answer-footer-search-dock`),
   * where `globals.css` reads it to pick the scrim height: `compact` is for a dock
   * carrying a single control row rather than a composer plus an action row.
   */
  footerVariant?: "default" | "compact";
  /** Side placement is opt-in so existing dialogs keep their centred layout. */
  placement?: "default" | "left" | "right" | "responsive-right";
  mobilePlacement?: "bottom" | "top" | "fullscreen";
  mobileSize?: SheetMobileSize;
  /**
   * Keeps the Sheet-owned header controls below the phone top safe area.
   * Fullscreen sheets default to `padding`; near-full bottom sheets must opt in
   * because short bottom sheets should not inherit a notch-sized empty band.
   * Use `offset` only for an absolutely positioned header.
   */
  mobileHeaderSafeArea?: SheetMobileHeaderSafeArea;
  portal?: boolean;
  desktopBackdropClassName?: string;
  testId?: string;
  /** Stable dialog id so an opener can advertise `aria-controls`. */
  id?: string;
};

export type SheetProps = SheetBaseProps & SheetAccessibleName;

/**
 * Responsive overlay: a bottom sheet on mobile (rises from the bottom, safe-area
 * aware, drag-grip) and a centred dialog from `sm:` up. CSS-only animation.
 * Portals into `OverlayRoot` (`layer="modal"`) by default so stacking and
 * inerting stay consistent across product overlays; pass `portal={false}` to
 * keep the sheet in-tree when an ancestor-scoped style must still apply.
 * Focus is trapped while open and returned on close; Escape and backdrop click
 * both dismiss. Return focus is resolved late from `resolveReturnFocusTarget`
 * (stable callback), then `returnFocusRef.current`, then the previously focused
 * element — so callers can retarget restore while the sheet is still open.
 */
export function Sheet({
  open,
  onClose,
  dismissOnBack = false,
  title,
  description,
  children,
  footer,
  closeLabel = "Close",
  labelledBy,
  ariaLabel,
  initialFocusRef,
  returnFocusRef,
  resolveReturnFocusTarget,
  headerLeading,
  titleAccessory,
  descriptionContent,
  headerActions,
  headerBottom,
  headerHidden = false,
  headerRef,
  headerClassName,
  titleClassName,
  closeButtonClassName,
  contentClassName,
  contentStyle,
  bodyClassName,
  bodyRef,
  bodyTabIndex,
  onBodyScroll,
  footerClassName,
  footerVariant,
  placement = "default",
  mobilePlacement = "bottom",
  mobileSize = "content",
  mobileHeaderSafeArea,
  portal = true,
  desktopBackdropClassName,
  testId,
  id,
}: SheetProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const dragRef = useRef<{ startY: number; dragging: boolean }>({ startY: 0, dragging: false });
  // Backdrop dismiss must require the gesture to *start* on the dimmed area.
  // Otherwise a press that begins on the panel and ends on the backdrop would
  // synthesize a click on the common ancestor and accidentally close the sheet.
  const backdropPointerDownRef = useRef(false);
  // Pending focus-restore timers from the previous close. Cleared on the next
  // open and on unmount so a torn-down jsdom environment cannot throw from a
  // stale 50ms retry under Vitest coverage workers, and so a fast
  // close-then-reopen cannot restore focus to the opener mid-open.
  const restoreTimersRef = useRef<{ frame: number | null; timeout: number | null }>({
    frame: null,
    timeout: null,
  });
  const openFocusRef = useRef<SheetFocusController | null>(null);
  const unmountingRef = useRef(false);
  const titleId = useId();
  const descId = useId();
  const sheetId = useId();
  const setBackdropRef = useCallback(
    (node: HTMLDivElement | null) => {
      backdropRef.current = node;
      updateSheetRoot(sheetId, node);
    },
    [sheetId],
  );
  const resolveReturnFocusRefTarget = useCallback(() => returnFocusRef?.current ?? null, [returnFocusRef]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    unmountingRef.current = false;
    const restoreTimers = restoreTimersRef.current;
    return () => {
      unmountingRef.current = true;
      if (restoreTimers.frame != null) {
        window.cancelAnimationFrame(restoreTimers.frame);
        restoreTimers.frame = null;
      }
      if (restoreTimers.timeout != null) {
        window.clearTimeout(restoreTimers.timeout);
        restoreTimers.timeout = null;
      }
      openFocusRef.current?.cancel();
      openFocusRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open || !dismissOnBack || typeof window === "undefined" || !window.history?.pushState) {
      return undefined;
    }
    const stateKey = `ps_sheet_${sheetId}`;
    try {
      window.history.pushState({ [stateKey]: true }, "");
    } catch {
      // Ignore storage/history exceptions in restricted embeds
    }

    const handlePopState = () => {
      onCloseRef.current();
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      try {
        if (window.history.state?.[stateKey]) {
          window.history.back();
        }
      } catch {
        // Ignore
      }
    };
  }, [open, dismissOnBack, sheetId]);

  // Swipe-to-dismiss for the mobile bottom sheet: dragging the grip down past a
  // threshold closes the sheet; a shorter drag snaps back. Grip-initiated only,
  // so it never competes with scrolling the sheet body. Keyboard/backdrop/close
  // dismissal is unaffected.
  function handleGripPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel) return;
    dragRef.current = { startY: event.clientY, dragging: true };
    panel.style.transition = "none";
    // Release the entry animation's `both` fill so the inline drag transform is
    // not overridden by the finished keyframes (CSS animations beat inline style).
    panel.style.animation = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleGripPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current.dragging) return;
    const delta = Math.max(0, event.clientY - dragRef.current.startY);
    if (panelRef.current) panelRef.current.style.transform = `translateY(${delta}px)`;
  }

  function handleGripPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current.dragging) return;
    const delta = Math.max(0, event.clientY - dragRef.current.startY);
    dragRef.current = { startY: 0, dragging: false };
    const panel = panelRef.current;
    if (panel) {
      // Restore the class-based transition so a non-dismiss snaps back smoothly.
      panel.style.transition = "";
      panel.style.transform = "";
    }
    if (delta > 96) onClose();
  }

  useEffect(() => {
    if (!open) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreTimers = restoreTimersRef.current;
    // A close-then-reopen inside one frame leaves this instance's own restore
    // scheduled; left pending it pulls focus back to the opener mid-open.
    if (restoreTimers.frame != null) {
      window.cancelAnimationFrame(restoreTimers.frame);
      restoreTimers.frame = null;
    }
    if (restoreTimers.timeout != null) {
      window.clearTimeout(restoreTimers.timeout);
      restoreTimers.timeout = null;
    }
    openFocusRef.current?.cancel();

    pushSheet(sheetId, backdropRef.current);
    openFocusRef.current = startSheetOpenFocus({
      sheetId,
      getPanel: () => panelRef.current,
      // The close button is only a fallback: the controller upgrades to a
      // deferred `data-sheet-autofocus` child (lazy DocumentDrawer Find field /
      // UtilityDrawer) as soon as it mounts.
      resolveTarget: () =>
        initialFocusRef?.current ??
        panelRef.current?.querySelector<HTMLElement>('[data-sheet-autofocus="true"]') ??
        closeRef.current,
    });

    function onKeyDown(event: KeyboardEvent) {
      // Only the top-most open Sheet reacts, so a stacked overlay (lightbox /
      // table dialog over the Evidence sheet) does not also close on one Escape
      // or fight over the Tab focus trap. Lower sheets registered their listener
      // earlier and fire first, so they self-suppress here without needing to
      // stop propagation.
      if (!isTopmostSheet(sheetId)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          // Exclude tabindex="-1" buttons so roving-tabindex menus (e.g. Mode
          // options) do not dump every inactive item into the Tab cycle.
          'a[href], button:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.tabIndex >= 0 &&
          !element.closest('[aria-hidden="true"], [inert]') &&
          element.getClientRects().length > 0,
      );
      if (focusable.length === 0) return;

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const currentIndex = activeElement ? focusable.indexOf(activeElement) : -1;
      const nextIndex =
        currentIndex === -1
          ? event.shiftKey
            ? focusable.length - 1
            : 0
          : event.shiftKey
            ? (currentIndex - 1 + focusable.length) % focusable.length
            : (currentIndex + 1) % focusable.length;

      // Move focus explicitly instead of relying on platform Tab preferences.
      // Firefox can otherwise leave programmatically focused buttons out of the
      // native sequence, which makes the modal trap inconsistent by browser.
      event.preventDefault();
      focusable[nextIndex].focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      openFocusRef.current?.cancel();
      openFocusRef.current = null;
      popSheet(sheetId);
      const resolveConnectedRestoreTarget = () =>
        [resolveReturnFocusTarget?.() ?? null, resolveReturnFocusRefTarget(), previousActiveElement].find(
          (target): target is HTMLElement => Boolean(target?.isConnected),
        ) ?? null;
      if (restoreTimers.frame != null) {
        window.cancelAnimationFrame(restoreTimers.frame);
        restoreTimers.frame = null;
      }
      if (restoreTimers.timeout != null) {
        window.clearTimeout(restoreTimers.timeout);
        restoreTimers.timeout = null;
      }
      if (unmountingRef.current) return;
      // Focus restore is best-effort. Under Vitest coverage workers the jsdom
      // `document` can be torn down before this rAF/setTimeout pair fires; bare
      // `document` access then becomes an unhandled ReferenceError that fails
      // the whole suite even when every test assertion passed.
      restoreTimers.frame = window.requestAnimationFrame(() => {
        restoreTimers.frame = null;
        const restoreTarget = resolveConnectedRestoreTarget();
        if (typeof document === "undefined" || !restoreTarget?.isConnected) return;
        // A sheet opened while this one was closing (switching between two
        // sheets in one tick) now owns focus. Instances cannot cancel each
        // other's timers, so the stack is the only place this is knowable —
        // without it the new sheet has to fight the restore back. Handing
        // focus back down to a sheet this one was stacked on still restores.
        if (!canRestoreFocusTo(restoreTarget)) return;
        restoreTarget.focus({ preventScroll: true });
        restoreTimers.timeout = window.setTimeout(() => {
          restoreTimers.timeout = null;
          if (typeof document === "undefined") return;
          const retryTarget = resolveConnectedRestoreTarget();
          // Only retry when focus fell through to the document body. If another
          // surface (e.g. a Guide dialog opened from a phone menu sheet) already
          // took focus, do not steal it back.
          if (
            !retryTarget ||
            !canRestoreFocusTo(retryTarget) ||
            document.activeElement === retryTarget ||
            (document.activeElement !== document.body && document.activeElement != null)
          ) {
            return;
          }
          retryTarget.focus({ preventScroll: true });
        }, 50);
      });
    };
  }, [open, initialFocusRef, resolveReturnFocusRefTarget, resolveReturnFocusTarget, sheetId]);

  if (!open) return null;

  // Empty-string titles still satisfy the type-level union (`title: string`) but
  // leave the dialog unnamed at runtime. Never drop the overlay in production —
  // keep a generic accessible name so the user can still dismiss and finish.
  const hasAccessibleName = Boolean(title || labelledBy || ariaLabel);
  if (!hasAccessibleName && process.env.NODE_ENV !== "production") {
    throw new Error("Sheet requires an accessible name through title, labelledBy, or ariaLabel.");
  }
  const resolvedAriaLabel = ariaLabel || (!title && !labelledBy ? "Dialog" : undefined);
  const resolvedLabelledBy = labelledBy ?? (title ? titleId : undefined);
  const sideSheet = placement === "left" || placement === "right";
  const responsiveSideSheet = placement === "responsive-right";
  const defaultSheetIsFullscreen = !sideSheet && mobilePlacement === "fullscreen";
  const defaultSheetIsTopAligned = !sideSheet && mobilePlacement === "top";
  const defaultSheetUsesViewportSize = !sideSheet && mobileSize === "viewport";
  const resolvedMobileHeaderSafeArea = mobileHeaderSafeArea ?? (defaultSheetIsFullscreen ? "padding" : "none");
  const contentClassTokens = contentClassName?.split(/\s+/) ?? [];
  const hasMobileMaxHeight = contentClassTokens.some((token) => /^!?max-h-/.test(token));
  const hasSmallScreenMaxHeight = contentClassTokens.some((token) => /^sm:!?max-h-/.test(token));

  const sheet = (
    <div
      ref={setBackdropRef}
      className={cn(
        // The modal rung is kept on the backdrop itself so the non-portal
        // branch still stacks above sibling chrome.
        "pointer-events-auto fixed inset-0 z-[var(--z-modal)] flex bg-[color:var(--overlay-backdrop)] backdrop-blur-[2px] motion-reduce:animate-none motion-reduce:transition-none",
        desktopBackdropClassName,
        !sideSheet && !responsiveSideSheet && "motion-safe:animate-overlay-in",
        placement === "left"
          ? "items-stretch justify-start"
          : placement === "right"
            ? "items-stretch justify-end"
            : placement === "responsive-right"
              ? "items-end justify-center sm:items-stretch sm:justify-end sm:p-0"
              : defaultSheetIsFullscreen
                ? "items-stretch justify-center p-0 lg:items-center lg:p-6"
                : defaultSheetIsTopAligned
                  ? "items-start justify-center px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:items-center sm:p-6"
                  : "items-end justify-center sm:items-center sm:p-6",
      )}
      // Dismiss on click (not pointerdown) so the sheet stays mounted through
      // pointerup and the same gesture cannot click-through into content below.
      // Only honor the click when the pointerdown also began on the backdrop.
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || !backdropPointerDownRef.current) return;
        backdropPointerDownRef.current = false;
        onClose();
      }}
    >
      <div
        ref={panelRef}
        id={id}
        data-testid={testId}
        data-mobile-header-safe-area={resolvedMobileHeaderSafeArea}
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedLabelledBy}
        aria-label={resolvedAriaLabel}
        aria-describedby={description || descriptionContent ? descId : undefined}
        onPointerDown={(event) => {
          backdropPointerDownRef.current = false;
          event.stopPropagation();
        }}
        style={contentStyle}
        className={cn(
          "flex min-w-0 w-full flex-col overflow-hidden border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)] shadow-[var(--shadow-elevated)] pb-safe",
          "transition duration-[var(--duration-moderate)] motion-reduce:transition-none sm:duration-[var(--duration-quick)]",
          placement === "left"
            ? "h-full max-h-full max-w-[min(22rem,calc(100vw-1rem))] rounded-r-2xl border-y-0 border-l-0 pt-safe pl-safe sm:max-h-dvh sm:max-w-[22rem] sm:rounded-l-none sm:rounded-r-2xl sm:pb-0 sm:pl-0"
            : placement === "right"
              ? "h-full max-h-full max-w-[min(32rem,calc(100vw-1rem))] rounded-l-2xl border-y-0 border-r-0 pt-safe pr-safe sm:max-h-dvh sm:max-w-[32rem] sm:rounded-l-2xl sm:rounded-r-none sm:pb-0 sm:pr-0"
              : placement === "responsive-right"
                ? "max-h-[calc(100dvh-2rem)] rounded-t-2xl motion-safe:animate-sheet-up pr-safe sm:h-full sm:max-h-full sm:max-w-[32rem] sm:rounded-l-2xl sm:rounded-r-none sm:border-y-0 sm:border-r-0 sm:pb-0 sm:pr-0 sm:motion-safe:animate-dialog-rise"
                : cn(
                    defaultSheetIsFullscreen
                      ? // Fullscreen panels size from the inset-0 backdrop (h-full), not
                        // 100dvh: iOS Safari resolves dvh stale across toolbar
                        // collapse, which strands a dead band under the sheet.
                        "h-full max-h-full rounded-none border-0 motion-safe:animate-pop-in px-safe sm:max-w-none sm:rounded-none sm:px-0 lg:h-auto lg:max-h-[calc(100dvh-3rem)] lg:rounded-2xl lg:border lg:border-[color:var(--border-lux)] lg:pb-0 lg:motion-safe:animate-dialog-rise"
                      : cn(
                          "sm:max-w-lg sm:rounded-2xl sm:pb-0 sm:motion-safe:animate-dialog-rise",
                          defaultSheetIsTopAligned
                            ? cn(
                                "max-h-[calc(100dvh-1.5rem)] rounded-2xl motion-safe:animate-pop-in",
                                defaultSheetUsesViewportSize && "min-h-[calc(100dvh-2rem)] sm:min-h-0",
                              )
                            : cn(
                                "rounded-t-2xl motion-safe:animate-sheet-up",
                                defaultSheetUsesViewportSize
                                  ? "min-h-[calc(100dvh-2rem)] max-h-[calc(100dvh-1rem-var(--keyboard-height,0px))] sm:min-h-0"
                                  : cn(
                                      !hasMobileMaxHeight && "max-h-[calc(100dvh-2rem-var(--keyboard-height,0px))]",
                                      !hasSmallScreenMaxHeight && "sm:max-h-[88dvh]",
                                    ),
                              ),
                        ),
                  ),
          "motion-reduce:animate-none",
          contentClassName,
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full shrink-0 cursor-grab touch-none justify-center pb-1 pt-2 active:cursor-grabbing sm:hidden",
            sideSheet && "hidden",
            defaultSheetIsFullscreen && "hidden",
            defaultSheetIsTopAligned && "hidden",
          )}
          aria-hidden
          onPointerDown={handleGripPointerDown}
          onPointerMove={handleGripPointerMove}
          onPointerUp={handleGripPointerUp}
          onPointerCancel={handleGripPointerUp}
        >
          <span className="h-1 w-9 rounded-full bg-[color:var(--border-strong)]" />
        </div>
        {title ? (
          <div
            ref={headerRef}
            data-sheet-header="true"
            aria-hidden={headerHidden}
            inert={headerHidden || undefined}
            className={cn(
              "flex items-center justify-between gap-x-3 border-b border-[color:var(--border)] p-4 sm:p-5",
              Boolean(headerBottom) && "flex-wrap",
              headerClassName,
              !headerHidden &&
                resolvedMobileHeaderSafeArea === "padding" &&
                "pt-[max(1rem,var(--safe-area-top))] sm:pt-5",
              !headerHidden &&
                resolvedMobileHeaderSafeArea === "offset" &&
                "top-[max(0.75rem,var(--safe-area-top))] sm:top-4",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {headerLeading ? <div className="shrink-0">{headerLeading}</div> : null}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h2
                    id={titleId}
                    className={cn("break-words text-lg font-semibold text-[color:var(--text-heading)]", titleClassName)}
                  >
                    {title}
                  </h2>
                  {titleAccessory}
                </div>
                {descriptionContent ? (
                  <div id={descId} className="mt-1">
                    {descriptionContent}
                  </div>
                ) : description ? (
                  <p id={descId} className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
                    {description}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className={closeButtonClassName ?? toolbarButton}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            {headerBottom ? (
              <div className="order-last -mx-4 mt-3 w-[calc(100%+2rem)] basis-full sm:-mx-5 sm:w-[calc(100%+2.5rem)]">
                {headerBottom}
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          ref={bodyRef}
          onScroll={onBodyScroll}
          tabIndex={bodyTabIndex}
          // overscroll-contain: without it a gesture that reaches the end of this
          // body continues into the page behind the sheet. `.polished-scroll` is
          // scrollbar styling only and never carried this.
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 polished-scroll sm:p-5",
            bodyClassName,
          )}
        >
          {children}
        </div>
        {footer ? (
          <div
            data-footer-variant={footerVariant}
            className={cn("shrink-0 border-t border-[color:var(--border)] p-3 sm:p-4", footerClassName)}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (portal) {
    return (
      <OverlayPortal layer="modal" name={title ?? resolvedAriaLabel ?? labelledBy ?? "sheet"}>
        {sheet}
      </OverlayPortal>
    );
  }

  return sheet;
}

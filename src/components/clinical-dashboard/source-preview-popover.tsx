"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { useDismissableLayer } from "@/components/use-dismissable-layer";
import { cn } from "@/components/ui-primitives";

type PopoverPlacement = "below" | "above";

const edgePadding = 12;
const anchorGap = 8;
const minPopoverHeight = 220;

function computePopoverLayout(anchor: HTMLElement) {
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportBottom = viewportTop + viewportHeight;
  const rect = anchor.getBoundingClientRect();
  const availableAbove = Math.max(0, rect.top - viewportTop - edgePadding);
  const availableBelow = Math.max(0, viewportBottom - rect.bottom - edgePadding);
  const isNarrowViewport = viewportWidth < 380;
  const effectiveMinHeight = Math.min(minPopoverHeight, Math.floor(viewportHeight * 0.45));
  const placement: PopoverPlacement =
    availableBelow >= availableAbove + 40 || availableBelow >= effectiveMinHeight ? "below" : "above";
  const available =
    placement === "below" ? Math.max(0, availableBelow - anchorGap) : Math.max(0, availableAbove - anchorGap);
  const maxHeight = Math.max(
    effectiveMinHeight,
    Math.floor(Math.min(available, viewportHeight - edgePadding * 2, 22 * 16)),
  );
  const maxWidth = isNarrowViewport
    ? viewportWidth - edgePadding * 2
    : Math.min(36 * 16, viewportWidth - edgePadding * 2);
  const preferredLeft = rect.left;
  const left = isNarrowViewport
    ? edgePadding + viewportLeft
    : Math.max(
        edgePadding + viewportLeft,
        Math.min(preferredLeft, viewportLeft + viewportWidth - maxWidth - edgePadding),
      );
  const top =
    placement === "below"
      ? rect.bottom + anchorGap
      : Math.max(viewportTop + edgePadding, rect.top - anchorGap - maxHeight);

  return { placement, top, left, maxWidth, maxHeight };
}

export function SourcePreviewPopover({
  open,
  onClose,
  anchorRef,
  title = "Sources",
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  title?: string;
  children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    placement: PopoverPlacement;
    top: number;
    left: number;
    maxWidth: number;
    maxHeight: number;
  } | null>(null);

  const updateLayout = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    setLayout(computePopoverLayout(anchor));
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    updateLayout();
  }, [open, updateLayout]);

  useEffect(() => {
    if (!open) return undefined;

    // Capture-phase scroll fires for every scrollable ancestor on each frame; a
    // raw handler ran getBoundingClientRect + setState per event, so scrolling
    // with the popover open could stutter. Coalesce into one rAF per frame and
    // register scroll listeners passive so they never block the scroll thread.
    let frame: number | null = null;
    const handleViewportChange = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateLayout();
      });
    };
    const scrollOptions: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange, { passive: true });
    window.addEventListener("scroll", handleViewportChange, scrollOptions);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, scrollOptions);
    };
  }, [open, updateLayout]);

  useEffect(() => {
    if (!open) return undefined;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      window.requestAnimationFrame(() => anchorRef.current?.focus({ preventScroll: true }));
    }

    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [anchorRef, open, onClose]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => {
      const focusTarget =
        surfaceRef.current?.querySelector<HTMLElement>('[data-sheet-autofocus="true"]') ??
        surfaceRef.current?.querySelector<HTMLElement>("a[href], button:not([disabled])") ??
        surfaceRef.current;
      focusTarget?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open]);

  useDismissableLayer({
    enabled: open,
    refs: [anchorRef, surfaceRef],
    restoreFocusRef: anchorRef,
    onDismiss: () => onClose(),
  });

  if (!open || typeof document === "undefined") return null;

  const style: CSSProperties = layout
    ? {
        top: layout.top,
        left: layout.left,
        width: layout.maxWidth,
        maxHeight: layout.maxHeight,
      }
    : { visibility: "hidden" };

  return createPortal(
    <div
      ref={surfaceRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      data-testid="source-capsule-preview"
      data-popover-placement={layout?.placement ?? "below"}
      style={style}
      className={cn(
        "fixed z-[95] min-w-[min(100vw-1.5rem,20rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--shadow-elevated)] motion-safe:animate-pop-in motion-reduce:animate-none",
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

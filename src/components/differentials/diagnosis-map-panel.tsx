"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Crosshair,
  Filter,
  GitCompareArrows,
  Maximize2,
  Minus,
  Move,
  Plus,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";

import { useEventCallback } from "@/components/clinical-dashboard/use-event-callback";
import { DiagnosisMapInsights } from "@/components/differentials/diagnosis-map-insights";
import { Sheet } from "@/components/ui/sheet";
import { controlDisabled, cn, floatingControl, primaryControl, toolbarButton } from "@/components/ui-primitives";
import type { DifferentialCuratedEntry } from "@/lib/differential-curated";
import {
  buildDiscriminators,
  curatedProvenanceFor,
  differentialStatusLabel,
  type DifferentialRelatedMapDetail,
} from "@/lib/differential-detail";
import { differentialSelectedCompareHref } from "@/lib/differentials-navigation";
import type { DifferentialLikelihood, DifferentialMapNode, DifferentialRecord } from "@/lib/differentials";

type ActivePoint = {
  x: number;
  y: number;
};

type MapView = {
  scale: number;
  pan: ActivePoint;
};

type SelectedNode = DifferentialMapNode | "diagnosis";

type LayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type MapLayout = {
  focus: LayoutNode;
  related: LayoutNode[];
};

type MapMetrics = {
  width: number;
  height: number;
  layout: MapLayout;
};

const fitView: MapView = { scale: 1, pan: { x: 0, y: 0 } };
const minScale = 0.9;
const maxScale = 2.2;
const phoneLayoutBreakpoint = 640;
const mapVisibilityInset = 48;

const likelihoodTone: Record<DifferentialLikelihood, string> = {
  "most-likely":
    "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]",
  possible:
    "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  "less-likely": "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
  "must-not-miss": "border-[color:var(--danger)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
};

const lineTone: Record<DifferentialLikelihood, string> = {
  "most-likely": "var(--clinical-accent)",
  possible: "color-mix(in srgb, var(--clinical-accent) 62%, transparent)",
  "less-likely": "color-mix(in srgb, var(--decoration-soft) 62%, transparent)",
  "must-not-miss": "var(--danger)",
};

const likelihoodLabels: Record<DifferentialLikelihood, string> = {
  "most-likely": "Most likely",
  possible: "Possible",
  "less-likely": "Less likely",
  "must-not-miss": "Must-not-miss",
};

const statusTone: Record<DifferentialRecord["status"], string> = {
  emergent: "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
  urgent: "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
  routine: "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function distance(a: ActivePoint, b: ActivePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: ActivePoint, b: ActivePoint) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function mobileMapMinimumHeight(nodeCount: number, interactive: boolean) {
  const rows = Math.max(1, Math.ceil(nodeCount / 2));
  return (interactive ? 168 : 154) + rows * (interactive ? 88 : 80);
}

function buildMapLayout(width: number, height: number, nodes: DifferentialMapNode[], interactive: boolean): MapLayout {
  if (width < phoneLayoutBreakpoint) {
    const gutter = width < 340 ? 8 : 12;
    const columnGap = width < 340 ? 8 : 12;
    const nodeWidth = clamp((width - gutter * 2 - columnGap) / 2, 104, interactive ? 144 : 132);
    const nodeHeight = interactive ? 78 : 70;
    const focusWidth = clamp(width - gutter * 4, 132, interactive ? 200 : 176);
    const focusHeight = interactive ? 78 : 70;
    const rowGap = interactive ? 12 : 10;
    const connectorGap = interactive ? 52 : 44;
    const rows = Math.max(1, Math.ceil(nodes.length / 2));
    const requiredHeight = gutter * 2 + focusHeight + connectorGap + rows * nodeHeight + (rows - 1) * rowGap;
    const top = gutter + Math.max(0, (height - requiredHeight) / 2);
    const focus = {
      id: "diagnosis",
      x: width / 2,
      y: top + focusHeight / 2,
      width: focusWidth,
      height: focusHeight,
    };
    const firstRowY = top + focusHeight + connectorGap + nodeHeight / 2;
    const leftX = gutter + nodeWidth / 2;
    const rightX = width - gutter - nodeWidth / 2;

    return {
      focus,
      related: nodes.map((node, index) => {
        const row = Math.floor(index / 2);
        const isUnpairedLast = nodes.length % 2 === 1 && index === nodes.length - 1;
        return {
          id: node.id,
          x: isUnpairedLast ? width / 2 : index % 2 === 0 ? leftX : rightX,
          y: firstRowY + row * (nodeHeight + rowGap),
          width: nodeWidth,
          height: nodeHeight,
        };
      }),
    };
  }

  const nodeWidth = width < 900 ? 136 : 156;
  const nodeHeight = 76;
  const focusWidth = width < 900 ? 168 : 188;
  const focusHeight = 82;
  const center = { x: width / 2, y: height / 2 };
  const radiusX = Math.max(0, width / 2 - nodeWidth / 2 - 20);
  const radiusY = Math.max(0, height / 2 - nodeHeight / 2 - 20);
  const count = Math.max(1, nodes.length);

  return {
    focus: { id: "diagnosis", ...center, width: focusWidth, height: focusHeight },
    related: nodes.map((node, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
      return {
        id: node.id,
        x: center.x + Math.cos(angle) * radiusX,
        y: center.y + Math.sin(angle) * radiusY,
        width: nodeWidth,
        height: nodeHeight,
      };
    }),
  };
}

function renderedPoint(point: ActivePoint, view: MapView, metrics: Pick<MapMetrics, "width" | "height">) {
  const center = { x: metrics.width / 2, y: metrics.height / 2 };
  return {
    x: center.x + view.pan.x + (point.x - center.x) * view.scale,
    y: center.y + view.pan.y + (point.y - center.y) * view.scale,
  };
}

function clampView(view: MapView, metrics: MapMetrics): MapView {
  const scale = clamp(view.scale, minScale, maxScale);
  const nodes = [metrics.layout.focus, ...metrics.layout.related];
  const centeredView = { scale, pan: { x: 0, y: 0 } };
  const bounds = nodes.reduce(
    (current, node) => {
      const point = renderedPoint(node, centeredView, metrics);
      return {
        left: Math.min(current.left, point.x - node.width / 2),
        right: Math.max(current.right, point.x + node.width / 2),
        top: Math.min(current.top, point.y - node.height / 2),
        bottom: Math.max(current.bottom, point.y + node.height / 2),
      };
    },
    {
      left: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );

  function clampAxis(value: number, start: number, end: number, viewportSize: number) {
    const minimum = mapVisibilityInset - end;
    const maximum = viewportSize - mapVisibilityInset - start;
    if (minimum > maximum) return (viewportSize - start - end) / 2;
    return clamp(value, minimum, maximum);
  }

  return {
    scale,
    pan: {
      x: clampAxis(view.pan.x, bounds.left, bounds.right, metrics.width),
      y: clampAxis(view.pan.y, bounds.top, bounds.bottom, metrics.height),
    },
  };
}

function zoomAroundAnchor(
  view: MapView,
  nextScaleValue: number,
  previousAnchor: ActivePoint,
  nextAnchor: ActivePoint,
  metrics: MapMetrics,
) {
  const nextScale = clamp(nextScaleValue, minScale, maxScale);
  const viewportCenter = { x: metrics.width / 2, y: metrics.height / 2 };
  const modelOffset = {
    x: (previousAnchor.x - viewportCenter.x - view.pan.x) / view.scale,
    y: (previousAnchor.y - viewportCenter.y - view.pan.y) / view.scale,
  };
  return clampView(
    {
      scale: nextScale,
      pan: {
        x: nextAnchor.x - viewportCenter.x - modelOffset.x * nextScale,
        y: nextAnchor.y - viewportCenter.y - modelOffset.y * nextScale,
      },
    },
    metrics,
  );
}

function NodeBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 shrink-0 items-center rounded-full border px-2.5 text-xs font-bold",
        "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
        "forced-colors:border-[ButtonText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]",
        className,
      )}
    >
      {label}
    </span>
  );
}

function MapLegend({ nodes, compact = false }: { nodes: DifferentialMapNode[]; compact?: boolean }) {
  const likelihoodCounts = nodes.reduce<Partial<Record<DifferentialLikelihood, number>>>((counts, node) => {
    counts[node.likelihood] = (counts[node.likelihood] ?? 0) + 1;
    return counts;
  }, {});
  const entries: Array<{ id: string; label: string; className: string; count: number | null }> = [
    { id: "focus", label: "Focus diagnosis", className: "bg-[color:var(--clinical-accent)]", count: null },
  ];
  const likelihoodEntries: Array<{ id: DifferentialLikelihood; className: string }> = [
    { id: "most-likely", className: "bg-[color:var(--clinical-accent)]" },
    {
      id: "possible",
      className: "border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]",
    },
    { id: "less-likely", className: "border border-[color:var(--border)] bg-[color:var(--surface-subtle)]" },
    { id: "must-not-miss", className: "bg-[color:var(--danger)]" },
  ];
  for (const entry of likelihoodEntries) {
    const count = likelihoodCounts[entry.id] ?? 0;
    if (count > 0) {
      entries.push({ id: entry.id, label: likelihoodLabels[entry.id], className: entry.className, count });
    }
  }

  return (
    <div
      role="group"
      aria-label="Map legend"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-[color:var(--text-muted)]",
        compact && "gap-x-3 text-2xs sm:text-xs",
      )}
    >
      {entries.map((entry) => (
        <span key={entry.id} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "h-3 w-3 rounded-sm forced-colors:border forced-colors:border-[ButtonText] forced-colors:bg-[Canvas]",
              entry.className,
            )}
          />
          {entry.label}
          {entry.count === null ? null : (
            <span className="nums font-bold text-[color:var(--text-heading)]">{entry.count}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function MapGraph({
  record,
  nodes,
  selectedId,
  onSelect,
  view = fitView,
  onViewChange,
  onReset,
  onMetricsChange,
  interactive = false,
  describedBy,
}: {
  record: DifferentialRecord;
  nodes: DifferentialMapNode[];
  selectedId: string;
  onSelect?: (node: SelectedNode) => void;
  view?: MapView;
  onViewChange?: (view: MapView) => void;
  onReset?: () => void;
  onMetricsChange?: (metrics: MapMetrics) => void;
  interactive?: boolean;
  describedBy?: string;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const activePointers = useRef(new Map<number, ActivePoint>());
  const lastPointer = useRef<ActivePoint | null>(null);
  const lastPinch = useRef<{ distance: number; center: ActivePoint } | null>(null);
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => {
      const rect = canvas.getBoundingClientRect();
      setViewport((current) => {
        const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
        return current.width === next.width && current.height === next.height ? current : next;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => buildMapLayout(viewport.width, viewport.height, nodes, interactive),
    [interactive, nodes, viewport.height, viewport.width],
  );
  const metrics = useMemo<MapMetrics>(
    () => ({ width: viewport.width, height: viewport.height, layout }),
    [layout, viewport.height, viewport.width],
  );

  useEffect(() => {
    if (metrics.width > 0 && metrics.height > 0) onMetricsChange?.(metrics);
  }, [metrics, onMetricsChange]);

  const handleWheel = useEventCallback((event: WheelEvent) => {
    if (!interactive) return;
    event.preventDefault();
    const anchor = localPoint(event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * 0.0015);
    const next = zoomAroundAnchor(viewRef.current, viewRef.current.scale * factor, anchor, anchor, metrics);
    viewRef.current = next;
    onViewChange?.(next);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel, interactive]);

  function localPoint(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  function commitView(next: MapView) {
    if (!interactive || !onViewChange || metrics.width <= 0 || metrics.height <= 0) return;
    const clamped = clampView(next, metrics);
    viewRef.current = clamped;
    onViewChange(clamped);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!interactive || (event.target instanceof HTMLElement && event.target.closest("button"))) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event.clientX, event.clientY);
    activePointers.current.set(event.pointerId, point);
    const pointers = Array.from(activePointers.current.values());
    if (pointers.length === 1) {
      lastPointer.current = point;
      lastPinch.current = null;
    } else if (pointers.length >= 2) {
      lastPinch.current = {
        distance: distance(pointers[0], pointers[1]),
        center: midpoint(pointers[0], pointers[1]),
      };
      lastPointer.current = null;
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!interactive || !activePointers.current.has(event.pointerId)) return;
    const point = localPoint(event.clientX, event.clientY);
    activePointers.current.set(event.pointerId, point);
    const pointers = Array.from(activePointers.current.values());

    if (pointers.length === 1 && lastPointer.current) {
      commitView({
        ...viewRef.current,
        pan: {
          x: viewRef.current.pan.x + point.x - lastPointer.current.x,
          y: viewRef.current.pan.y + point.y - lastPointer.current.y,
        },
      });
      lastPointer.current = point;
      return;
    }

    if (pointers.length >= 2 && lastPinch.current) {
      const nextDistance = distance(pointers[0], pointers[1]);
      const nextCenter = midpoint(pointers[0], pointers[1]);
      const ratio = nextDistance / Math.max(lastPinch.current.distance, 1);
      const next = zoomAroundAnchor(
        viewRef.current,
        viewRef.current.scale * ratio,
        lastPinch.current.center,
        nextCenter,
        metrics,
      );
      viewRef.current = next;
      onViewChange?.(next);
      lastPinch.current = { distance: nextDistance, center: nextCenter };
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    activePointers.current.delete(event.pointerId);
    const pointers = Array.from(activePointers.current.values());
    if (pointers.length === 1) {
      lastPointer.current = pointers[0];
      lastPinch.current = null;
    } else if (pointers.length >= 2) {
      lastPinch.current = {
        distance: distance(pointers[0], pointers[1]),
        center: midpoint(pointers[0], pointers[1]),
      };
      lastPointer.current = null;
    } else {
      lastPointer.current = null;
      lastPinch.current = null;
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!interactive || event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const panDelta: Record<string, ActivePoint> = {
      ArrowLeft: { x: 32, y: 0 },
      ArrowRight: { x: -32, y: 0 },
      ArrowUp: { x: 0, y: 32 },
      ArrowDown: { x: 0, y: -32 },
    };
    if (event.key in panDelta) {
      event.preventDefault();
      const delta = panDelta[event.key];
      commitView({
        ...viewRef.current,
        pan: { x: viewRef.current.pan.x + delta.x, y: viewRef.current.pan.y + delta.y },
      });
      return;
    }
    if (["+", "="].includes(event.key) || event.key === "-") {
      event.preventDefault();
      const anchor = { x: metrics.width / 2, y: metrics.height / 2 };
      const change = event.key === "-" ? -0.14 : 0.14;
      const next = zoomAroundAnchor(viewRef.current, viewRef.current.scale + change, anchor, anchor, metrics);
      viewRef.current = next;
      onViewChange?.(next);
      return;
    }
    if (event.key === "0" || event.key === "Home") {
      event.preventDefault();
      onReset?.();
    }
  }

  const focusPoint = renderedPoint(layout.focus, view, metrics);
  const relatedPoints = nodes.map((node, index) => ({
    node,
    layout: layout.related[index],
    point: renderedPoint(layout.related[index] ?? layout.focus, view, metrics),
  }));
  const minimumHeight =
    viewport.width > 0 && viewport.width < phoneLayoutBreakpoint
      ? mobileMapMinimumHeight(nodes.length, interactive)
      : interactive
        ? 360
        : 320;

  return (
    <div
      ref={canvasRef}
      data-testid={interactive ? "diagnosis-map-full-canvas" : "diagnosis-map-preview-canvas"}
      className={cn(
        "relative min-h-0 min-w-0 overflow-hidden rounded-lg border border-[color:var(--border)]",
        "bg-[color:var(--surface)] bg-[linear-gradient(90deg,color-mix(in_srgb,var(--border)_40%,transparent)_1px,transparent_1px),linear-gradient(color-mix(in_srgb,var(--border)_40%,transparent)_1px,transparent_1px)] bg-[length:28px_28px,28px_28px]",
        interactive &&
          "flex-1 cursor-grab outline-none active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
      )}
      style={{ minHeight: minimumHeight, touchAction: interactive ? "none" : "auto" }}
      // The preview is no longer a picture: its nodes are buttons, so it is a
      // group of controls rather than an `img`. A phone reader can select a
      // node and read the panel below without opening the fullscreen dialog,
      // which was previously the only way in.
      role={interactive ? "region" : onSelect ? "group" : "img"}
      aria-label={
        interactive
          ? "Interactive diagnosis relationship map"
          : onSelect
            ? `Diagnosis map for ${record.title}`
            : `Diagnosis map preview for ${record.title}`
      }
      aria-describedby={interactive ? describedBy : undefined}
      tabIndex={interactive ? 0 : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      {viewport.width > 0 && viewport.height > 0 ? (
        <>
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            {relatedPoints.map(({ node, point }) => {
              const isSelectedEdge = selectedId === node.id;
              return (
                <line
                  key={node.id}
                  x1={focusPoint.x}
                  y1={focusPoint.y}
                  x2={point.x}
                  y2={point.y}
                  stroke={lineTone[node.likelihood]}
                  strokeWidth={isSelectedEdge ? 3.5 : node.likelihood === "must-not-miss" ? 3 : 2}
                  strokeLinecap="round"
                  // A dashed edge for "less likely" gives the weakest tier a
                  // second channel besides colour, which is what forced-colors
                  // and greyscale printing are left with.
                  strokeDasharray={node.likelihood === "less-likely" ? "5 5" : undefined}
                  opacity={selectedId !== "diagnosis" && !isSelectedEdge ? 0.45 : 1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {onSelect ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelect("diagnosis");
              }}
              data-map-node="diagnosis"
              data-testid="diagnosis-map-node-diagnosis"
              className={cn(
                "absolute z-20 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg border-2",
                "bg-[color:var(--clinical-accent)] px-3 py-2 text-center font-bold leading-tight break-words text-[color:var(--clinical-accent-contrast)] shadow-[var(--shadow-elevated)]",
                "motion-safe:transition-[box-shadow,transform] hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--focus)]",
                "forced-colors:border-[ButtonText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]",
                selectedId === "diagnosis" &&
                  "outline outline-2 outline-offset-2 outline-[color:var(--clinical-accent)] forced-colors:outline-[Highlight]",
              )}
              style={{
                left: focusPoint.x,
                top: focusPoint.y,
                width: layout.focus.width,
                minHeight: layout.focus.height,
              }}
              aria-pressed={selectedId === "diagnosis"}
              aria-label={`Show details for ${record.title}`}
            >
              {interactive ? (
                <span className="text-2xs font-extrabold uppercase tracking-wide opacity-85">Focus diagnosis</span>
              ) : null}
              <span data-map-node-label className={interactive ? "text-xs sm:text-sm" : "text-2xs"}>
                {record.title}
              </span>
            </button>
          ) : (
            <div
              data-map-node="diagnosis"
              className="absolute z-20 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg border-2 border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] px-2 py-1.5 text-center text-2xs font-bold leading-tight break-words text-[color:var(--clinical-accent-contrast)] shadow-[var(--e2)] forced-colors:border-[ButtonText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]"
              style={{
                left: focusPoint.x,
                top: focusPoint.y,
                width: layout.focus.width,
                minHeight: layout.focus.height,
              }}
            >
              <span data-map-node-label>{record.title}</span>
            </div>
          )}

          {relatedPoints.map(({ node, layout: nodeLayout, point }) => {
            const isSelected = selectedId === node.id;
            const sharedClassName = cn(
              "absolute z-20 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg border px-2 py-1.5 text-center font-bold leading-tight break-words shadow-[var(--shadow-inset)]",
              likelihoodTone[node.likelihood],
              "forced-colors:border-[ButtonText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]",
            );
            const sharedStyle = {
              left: point.x,
              top: point.y,
              width: nodeLayout?.width ?? 120,
              minHeight: nodeLayout?.height ?? 72,
            };
            if (!onSelect) {
              return (
                <div
                  key={node.id}
                  data-map-node={node.id}
                  className={cn(sharedClassName, "text-2xs")}
                  style={sharedStyle}
                >
                  <span data-map-node-label>{node.label}</span>
                </div>
              );
            }
            return (
              <button
                key={node.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(node);
                }}
                data-map-node={node.id}
                data-testid={`diagnosis-map-node-${node.id}`}
                className={cn(
                  sharedClassName,
                  "motion-safe:transition-[box-shadow,transform] hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--focus)]",
                  isSelected &&
                    "outline outline-2 outline-offset-2 outline-[color:var(--focus)] forced-colors:outline-[Highlight]",
                )}
                style={sharedStyle}
                title={node.note}
                aria-pressed={isSelected}
                aria-label={`Show details for ${node.label}`}
              >
                {interactive ? (
                  <span className="flex items-center justify-center gap-1 text-3xs font-extrabold uppercase tracking-wide opacity-85">
                    {node.likelihood === "must-not-miss" ? <ShieldAlert className="h-3 w-3" aria-hidden /> : null}
                    {likelihoodLabels[node.likelihood]}
                  </span>
                ) : node.likelihood === "must-not-miss" ? (
                  <ShieldAlert className="h-3 w-3" aria-hidden />
                ) : null}
                <span data-map-node-label className={interactive ? "text-2xs sm:text-xs" : "text-2xs"}>
                  {node.label}
                </span>
              </button>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

function NodeInspector({
  record,
  selected,
  relatedMapDetails,
  compareIds,
  expanded,
  onExpandedChange,
  onToggleCompare,
}: {
  record: DifferentialRecord;
  selected: SelectedNode;
  relatedMapDetails: Record<string, DifferentialRelatedMapDetail>;
  compareIds: string[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onToggleCompare: (slug: string) => void;
}) {
  const inspectorRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const [isWideLayout, setIsWideLayout] = useState(false);
  const selectedIsDiagnosis = selected === "diagnosis";

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsWideLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const detail = selectedIsDiagnosis ? null : relatedMapDetails[selected.id];
  const title = selectedIsDiagnosis ? record.title : selected.label;
  const relationshipLabel = selectedIsDiagnosis ? "Focus diagnosis" : likelihoodLabels[selected.likelihood];
  const status = selectedIsDiagnosis ? record.status : detail?.status;
  const clinicalHinge = selectedIsDiagnosis ? record.clinicalHinge : detail?.clinicalHinge;
  // Every current record's hinge is its presentation group's. Heading it
  // "Clinical hinge" asserted it of the selected diagnosis, which is the
  // mismatch this labelling exists to remove.
  const hingeIsGroupScoped =
    (selectedIsDiagnosis ? record.clinicalHingeScope : detail?.clinicalHingeScope) === "presentation";
  const safetySummary = selectedIsDiagnosis ? record.safetySnapshot.summary : detail?.safetySummary;
  const selectedSlug = selectedIsDiagnosis ? record.slug : detail?.slug;
  const inCompare = Boolean(selectedSlug && compareIds.includes(selectedSlug));
  const compareHref = differentialSelectedCompareHref("", compareIds);

  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [title]);

  useEffect(() => {
    if (!expanded) return;
    const frame = window.requestAnimationFrame(() => {
      inspectorRef.current?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, title]);

  return (
    <section
      ref={inspectorRef}
      data-testid="diagnosis-map-node-details"
      aria-label={`Details for ${title}`}
      className={cn(
        "flex min-h-0 shrink-0 flex-col border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-elevated)]",
        "rounded-t-2xl lg:h-full lg:rounded-none lg:border-0 lg:border-l lg:shadow-none",
        expanded && "h-[min(44dvh,22rem)] lg:h-full",
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--border)] p-3 sm:p-4">
        <div className="min-w-0">
          <p className="text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
            {relationshipLabel}
          </p>
          <h3
            aria-live="polite"
            className="mt-1 text-lg font-bold leading-tight break-words text-[color:var(--text-heading)]"
          >
            {title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status ? <NodeBadge label={differentialStatusLabel(status)} className={statusTone[status]} /> : null}
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            aria-expanded={expanded}
            aria-controls={contentId}
            className={cn(toolbarButton, "lg:hidden")}
            aria-label={expanded ? "Collapse selected diagnosis details" : "Expand selected diagnosis details"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronUp className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </header>

      <div
        id={contentId}
        inert={!expanded && !isWideLayout ? true : undefined}
        className={cn("grid min-h-0 flex-1", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr] lg:grid-rows-[1fr]")}
      >
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div
            ref={bodyRef}
            data-testid="diagnosis-map-inspector-body"
            className="min-h-0 flex-1 overflow-y-auto p-3 polished-scroll sm:p-4"
          >
            <div className="grid gap-3">
              {!selectedIsDiagnosis ? (
                <div className="rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]/65 p-3">
                  <p className="text-xs font-bold text-[color:var(--clinical-accent)]">
                    Relationship to {record.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">{selected.note}</p>
                </div>
              ) : null}

              {clinicalHinge ? (
                <div className="rounded-lg border border-[color:var(--success)]/20 bg-[color:var(--success-soft)]/65 p-3">
                  <p className="flex items-center gap-2 text-sm font-bold text-[color:var(--success)]">
                    <CircleCheck className="h-4 w-4" aria-hidden />
                    {hingeIsGroupScoped ? "Presentation hinge" : "Clinical hinge"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">{clinicalHinge}</p>
                  {hingeIsGroupScoped ? (
                    <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">
                      Shared by every diagnosis in this presentation group, so it may describe another condition in it.
                      It is not specific to {title}.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {safetySummary ? (
                <div className="rounded-lg border border-[color:var(--danger)]/20 bg-[color:var(--danger-soft)]/65 p-3">
                  <p className="flex items-center gap-2 text-sm font-bold text-[color:var(--danger)]">
                    <ShieldAlert className="h-4 w-4" aria-hidden />
                    Must-not-miss for {title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">{safetySummary}</p>
                </div>
              ) : null}

              {!selectedIsDiagnosis && !detail ? (
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm leading-6 text-[color:var(--text-muted)]">
                  This relationship is available in the map, but this diagnosis does not currently resolve to a reviewed
                  catalogue page.
                </div>
              ) : null}
            </div>
          </div>

          <footer
            data-testid="diagnosis-map-inspector-actions"
            className="shrink-0 border-t border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 sm:p-4"
          >
            <div className="grid grid-cols-2 gap-2">
              {!selectedIsDiagnosis && selectedSlug ? (
                <button
                  type="button"
                  onClick={() => onToggleCompare(selectedSlug)}
                  aria-pressed={inCompare}
                  className={cn(floatingControl, "w-full px-3")}
                >
                  <GitCompareArrows className="h-4 w-4" aria-hidden />
                  {inCompare ? "Remove" : "Add to compare"}
                </button>
              ) : (
                <div className="flex min-h-tap items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 text-center text-xs font-bold text-[color:var(--text-muted)]">
                  {selectedIsDiagnosis ? "Focus diagnosis included" : "Catalogue page unavailable"}
                </div>
              )}

              {!selectedIsDiagnosis && selectedSlug ? (
                <Link href={`/differentials/diagnoses/${selectedSlug}`} className={cn(primaryControl, "w-full px-3")}>
                  Open diagnosis
                </Link>
              ) : compareIds.length >= 2 ? (
                <Link href={compareHref} className={cn(primaryControl, "w-full px-3")}>
                  Compare ({compareIds.length})
                </Link>
              ) : (
                <div className="flex min-h-tap items-center justify-center rounded-lg border border-dashed border-[color:var(--border)] px-3 text-center text-xs font-semibold text-[color:var(--text-muted)]">
                  Select a related diagnosis
                </div>
              )}
            </div>

            {compareIds.length >= 2 && !selectedIsDiagnosis ? (
              <Link href={compareHref} className={cn(primaryControl, "mt-2 w-full px-3")}>
                <GitCompareArrows className="h-4 w-4" aria-hidden />
                Compare ({compareIds.length})
              </Link>
            ) : null}
          </footer>
        </div>
      </div>
    </section>
  );
}

export function DiagnosisMapPanel({
  record,
  relatedMapDetails = {},
  knownRelatedSlugs,
  curated = null,
}: {
  record: DifferentialRecord;
  relatedMapDetails?: Record<string, DifferentialRelatedMapDetail>;
  /** Related ids verified against the catalogue. Defaults to the keys of
   *  `relatedMapDetails`, which the server builds from the same check. */
  knownRelatedSlugs?: readonly string[];
  /** This record's authored overlay entry, resolved server-side. */
  curated?: DifferentialCuratedEntry | null;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedNode>("diagnosis");
  const [view, setView] = useState<MapView>(fitView);
  const [metrics, setMetrics] = useState<MapMetrics | null>(null);
  const [filtered, setFiltered] = useState(false);
  const [selectedCompareIds, setSelectedCompareIds] = useState<string[]>([]);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const metricsSizeRef = useRef("");
  const helpId = useId();
  const selectedId = selected === "diagnosis" ? "diagnosis" : selected.id;
  const hasMustNotMiss = record.related.some((node) => node.likelihood === "must-not-miss");
  const visibleNodes = useMemo(
    () => record.related.filter((node) => !filtered || node.likelihood === "must-not-miss"),
    [filtered, record.related],
  );
  const discriminatorRows = useMemo(
    () =>
      buildDiscriminators(record, {
        knownRelatedSlugs: knownRelatedSlugs ?? Object.keys(relatedMapDetails),
        relatedMapDetails,
        curated,
      }),
    [curated, knownRelatedSlugs, record, relatedMapDetails],
  );
  const compareIds = useMemo(
    () => [record.slug, ...selectedCompareIds.filter((slug) => slug !== record.slug && relatedMapDetails[slug])],
    [record.slug, relatedMapDetails, selectedCompareIds],
  );

  const resetView = useCallback(() => setView(fitView), []);

  const handleMetricsChange = useCallback((nextMetrics: MapMetrics) => {
    const sizeKey = `${nextMetrics.width}x${nextMetrics.height}`;
    if (metricsSizeRef.current && metricsSizeRef.current !== sizeKey) setView(fitView);
    metricsSizeRef.current = sizeKey;
    setMetrics(nextMetrics);
  }, []);

  const handleSelect = useCallback((node: SelectedNode) => {
    setSelected(node);
    if (node !== "diagnosis") setInspectorExpanded(true);
  }, []);

  const changeScale = useCallback(
    (delta: number) => {
      if (!metrics) return;
      setView((current) => {
        const anchor = { x: metrics.width / 2, y: metrics.height / 2 };
        return zoomAroundAnchor(current, current.scale + delta, anchor, anchor, metrics);
      });
    },
    [metrics],
  );

  const focusSelected = useCallback(() => {
    if (!metrics) return;
    const selectedLayout =
      selected === "diagnosis" ? metrics.layout.focus : metrics.layout.related.find((node) => node.id === selected.id);
    if (!selectedLayout) {
      resetView();
      return;
    }
    const scale = 1.35;
    const viewportCenter = { x: metrics.width / 2, y: metrics.height / 2 };
    setView(
      clampView(
        {
          scale,
          pan: {
            x: -(selectedLayout.x - viewportCenter.x) * scale,
            y: -(selectedLayout.y - viewportCenter.y) * scale,
          },
        },
        metrics,
      ),
    );
  }, [metrics, resetView, selected]);

  function toggleCompare(slug: string) {
    if (!relatedMapDetails[slug]) return;
    setSelectedCompareIds((current) =>
      current.includes(slug) ? current.filter((id) => id !== slug) : [...current, slug],
    );
  }

  function toggleFilter() {
    if (!hasMustNotMiss) return;
    const nextFiltered = !filtered;
    if (nextFiltered && selected !== "diagnosis" && selected.likelihood !== "must-not-miss") {
      setSelected("diagnosis");
      setInspectorExpanded(false);
    }
    setFiltered(nextFiltered);
    setView(fitView);
  }

  return (
    <>
      <section
        aria-label="Diagnosis map"
        className="rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--e2)] sm:p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[color:var(--text-heading)]">Diagnosis map</h2>
            <p className="mt-1 text-xs font-semibold text-[color:var(--text-muted)] sm:text-sm sm:font-normal sm:leading-6">
              {record.related.length} related differential{record.related.length === 1 ? "" : "s"}
            </p>
          </div>
          <NodeBadge label={`${record.related.length + 1} diagnoses`} />
        </div>

        <div className="mt-3 grid gap-3 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] p-2.5 sm:p-3">
          <MapGraph record={record} nodes={record.related} selectedId={selectedId} onSelect={handleSelect} />
          <MapLegend nodes={record.related} compact />
          {record.related.length > 0 ? (
            <p className="text-2xs font-medium text-[color:var(--text-muted)]">
              Select a diagnosis to compare it below.
            </p>
          ) : null}
          <button
            ref={openButtonRef}
            type="button"
            aria-label="Open full diagnosis map"
            onClick={() => {
              // Selection carries into the dialog. Resetting it here meant a
              // node chosen on the preview was silently dropped the moment the
              // reader asked for a bigger view of the same thing.
              setView(fitView);
              setFiltered(false);
              setOpen(true);
            }}
            className={cn(floatingControl, "min-h-tap w-full justify-center px-3")}
            data-testid="open-diagnosis-map"
          >
            Open map
            <Maximize2 className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* The graph shows THAT two diagnoses are related. It cannot show how to
            tell them apart, which is the question a clinician is actually
            holding while looking at it — so that answer sits directly under the
            map rather than behind the fullscreen dialog. */}
        <DiagnosisMapInsights
          className="mt-3"
          record={record}
          rows={discriminatorRows}
          selectedSlug={selected === "diagnosis" ? null : selected.id}
          selectedNode={selected === "diagnosis" ? null : selected}
          relatedMapDetails={relatedMapDetails}
          provenanceLabel={curatedProvenanceFor(curated)}
          onSelect={(slug) => {
            const node = record.related.find((candidate) => candidate.id === slug);
            if (node) handleSelect(node);
          }}
        />
      </section>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Diagnosis map"
        description={`${record.title} · ${record.related.length} related differential${record.related.length === 1 ? "" : "s"}`}
        closeLabel="Close diagnosis map"
        mobilePlacement="fullscreen"
        contentClassName="lg:max-w-[var(--content-width-catalogue)]"
        headerClassName="pt-[max(1rem,env(safe-area-inset-top))] lg:pt-5"
        bodyClassName="p-0 overflow-y-auto lg:overflow-hidden"
        portal
        returnFocusRef={openButtonRef}
        testId="diagnosis-map-dialog"
        headerActions={
          <button type="button" onClick={resetView} className={toolbarButton} aria-label="Reset map view">
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
        }
      >
        <div className="flex h-full min-h-0 flex-col bg-[color:var(--background)]">
          <div className="shrink-0 border-b border-[color:var(--border)] bg-[color:var(--surface-raised)] p-2.5 sm:p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button type="button" onClick={resetView} className={cn(floatingControl, "min-h-tap px-3")}>
                  <Maximize2 className="h-4 w-4" aria-hidden />
                  Fit
                </button>
                <button type="button" onClick={focusSelected} className={cn(floatingControl, "min-h-tap px-3")}>
                  <Crosshair className="h-4 w-4" aria-hidden />
                  Focus
                </button>
                {hasMustNotMiss ? (
                  <button
                    type="button"
                    onClick={toggleFilter}
                    aria-pressed={filtered}
                    className={cn(
                      floatingControl,
                      "min-h-tap px-3",
                      filtered && "border-[color:var(--danger)] text-[color:var(--danger)]",
                    )}
                  >
                    <Filter className="h-4 w-4" aria-hidden />
                    <span className="max-[359px]:sr-only">Must-not-miss</span>
                  </button>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]">
                <button
                  type="button"
                  onClick={() => changeScale(-0.14)}
                  disabled={view.scale <= minScale + 0.001}
                  className={cn(
                    controlDisabled,
                    "grid h-tap w-tap place-items-center border-r border-[color:var(--border)] enabled:hover:bg-[color:var(--surface-subtle)]",
                  )}
                  aria-label="Zoom out"
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
                <output
                  aria-label="Map zoom"
                  className="min-w-12 px-2 text-center text-xs font-bold text-[color:var(--text-muted)]"
                >
                  {Math.round(view.scale * 100)}%
                </output>
                <button
                  type="button"
                  onClick={() => changeScale(0.14)}
                  disabled={view.scale >= maxScale - 0.001}
                  className={cn(
                    controlDisabled,
                    "grid h-tap w-tap place-items-center border-l border-[color:var(--border)] enabled:hover:bg-[color:var(--surface-subtle)]",
                  )}
                  aria-label="Zoom in"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <div className="mt-2">
              <MapLegend nodes={visibleNodes} />
            </div>
          </div>

          <div className="flex min-h-0 flex-none flex-col lg:grid lg:h-full lg:flex-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="flex min-h-[18rem] flex-none flex-col gap-2 p-2.5 sm:p-3 lg:min-h-0 lg:flex-1">
              <MapGraph
                record={record}
                nodes={visibleNodes}
                selectedId={selectedId}
                onSelect={handleSelect}
                view={view}
                onViewChange={setView}
                onReset={resetView}
                onMetricsChange={handleMetricsChange}
                interactive
                describedBy={helpId}
              />
              <p
                id={helpId}
                className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-center text-xs font-semibold text-[color:var(--text-muted)]"
              >
                <Move className="h-4 w-4 shrink-0" aria-hidden />
                Drag or use arrow keys to pan · pinch, scroll, or use buttons to zoom
              </p>
              {filtered ? (
                <p className="rounded-lg border border-[color:var(--danger)]/20 bg-[color:var(--danger-soft)]/50 p-2 text-center text-xs font-semibold leading-5 text-[color:var(--text-muted)]">
                  Showing {visibleNodes.length} must-not-miss differential{visibleNodes.length === 1 ? "" : "s"}. Turn
                  off the filter to restore the full map.
                </p>
              ) : null}
            </div>

            <NodeInspector
              record={record}
              selected={selected}
              relatedMapDetails={relatedMapDetails}
              compareIds={compareIds}
              expanded={inspectorExpanded}
              onExpandedChange={setInspectorExpanded}
              onToggleCompare={toggleCompare}
            />
          </div>
        </div>
      </Sheet>
    </>
  );
}

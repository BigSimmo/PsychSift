"use client";

import { CheckCircle2, Info, OctagonAlert, TriangleAlert, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { OverlayPortal } from "@/components/ui/overlay-root";
import { cn } from "@/components/ui-primitives";

export type ToastTone = "success" | "info" | "warning" | "danger";

export type Toast = {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  /** ms before auto-dismiss. Pass 0 to require an explicit dismiss. */
  duration?: number;
  /**
   * Bumped when an identical outcome is pushed again while still visible so the
   * polite region re-announces and the dismiss timer restarts.
   */
  announceKey?: number;
  /**
   * One optional labelled action, such as Undo. The label names what it does;
   * pressing it runs `onAction` and closes the toast.
   */
  action?: ToastAction;
  /** Called exactly once when the toast leaves, with the reason it left. */
  onClose?: (reason: ToastCloseReason) => void;
};

export type ToastAction = { label: string; onAction: () => void };
export type ToastCloseReason = "timeout" | "dismiss" | "action";

export type ToastInput = Omit<Toast, "id">;
export type ToastProviderProps = { children: ReactNode };
export type ToastApi = {
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
};

type ToastContextValue = {
  toasts: Toast[];
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
  close: (id: string, reason: ToastCloseReason) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON = {
  success: CheckCircle2,
  info: Info,
  warning: TriangleAlert,
  danger: OctagonAlert,
} as const;

const TONE_ACCENT: Record<ToastTone, string> = {
  success: "var(--success)",
  info: "var(--info)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

const TONE_TEXT: Record<ToastTone, string> = {
  success: "text-[color:var(--success)]",
  info: "text-[color:var(--info)]",
  warning: "text-[color:var(--warning)]",
  danger: "text-[color:var(--danger)]",
};

const DEFAULT_DURATION = 6000;
const MAX_VISIBLE_TOASTS = 5;

/**
 * Nothing in the system announced async outcomes: an upload that failed in the
 * background left no trace once its panel scrolled away. Wrap the surface (or the
 * app shell) in `ToastProvider` and call `useToast().push(...)` from the handler.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastsRef = useRef<Toast[]>([]);
  const counter = useRef(0);

  const close = useCallback((id: string, reason: ToastCloseReason) => {
    const leaving = toastsRef.current.find((toast) => toast.id === id);
    if (!leaving) return;
    const next = toastsRef.current.filter((toast) => toast.id !== id);
    toastsRef.current = next;
    setToasts(next);
    leaving.onClose?.(reason);
  }, []);

  const dismiss = useCallback((id: string) => close(id, "dismiss"), [close]);

  const push = useCallback((toast: ToastInput) => {
    // A toast that carries an action or a close callback is a distinct outcome
    // with its own consequence, so it is never merged into an identical-looking one.
    const mergeable = !toast.action && !toast.onClose;
    const duplicateIndex = !mergeable
      ? -1
      : toastsRef.current.findIndex(
          (current) =>
            !current.action &&
            !current.onClose &&
            current.tone === toast.tone &&
            current.title === toast.title &&
            current.body === toast.body,
        );
    if (duplicateIndex >= 0) {
      const duplicate = toastsRef.current[duplicateIndex]!;
      const refreshed: Toast = {
        ...duplicate,
        duration: toast.duration ?? duplicate.duration,
        announceKey: (duplicate.announceKey ?? 0) + 1,
      };
      const next = toastsRef.current.slice();
      next[duplicateIndex] = refreshed;
      toastsRef.current = next;
      setToasts(next);
      return duplicate.id;
    }
    counter.current += 1;
    const id = `toast-${counter.current}`;
    const all = [...toastsRef.current, { ...toast, id, announceKey: 0 }];
    const overflow = all.slice(0, Math.max(0, all.length - MAX_VISIBLE_TOASTS));
    const next = all.slice(-MAX_VISIBLE_TOASTS);
    toastsRef.current = next;
    setToasts(next);
    // A toast pushed off the stack still owes its caller the close callback.
    for (const dropped of overflow) dropped.onClose?.("timeout");
    return id;
  }, []);

  const value = useMemo(() => ({ toasts, push, dismiss, close }), [toasts, push, dismiss, close]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastRegion />
    </ToastContext.Provider>
  );
}

/** Like `useToast`, but returns null outside a `ToastProvider` instead of throwing. */
export function useOptionalToast(): ToastApi | null {
  const context = useContext(ToastContext);
  return context ? { push: context.push, dismiss: context.dismiss } : null;
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside a <ToastProvider>");
  return { push: context.push, dismiss: context.dismiss };
}

/**
 * Unified copy feedback hook.
 * Announces copy completion with a polite success toast lasting 3000ms.
 */
export function useCopyToast(): (customTitle?: string) => void {
  const toast = useOptionalToast();
  return useCallback(
    (customTitle?: string) => {
      if (!toast) return;
      toast.push({
        tone: "success",
        title: customTitle ?? "Copied to clipboard",
        duration: 3000,
      });
    },
    [toast],
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: (id: string, reason: ToastCloseReason) => void }) {
  const duration = toast.duration ?? DEFAULT_DURATION;
  // The timer pauses while the pointer or keyboard focus is on the toast, so an
  // action such as Undo cannot vanish while someone is reaching for it.
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(duration);

  useEffect(() => {
    remainingRef.current = duration;
  }, [duration, toast.announceKey]);

  useEffect(() => {
    if (duration <= 0 || paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => onClose(toast.id, "timeout"), remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [duration, onClose, paused, toast.id, toast.announceKey]);

  const Icon = TONE_ICON[toast.tone];

  return (
    <div
      data-testid="toast"
      data-tone={toast.tone}
      data-announce-key={toast.announceKey ?? 0}
      style={{ pointerEvents: "auto" }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      // Borderless floating surface: a hairline ring is its edge and the shadow is
      // its lift — never a border AND a shadow on one element (register #39/#40).
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg bg-[color:var(--surface-raised)] p-3 shadow-[var(--shadow-elevated)] ring-1 ring-[color:var(--border-lux)]"
    >
      <span
        aria-hidden
        className="mt-0.5 block h-[1.125rem] w-[3px] shrink-0 rounded-full"
        style={{ background: TONE_ACCENT[toast.tone] }}
      />
      <Icon aria-hidden="true" className={cn("mt-0.5 size-icon-md shrink-0", TONE_TEXT[toast.tone])} />
      <div className="min-w-0 flex-1">
        {/* Remount on announceKey so a repeated identical outcome re-enters the
            polite live region instead of staying silent while still visible. */}
        <p key={toast.announceKey ?? 0} className="text-sm font-semibold text-[color:var(--text-heading)]">
          {toast.title}
        </p>
        {toast.body ? (
          <p key={`body-${toast.announceKey ?? 0}`} className="mt-0.5 text-xs text-[color:var(--text-muted)]">
            {toast.body}
          </p>
        ) : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onAction();
            onClose(toast.id, "action");
          }}
          className="inline-flex min-h-tap shrink-0 items-center rounded-lg px-3 text-sm font-bold text-[color:var(--clinical-accent)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onClose(toast.id, "dismiss")}
        aria-label={`Dismiss: ${toast.title}`}
        className="grid size-tap shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        <X aria-hidden="true" className="size-icon-md" />
      </button>
    </div>
  );
}

const regionSubscribers = new Set<() => void>();
let activeToastRegionId: string | null = null;

function notifyRegionSubscribers() {
  for (const listener of regionSubscribers) {
    listener();
  }
}

/**
 * The live region itself. Rendered automatically by `ToastProvider`; exported so a
 * surface that owns its own portal can place it. `role="status"` + `aria-live="polite"`
 * so an outcome is announced without interrupting whatever the user is reading —
 * a failed upload is important, but it is not a reason to cut off a dose sentence.
 */
export function ToastRegion() {
  const context = useContext(ToastContext);
  const regionId = useId();

  const [isPrimary, setIsPrimary] = useState(() => {
    if (!activeToastRegionId) {
      activeToastRegionId = regionId;
      return true;
    }
    return activeToastRegionId === regionId;
  });

  useEffect(() => {
    const updatePrimary = () => {
      if (!activeToastRegionId) {
        activeToastRegionId = regionId;
        setIsPrimary(true);
      } else {
        setIsPrimary(activeToastRegionId === regionId);
      }
    };

    regionSubscribers.add(updatePrimary);
    updatePrimary();

    return () => {
      regionSubscribers.delete(updatePrimary);
      if (activeToastRegionId === regionId) {
        activeToastRegionId = null;
        notifyRegionSubscribers();
      }
    };
  }, [regionId]);

  if (!context || !isPrimary) return null;
  const { toasts, close } = context;

  const region = (
    <div
      data-testid="toast-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-relevant="additions text"
      className="pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-0 sm:items-end"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onClose={close} />
      ))}
    </div>
  );

  return (
    <OverlayPortal layer="toast" name="toast-region">
      {region}
    </OverlayPortal>
  );
}

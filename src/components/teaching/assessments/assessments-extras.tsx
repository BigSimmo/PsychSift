"use client";

import { Inbox, LayoutGrid } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
} from "react";

import { List, Row, SectionLabel, viewHref } from "@/components/teaching/assessments/assessments-parts";
import { UNDO_MS } from "@/components/teaching/use-delayed-post";
import { announce } from "@/components/ui/live-announcer";
import { useOptionalToast, type ToastApi } from "@/components/ui/toast";
import type { SupervisionLevel } from "@/lib/teaching/assessments/content";
import {
  extrasReducer,
  initialExtras,
  readyToSend,
  type ExtrasAction,
  type ExtrasState,
} from "@/lib/teaching/assessments/extras";
import { cleanFeedbackText, inboxRequests, isWaiting } from "@/lib/teaching/assessments/inbox";
import type { AssessmentsState } from "@/lib/teaching/assessments/model";
import { perthTime } from "@/lib/teaching/time";
import { useOnlineStatus } from "@/lib/use-online-status";

/*
 * Holds the inbox and overview's page-memory answers for the whole sample, so moving between screens keeps
 * what was sent or reminded. Like the rest of the sample, a reload starts again.
 */

export type SendEntry = { id: string; level: SupervisionLevel; text: string };

type ExtrasContextValue = {
  extras: ExtrasState;
  dispatchExtras: Dispatch<ExtrasAction>;
  /** Starts the 10-second pretend send for one or more answers, under one Undo message. */
  sendAnswers: (entries: readonly SendEntry[], title: string) => void;
};

const ExtrasContext = createContext<ExtrasContextValue | null>(null);

type UndoContext = {
  toast: ToastApi | null;
  dispatch: Dispatch<ExtrasAction>;
  /** False once Assessments has closed: nothing is dispatched or announced after that. */
  mounted: RefObject<boolean>;
  /** The Undo messages still showing. */
  pending: Set<string>;
};

/** Shows the Undo message for a pretend send, and commits the send only when the message's own time is up. */
function showUndo(context: UndoContext, entries: readonly SendEntry[], title: string, ms: number = UNDO_MS): void {
  const { toast, dispatch, mounted, pending } = context;
  const commit = () => {
    for (const entry of entries) dispatch({ type: "inbox-commit", id: entry.id });
  };
  if (!toast) {
    commit();
    return;
  }
  const pushedAt = Date.now();
  let id = "";
  id = toast.push({
    tone: "info",
    title,
    body: "Made-up: nothing reaches anyone.",
    duration: ms,
    action: {
      label: "Undo",
      onAction: () => {
        pending.delete(id);
        if (!mounted.current) return;
        for (const entry of entries) dispatch({ type: "inbox-undo", id: entry.id });
        announce("Not sent. Your answer is kept for when you reopen it.");
      },
    },
    onClose: (reason) => {
      if (!pending.delete(id) || !mounted.current || reason === "action") return;
      const elapsed = Date.now() - pushedAt;
      // Pushed off the stack by other messages before its time: put it back with the time it had left.
      if (reason === "timeout" && elapsed < ms) {
        showUndo(context, entries, title, ms - elapsed);
        return;
      }
      commit();
    },
  });
  pending.add(id);
}

/**
 * Owns the pretend sends for every assessments view, not only the inbox screen, so:
 * - an answer kept as To send while offline goes when the connection is back on any assessments screen;
 * - the send commits only when its Undo message has run its own 10 seconds (the message's timer pauses
 *   while it is touched or focused, so the send waits too); a message pushed off the stack early by other
 *   messages is put back with the time it had left, never treated as time up;
 * - leaving Assessments closes any Undo message still showing, so an Undo can never claim to keep an answer
 *   on a page that is gone. Like the rest of the sample, nothing was stored, so nothing is lost.
 */
export function AssessmentsExtrasProvider({ children }: { children: ReactNode }) {
  const [extras, dispatchExtras] = useReducer(extrasReducer, initialExtras);
  const toast = useOptionalToast();
  const toastRef = useRef(toast);
  const mounted = useRef(true);
  const pending = useRef(new Set<string>());
  const answersRef = useRef(extras.answers);

  useEffect(() => {
    toastRef.current = toast;
    answersRef.current = extras.answers;
  });

  const sendAnswers = useCallback((entries: readonly SendEntry[], title: string) => {
    if (!entries.length) return;
    const at = clockNow();
    const clean = entries.map((entry) => ({ ...entry, text: cleanFeedbackText(entry.text) }));
    for (const entry of clean) dispatchExtras({ type: "inbox-send", ...entry, at });
    showUndo({ toast: toastRef.current, dispatch: dispatchExtras, mounted, pending: pending.current }, clean, title);
  }, []);

  // Back online: everything kept as "To send" goes, under one Undo, wherever in Assessments the doctor is.
  // An answer with no supervision level is never given one: it stays as To send and says why.
  useEffect(() => {
    const onOnline = () => {
      const ready = readyToSend(answersRef.current);
      if (!ready.length) return;
      sendAnswers(
        ready,
        `Back online · sending ${ready.length === 1 ? "1 answer" : `${ready.length} answers`} in 10 s`,
      );
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sendAnswers]);

  useEffect(() => {
    mounted.current = true;
    const open = pending.current;
    return () => {
      mounted.current = false;
      for (const id of [...open]) {
        open.delete(id);
        toastRef.current?.dismiss(id);
      }
    };
  }, []);

  return <ExtrasContext.Provider value={{ extras, dispatchExtras, sendAnswers }}>{children}</ExtrasContext.Provider>;
}

export function useAssessmentsExtras(): ExtrasContextValue {
  const value = useContext(ExtrasContext);
  if (!value) throw new Error("useAssessmentsExtras needs AssessmentsExtrasProvider");
  return value;
}

/** The real time of day on this phone, "15:02", for "Reminded 15:02" and "Sent 15:02". */
export function clockNow(): string {
  return perthTime(new Date().toISOString());
}

/**
 * Null while online; offline, the time the connection went (or the page opened, if it opened offline), for
 * "Status as of 08:10". The browser's online flag is only a hint, so this changes words and pauses the
 * pretend sends, never anything stored.
 */
export function useOfflineSince(): string | null {
  const online = useOnlineStatus();
  const [openedAt] = useState(clockNow);
  const [since, setSince] = useState<string | null>(null);
  useEffect(() => {
    const onOffline = () => setSince(clockNow());
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, []);
  return online ? null : (since ?? openedAt);
}

/** The two added views, reached from the supervisor's home. */
export function AssessmentsSampleViewsNav({ s }: { s: AssessmentsState }) {
  const { extras } = useAssessmentsExtras();
  const waiting = inboxRequests(s, extras.answers).filter(isWaiting).length;
  return (
    <>
      <SectionLabel>More views</SectionLabel>
      <List>
        <Row
          icon={Inbox}
          title="Inbox"
          subtitle={
            waiting
              ? `${waiting} ${waiting === 1 ? "request" : "requests"} waiting · open one in a tap`
              : "Nothing waiting"
          }
          href={viewHref("inbox", { as: "supervisor" })}
        />
        <Row
          icon={LayoutGrid}
          title="Term overview"
          subtitle="Every doctor's assessments as status only · for a DCT or MEU"
          href={viewHref("overview", { as: "supervisor" })}
        />
      </List>
    </>
  );
}

"use client";

import { Download, Inbox, LayoutGrid } from "lucide-react";
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
} from "react";

import { rememberExtras, rememberedExtras } from "@/components/teaching/assessments/assess-memory";
import { List, Row, SectionLabel, viewHref } from "@/components/teaching/assessments/assessments-parts";
import { PendingSends, inUndoMessage } from "@/components/teaching/assessments/pending-sends";
import { UNDO_MS } from "@/components/teaching/use-delayed-post";
import { announce } from "@/components/ui/live-announcer";
import { useOptionalToast } from "@/components/ui/toast";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import type { SupervisionLevel } from "@/lib/teaching/assessments/content";
import {
  extrasReducer,
  initialExtras,
  readyToSend,
  settleForAnotherScreen,
  type ExtrasAction,
  type ExtrasState,
} from "@/lib/teaching/assessments/extras";
import { inboxRequests, isWaiting } from "@/lib/teaching/assessments/inbox";
import type { AssessmentsState } from "@/lib/teaching/assessments/model";
import { perthTime } from "@/lib/teaching/time";
import { useOnlineStatus } from "@/lib/use-online-status";

/*
 * Holds the inbox and overview's page-memory answers for the whole sample, so moving between screens keeps
 * what was sent or reminded. Like the rest of the sample, a reload starts again.
 */

export type SendEntry = { id: string; level: SupervisionLevel; text: string };

/** An Undo for something already done on the page (Later, Can't do, a reminder), taken back on tap. */
export type UndoOffer = {
  readonly title: string;
  readonly body: string;
  /** Puts it back. Runs only while Assessments is still open. */
  readonly undo: () => void;
  /** Said once it is put back. */
  readonly undone: string;
};

type ExtrasContextValue = {
  extras: ExtrasState;
  dispatchExtras: Dispatch<ExtrasAction>;
  /** Starts the 10-second pretend send for one or more answers, under one Undo message. */
  sendAnswers: (entries: readonly SendEntry[], title: string) => void;
  /** Takes back every send still in its 10 seconds, the inbox's own Undo beside "Sending". */
  undoSends: () => void;
  /** Shows an Undo message that closes, silently, if Assessments closes first. */
  offerUndo: (offer: UndoOffer) => void;
  /** The answer whose sheet is open, so a reconnect does not send an older copy from under it. */
  setEditing: (id: string | null) => void;
};

const ExtrasContext = createContext<ExtrasContextValue | null>(null);

const SENT_BODY = "Made-up: nothing reaches anyone.";

/**
 * Owns the pretend sends and every Undo message for all the assessments views, not only the inbox screen:
 * - each send runs on the provider's own clock (`PendingSends`), registered before its message shows, so the
 *   shared message stack pushing a message off can never drop, repeat or rush a send;
 * - one send per answer: an answer already sending, or already sent, is never sent again;
 * - an answer kept as To send while offline goes when the connection is back on any assessments screen, or
 *   when the page comes back into view online, unless its sheet is open (the doctor's newer words go instead);
 * - leaving Assessments closes every Undo message (sends, Later, Can't do and reminders), and nothing is
 *   dispatched or announced after that. Like the rest of the sample, nothing was stored, so nothing is lost.
 */
export function AssessmentsExtrasProvider({
  children,
  memoryKey,
}: {
  children: ReactNode;
  /**
   * The account's page-memory key. With it, the answers outlive this screen in this tab, so a doctor's own
   * page (`/teaching/assessments/trainee/[id]`) and the inbox show the same answers. Never stored.
   */
  memoryKey?: string;
}) {
  const [extras, dispatchExtras] = useReducer(extrasReducer, undefined, () => {
    const kept = memoryKey === undefined ? null : rememberedExtras(memoryKey);
    return kept ? settleForAnotherScreen(kept) : initialExtras;
  });
  useEffect(() => {
    if (memoryKey !== undefined) rememberExtras(memoryKey, extras);
  }, [memoryKey, extras]);
  const toast = useOptionalToast();
  const toastRef = useRef(toast);
  const mounted = useRef(true);
  const offers = useRef(new Set<string>());
  const answersRef = useRef(extras.answers);
  const editing = useRef<string | null>(null);
  // The send clock lives in a ref and is made on first use, outside render.
  const clockRef = useRef<PendingSends | null>(null);
  const sendClock = useCallback((): PendingSends => {
    clockRef.current ??= new PendingSends();
    return clockRef.current;
  }, []);

  useEffect(() => {
    toastRef.current = toast;
    answersRef.current = extras.answers;
  });

  useEffect(() => {
    sendClock().onDue = (send) => {
      if (!mounted.current) return;
      for (const id of send.ids) dispatchExtras({ type: "inbox-commit", id });
      if (send.toastId) toastRef.current?.dismiss(send.toastId);
    };
  }, [sendClock]);

  // Every send waits while the doctor touches or focuses an Undo message, as the message itself does.
  const hold = useRef({ pointer: false, focus: false });
  const recheckHold = useCallback(() => {
    // A message can leave while it is held (pushed off, or its send went). Read the page again rather than
    // wait for a pointer or focus event that may never come, so a send is never held by a message that is gone.
    hold.current.pointer = document.querySelector('[data-testid="toast"]:hover') !== null;
    hold.current.focus = inUndoMessage(document.activeElement);
    sendClock().hold(hold.current.pointer || hold.current.focus);
  }, [sendClock]);
  useEffect(() => {
    const sends = sendClock();
    const state = hold.current;
    const update = () => sends.hold(state.pointer || state.focus);
    const onOver = (event: PointerEvent) => {
      state.pointer = inUndoMessage(event.target);
      update();
    };
    const onOut = (event: PointerEvent) => {
      if (!inUndoMessage(event.relatedTarget)) state.pointer = false;
      update();
    };
    const onFocusIn = (event: FocusEvent) => {
      state.focus = inUndoMessage(event.target);
      update();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!inUndoMessage(event.relatedTarget)) state.focus = false;
      update();
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [sendClock]);

  const sendAnswers = useCallback(
    (entries: readonly SendEntry[], title: string) => {
      const sends = sendClock();
      // One send per answer: skip any already in its 10 seconds, or no longer waiting to go.
      const fresh = entries.filter((entry) => {
        const status = answersRef.current[entry.id]?.status ?? "waiting";
        return !sends.has(entry.id) && (status === "waiting" || status === "queued" || status === "later");
      });
      if (!fresh.length) return;
      const at = clockNow();
      // Saved exactly as typed. The patient-detail check reads a cleaned copy and never changes this text.
      for (const entry of fresh) dispatchExtras({ type: "inbox-send", ...entry, at });
      const key = sends.start(fresh.map((entry) => entry.id));
      const api = toastRef.current;
      if (!api) return;
      const toastId = api.push({
        tone: "info",
        title,
        body: SENT_BODY,
        // The provider's clock ends it, so the stack never times it out on its own.
        duration: 0,
        action: {
          label: "Undo",
          onAction: () => {
            const send = sends.cancel(key);
            if (!send || !mounted.current) return;
            for (const id of send.ids) dispatchExtras({ type: "inbox-undo", id });
            announce("Not sent. Your answer is kept for when you reopen it.");
          },
        },
        onClose: (reason) => {
          const send = sends.get(key);
          if (!send || reason === "action") return;
          // Dismissed by hand: it goes now. Pushed off the stack: it keeps its own time, Undo stays on the inbox.
          if (reason === "dismiss") sends.finishNow(key);
          else send.toastId = null;
          window.setTimeout(recheckHold, 0);
        },
      });
      const send = sends.get(key);
      if (send) send.toastId = toastId;
    },
    [sendClock, recheckHold],
  );

  const undoSends = useCallback(() => {
    const undone = sendClock().cancelAll();
    if (!undone.length) return;
    for (const send of undone) {
      for (const id of send.ids) dispatchExtras({ type: "inbox-undo", id });
      if (send.toastId) toastRef.current?.dismiss(send.toastId);
    }
    announce("Not sent. Your answer is kept for when you reopen it.");
  }, [sendClock]);

  const offerUndo = useCallback((offer: UndoOffer) => {
    const api = toastRef.current;
    if (!api) return;
    let id = "";
    id = api.push({
      tone: "info",
      title: offer.title,
      body: offer.body,
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onAction: () => {
          if (!mounted.current) return;
          offer.undo();
          announce(offer.undone);
        },
      },
      onClose: () => offers.current.delete(id),
    });
    offers.current.add(id);
  }, []);

  const setEditing = useCallback((id: string | null) => {
    editing.current = id;
  }, []);

  // Back online: everything kept as "To send" goes, under one Undo, wherever in Assessments the doctor is. The
  // page coming back into view online does the same, in case the browser missed the online event while the tab
  // slept. An answer with no supervision level is never given one: it stays as To send and says why.
  useEffect(() => {
    const sends = sendClock();
    const flush = () => {
      if (!navigator.onLine) return;
      const ready = readyToSend(answersRef.current).filter(
        (entry) => entry.id !== editing.current && !sends.has(entry.id),
      );
      if (!ready.length) return;
      sendAnswers(
        ready,
        `Back online · sending ${ready.length === 1 ? "1 answer" : `${ready.length} answers`} in 10 s`,
      );
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") flush();
    };
    window.addEventListener("online", flush);
    window.addEventListener("pageshow", flush);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("pageshow", flush);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sendAnswers, sendClock]);

  useEffect(() => {
    mounted.current = true;
    const open = offers.current;
    return () => {
      mounted.current = false;
      for (const send of sendClock().cancelAll()) if (send.toastId) toastRef.current?.dismiss(send.toastId);
      for (const id of [...open]) {
        open.delete(id);
        toastRef.current?.dismiss(id);
      }
    };
  }, [sendClock]);

  return (
    <ExtrasContext.Provider value={{ extras, dispatchExtras, sendAnswers, undoSends, offerUndo, setEditing }}>
      {children}
    </ExtrasContext.Provider>
  );
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
  // These are new work mode screens: a reader on the classic work mode is not sent to them.
  const visible = useWorkModeRouteVisible();
  const inboxHref = viewHref("inbox", { as: "supervisor" });
  const overviewHref = viewHref("overview", { as: "supervisor" });
  const exportHref = "/teaching/assessments/export";
  if (!visible(inboxHref) && !visible(overviewHref) && !visible(exportHref)) return null;
  return (
    <>
      <SectionLabel>More views</SectionLabel>
      <List>
        {visible(inboxHref) ? (
          <Row
            icon={Inbox}
            title="Inbox"
            subtitle={
              waiting
                ? `${waiting} ${waiting === 1 ? "request" : "requests"} waiting · open one in a tap`
                : "Nothing waiting"
            }
            href={inboxHref}
          />
        ) : null}
        {visible(overviewHref) ? (
          <Row
            icon={LayoutGrid}
            title="Term overview"
            subtitle="Every doctor's assessments as status only · for a DCT or MEU"
            href={overviewHref}
          />
        ) : null}
        {visible(exportHref) ? (
          <Row icon={Download} title="Export" subtitle="Spreadsheets and forms" href={exportHref} />
        ) : null}
      </List>
    </>
  );
}

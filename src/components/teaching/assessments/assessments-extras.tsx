"use client";

import { Inbox, LayoutGrid } from "lucide-react";
import { createContext, useContext, useEffect, useReducer, useState, type Dispatch, type ReactNode } from "react";

import { List, Row, SectionLabel, viewHref } from "@/components/teaching/assessments/assessments-parts";
import { extrasReducer, initialExtras, type ExtrasAction, type ExtrasState } from "@/lib/teaching/assessments/extras";
import { inboxRequests, isWaiting } from "@/lib/teaching/assessments/inbox";
import type { AssessmentsState } from "@/lib/teaching/assessments/model";
import { perthTime } from "@/lib/teaching/time";
import { useOnlineStatus } from "@/lib/use-online-status";

/*
 * Holds the inbox and overview's page-memory answers for the whole sample, so moving between screens keeps
 * what was sent or reminded. Like the rest of the sample, a reload starts again.
 */

type ExtrasContextValue = { extras: ExtrasState; dispatchExtras: Dispatch<ExtrasAction> };

const ExtrasContext = createContext<ExtrasContextValue | null>(null);

export function AssessmentsExtrasProvider({ children }: { children: ReactNode }) {
  const [extras, dispatchExtras] = useReducer(extrasReducer, initialExtras);
  return <ExtrasContext.Provider value={{ extras, dispatchExtras }}>{children}</ExtrasContext.Provider>;
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

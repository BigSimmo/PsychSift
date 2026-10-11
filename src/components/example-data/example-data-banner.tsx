"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { WorkButton, useWorkUndoToast } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { EXAMPLE_BLOCKED_EVENT, type ExampleBlockedAction } from "@/lib/example-data/guards";
import { restoreExampleData, snapshotExampleData, syncExampleCookie, useExampleData } from "@/lib/example-data/store";
import type { WorkAreaId } from "@/lib/work-frame/areas";

/** How the sheet words each blocked action: the title's past tense, and the body's verb. */
const BLOCKED_WORDS: Readonly<Record<ExampleBlockedAction, { readonly done: string; readonly verb: string }>> = {
  export: { done: "exported", verb: "export" },
  share: { done: "shared", verb: "share" },
  save: { done: "saved", verb: "save" },
  send: { done: "sent", verb: "send" },
  copy: { done: "copied", verb: "copy" },
};

function isBlockedAction(value: unknown): value is ExampleBlockedAction {
  return typeof value === "string" && value in BLOCKED_WORDS;
}

/**
 * The example data host under the work frame's band. It draws no notice: the
 * owner asked (10 Oct 2026) that nothing on screen calls the data example or
 * made-up. Example data is switched off, and signed in to, from Settings.
 *
 * It hosts the sheet that explains a blocked export, share, save, send or
 * copy: `guardExampleAction(active, kind)` fires `EXAMPLE_BLOCKED_EVENT`, and
 * this opens "Example data can't be exported" with a way to turn it off. All
 * of it is local, so it works offline.
 *
 * Mounted always, it keeps
 * the server's example data cookie in step with what this browser shows, and
 * refreshes server-rendered areas (Teaching, CPD) when that changes.
 */
export function ExampleDataBanner({ area }: { readonly area: WorkAreaId }) {
  const { activeAreas, turnOff } = useExampleData(area);
  const router = useRouter();
  const toast = useWorkUndoToast();
  // A string key, so the effect runs when the set of areas changes, not on every new array.
  const activeKey = activeAreas.join(".");
  const [blocked, setBlocked] = useState<ExampleBlockedAction | null>(null);
  // Kept after the sheet closes so its words do not change while it leaves.
  const [lastBlocked, setLastBlocked] = useState<ExampleBlockedAction>("export");

  useEffect(() => {
    function onBlocked(event: Event) {
      const kind = (event as CustomEvent<unknown>).detail;
      const next = isBlockedAction(kind) ? kind : "export";
      setLastBlocked(next);
      setBlocked(next);
    }
    window.addEventListener(EXAMPLE_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(EXAMPLE_BLOCKED_EVENT, onBlocked);
  }, []);

  // Runs after every render (the store re-renders this on every change, account
  // switches included). The sync is a string compare, and refreshes only when
  // the server's cookie actually changed.
  useEffect(() => {
    const areas = activeKey ? (activeKey.split(".") as WorkAreaId[]) : [];
    if (syncExampleCookie(areas)) router.refresh();
  });

  const switchOff = useCallback(() => {
    // Undo puts back exactly what was there, so auto mode returns to auto
    // rather than becoming an explicit on.
    // The cookie sync above refreshes server-rendered areas for both.
    const before = snapshotExampleData();
    turnOff();
    toast?.("Example data off", () => restoreExampleData(before));
  }, [toast, turnOff]);

  const closeSheet = useCallback(() => setBlocked(null), []);
  const turnOffFromSheet = useCallback(() => {
    setBlocked(null);
    switchOff();
  }, [switchOff]);

  const words = BLOCKED_WORDS[blocked ?? lastBlocked];

  return (
    <Sheet
      open={blocked !== null}
      onClose={closeSheet}
      title={`Example data can't be ${words.done}`}
      testId="example-blocked-sheet"
      contentClassName="work-more-sheet"
      headerClassName="work-more-sheet__header"
      titleClassName="work-more-sheet__title"
      closeButtonClassName="work-more-sheet__close"
      bodyClassName="work-more-sheet__body"
    >
      <p className="mt-0 mb-4 text-sm-minus leading-normal text-[color:var(--text)]">
        Turn it off to {words.verb} your own records.
      </p>
      <div className="grid gap-2">
        <WorkButton size="wide" onClick={turnOffFromSheet}>
          Turn off example data
        </WorkButton>
        <WorkButton size="wide" variant="secondary" onClick={closeSheet}>
          Cancel
        </WorkButton>
      </div>
    </Sheet>
  );
}

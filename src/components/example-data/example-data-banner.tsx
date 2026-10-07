"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { WorkButton, WorkTag, useWorkUndoToast } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { EXAMPLE_BLOCKED_EVENT, type ExampleBlockedAction } from "@/lib/example-data/guards";
import {
  restoreExampleData,
  snapshotExampleData,
  syncExampleCookie,
  useAuthIfAvailable,
  useExampleData,
} from "@/lib/example-data/store";
import type { WorkAreaId } from "@/lib/work-frame/areas";

// Loaded only when a signed-out visitor taps Sign in.
const AccountSetupDialog = dynamic(
  () => import("@/components/clinical-dashboard/account-setup-dialog").then((m) => m.AccountSetupDialog),
  { ssr: false },
);

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
 * The slim strip under the work frame's band while an area shows example data
 * (setup mockup, "Example data" frames). One mount, under the band: pages
 * never draw their own. Turn off switches example data off everywhere and
 * offers Undo.
 *
 * It also hosts the sheet that explains a blocked export, share, save, send or
 * copy: `guardExampleAction(active, kind)` fires `EXAMPLE_BLOCKED_EVENT`, and
 * this opens "Example data can't be exported" with a way to turn it off. All
 * of it is local, so it works offline.
 *
 * Mounted always (it draws nothing while the area shows real data), it keeps
 * the server's example data cookie in step with what this browser shows, and
 * refreshes server-rendered areas (Teaching, CPD) when that changes.
 */
export function ExampleDataBanner({ area }: { readonly area: WorkAreaId }) {
  const { active, activeAreas, turnOff } = useExampleData(area);
  const router = useRouter();
  const toast = useWorkUndoToast();
  // A string key, so the effect runs when the set of areas changes, not on every new array.
  const activeKey = activeAreas.join(".");
  const auth = useAuthIfAvailable();
  // The per-area sample notices carried the only sign-in prompt, so the banner offers it instead.
  const signedOut = auth?.status === "signed_out" || auth?.status === "expired";
  const [signInOpen, setSignInOpen] = useState(false);
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

  useEffect(() => {
    const areas = activeKey ? (activeKey.split(".") as WorkAreaId[]) : [];
    if (syncExampleCookie(areas)) router.refresh();
  }, [activeKey, router]);

  const switchOff = useCallback(() => {
    // Undo puts back exactly what was there, so auto mode returns to auto
    // rather than becoming an explicit on.
    const before = snapshotExampleData();
    turnOff();
    router.refresh();
    toast?.("Example data off", () => {
      restoreExampleData(before);
      router.refresh();
    });
  }, [router, toast, turnOff]);

  const closeSheet = useCallback(() => setBlocked(null), []);
  const turnOffFromSheet = useCallback(() => {
    setBlocked(null);
    switchOff();
  }, [switchOff]);

  const words = BLOCKED_WORDS[blocked ?? lastBlocked];

  return (
    <>
      {active ? (
        <div
          role="region"
          aria-label="Example data"
          data-testid="example-data-banner"
          className="flex min-h-12 items-center gap-2 border-b border-[color:var(--work-line,var(--border))] bg-[color:var(--work-surface,var(--surface-raised))] pr-1 pl-3.5"
        >
          <WorkTag tone="amber">Example</WorkTag>
          <p className="m-0 min-w-0 flex-1 py-1.5 text-xs leading-snug font-medium text-[color:var(--text)]">
            Made-up data to look around. Nothing is saved.
          </p>
          {signedOut ? (
            <button
              type="button"
              onClick={() => setSignInOpen(true)}
              data-testid="example-data-banner-sign-in"
              className="inline-flex min-h-12 flex-none items-center rounded-full px-3 text-sm-minus font-bold text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--mode-identity)]"
            >
              Sign in
            </button>
          ) : null}
          <button
            type="button"
            onClick={switchOff}
            aria-label="Turn off example data"
            className="inline-flex min-h-12 flex-none items-center rounded-full px-3 text-sm-minus font-bold text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--mode-identity)]"
          >
            Turn off
          </button>
        </div>
      ) : null}
      {signInOpen ? <AccountSetupDialog open onClose={() => setSignInOpen(false)} /> : null}
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
    </>
  );
}

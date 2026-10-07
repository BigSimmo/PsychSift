"use client";

import { Copy, Share2 } from "lucide-react";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { useOptionalToast } from "@/components/ui/toast";
import { rosterShareText, type ShareShift } from "@/lib/roster/share-text";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";

/**
 * "Share my shifts": the doctor's own next 7 or 14 days as plain text, shown
 * before it leaves the device, then handed to the system share sheet or copied.
 * A cancelled share says nothing. When neither share nor copy works, the text
 * is selected on screen with a line saying so, so it can still be copied by hand.
 */

type Span = 7 | 14;

export function RosterShareButton({
  shifts,
  now,
  testId = "roster-share",
  trigger,
}: {
  readonly shifts: readonly ShareShift[];
  readonly now: Date;
  readonly testId?: string;
  /** Draws the opener instead of the default button (a list row on Shifts). */
  readonly trigger?: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Example records never leave the app: copy and share open the "can't be exported" sheet instead.
  const { active: example } = useExampleData("rost");
  const [days, setDays] = useState<Span>(7);
  const [manual, setManual] = useState(false);
  const preview = useRef<HTMLTextAreaElement>(null);
  const previewId = useId();
  const toast = useOptionalToast();
  const text = useMemo(() => rosterShareText(shifts, { from: now, days }), [shifts, now, days]);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  function selectForManualCopy() {
    setManual(true);
    const node = preview.current;
    if (node) {
      node.focus();
      node.select();
    }
    announce("Couldn't copy. The text is selected so you can copy it yourself.");
  }

  function copied() {
    setManual(false);
    if (toast) toast.push({ tone: "success", title: "Copied" });
    else announce("Copied");
  }

  function copy() {
    if (!guardExampleAction(example, "copy")) return;
    // Called straight from the click so the browser treats it as a user gesture.
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      selectForManualCopy();
      return;
    }
    clipboard.writeText(text).then(copied, selectForManualCopy);
  }

  function openSheet() {
    setManual(false);
    setOpen(true);
  }

  function share() {
    if (!guardExampleAction(example, "share")) return;
    navigator.share({ text }).then(
      () => setManual(false),
      (error: unknown) => {
        // The reader closed the share sheet: nothing went wrong, so say nothing.
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        copy();
      },
    );
  }

  return (
    <>
      {trigger ? (
        trigger(openSheet)
      ) : (
        <Button icon={Share2} variant="secondary" data-testid={testId} onClick={openSheet}>
          Share my shifts
        </Button>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Share my shifts"
        description="Only your own shifts. Times are Perth time."
        mobilePlacement="bottom"
        testId={`${testId}-sheet`}
      >
        <div className="grid gap-3">
          <SegmentedControl
            label="Choose how far ahead"
            value={String(days)}
            onChange={(value) => {
              setManual(false);
              setDays(value === "14" ? 14 : 7);
            }}
            options={[
              { value: "7", label: "Next 7 days" },
              { value: "14", label: "Next 14 days" },
            ]}
          />
          <label htmlFor={previewId} className="grid gap-1 text-sm text-[color:var(--text-muted)]">
            Preview
            <textarea
              id={previewId}
              ref={preview}
              readOnly
              value={text}
              rows={Math.min(days + 1, 10)}
              data-testid={`${testId}-preview`}
              className="w-full min-w-0 resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 font-mono text-sm text-[color:var(--text)]"
            />
          </label>
          {manual ? (
            <InlineNotice tone="warning">
              Couldn&apos;t copy automatically. The text above is selected — copy it from there.
            </InlineNotice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canShare ? (
              <Button icon={Share2} variant="primary" onClick={share} data-testid={`${testId}-share`}>
                Share
              </Button>
            ) : null}
            <Button
              icon={Copy}
              variant={canShare ? "secondary" : "primary"}
              onClick={copy}
              data-testid={`${testId}-copy`}
            >
              Copy
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

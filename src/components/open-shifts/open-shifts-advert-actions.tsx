"use client";

import { CalendarPlus, Check, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useRosterNow } from "@/components/roster/roster-format";
import { downloadTextFile } from "@/lib/admin/download-file";
import { icsFileName, toIcs } from "@/lib/calendar/ics";
import type { OpenShiftListing } from "@/lib/open-shifts/model";
import { openShiftCalendarEvent, openShiftShareText } from "@/lib/open-shifts/share";

import { advertHref } from "./open-shifts-ui";

/** How long "Copied to share" (or a failed copy) shows before the button reads as itself again. */
const COPY_STATUS_MS = 4000;

const action =
  "inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-[color:var(--border-strong)] px-3 text-sm font-semibold text-[color:var(--text-heading)] focus-visible:outline-2 focus-visible:outline-[color:var(--mode-identity)]";

/**
 * Share a shift with a colleague, and put a booked one in your phone's calendar
 * (12 Oct 2026). Sharing sends only what the advert shows; the calendar file is
 * made on this phone and nothing is sent anywhere.
 */
export function OpenShiftsAdvertActions({
  listing,
  booked,
  sample,
}: {
  readonly listing: OpenShiftListing;
  /** Example data: a made-up shift is never shared or put in a real calendar. */
  readonly sample: boolean;
  /** Approved for you: the calendar button shows. */
  readonly booked: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const now = useRosterNow();
  // Reset, so a later tap is never shown as the earlier one's result.
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), COPY_STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  // A shift that has started can't be asked for, so it isn't passed on.
  const shareable = listing.status === "open" && !listing.claimedByMe && Date.parse(listing.startsAt) > now.getTime();
  if (sample || (!shareable && !booked)) return null;

  async function share() {
    setCopyStatus("idle");
    const link = `${window.location.origin}${advertHref(listing)}`;
    const text = openShiftShareText(listing, link);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Open shift", text });
        return;
      } catch (error) {
        // A dismissed share sheet is not an error. Any other failure falls back to copying.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  function addToCalendar() {
    const event = openShiftCalendarEvent(listing);
    downloadTextFile(toIcs([event]), icsFileName(event.title), "text/calendar;charset=utf-8");
  }

  return (
    <div className="flex gap-2 px-3 pt-3" data-testid="open-shifts-advert-actions">
      {booked ? (
        <button type="button" className={action} onClick={addToCalendar}>
          <CalendarPlus aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
          Add to calendar
        </button>
      ) : null}
      {shareable ? (
        <button type="button" className={action} onClick={() => void share()}>
          {copyStatus === "copied" ? (
            <Check aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
          ) : (
            <Share2 aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
          )}
          <span>
            {copyStatus === "copied"
              ? "Copied to share"
              : copyStatus === "failed"
                ? "Could not copy"
                : "Share with a colleague"}
          </span>
        </button>
      ) : null}
      {/* Outside the button, so its text is never part of the button's name. */}
      {shareable ? (
        <span aria-live="polite" className="sr-only" data-testid="open-shifts-share-status">
          {copyStatus === "copied"
            ? "Copied to share"
            : copyStatus === "failed"
              ? "Could not copy the shift. Try again."
              : ""}
        </span>
      ) : null}
    </div>
  );
}

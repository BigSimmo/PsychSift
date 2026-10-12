"use client";

import { CalendarPlus, Check, Share2 } from "lucide-react";
import { useState } from "react";

import { downloadTextFile } from "@/lib/admin/download-file";
import { icsFileName, toIcs } from "@/lib/calendar/ics";
import type { OpenShiftListing } from "@/lib/open-shifts/model";
import { openShiftCalendarEvent, openShiftShareText } from "@/lib/open-shifts/share";

import { advertHref } from "./open-shifts-ui";

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
}: {
  readonly listing: OpenShiftListing;
  /** Approved for you: the calendar button shows. */
  readonly booked: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const shareable = listing.status === "open" && !listing.claimedByMe;
  if (!shareable && !booked) return null;

  async function share() {
    const link = `${window.location.origin}${advertHref(listing)}`;
    const text = openShiftShareText(listing, link);
    if (typeof navigator.share === "function") {
      // A dismissed share sheet is not an error.
      await navigator.share({ title: "Open shift", text }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
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
          {copied ? (
            <Check aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
          ) : (
            <Share2 aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
          )}
          <span>{copied ? "Copied to share" : "Share with a colleague"}</span>
          <span aria-live="polite" className="sr-only">
            {copied ? "Copied to share" : ""}
          </span>
        </button>
      ) : null}
    </div>
  );
}

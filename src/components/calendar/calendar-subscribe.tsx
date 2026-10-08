"use client";

import { CalendarPlus, Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { cardSurface } from "@/components/card-recipes";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, InlineNotice, textMuted } from "@/components/ui-primitives";

/**
 * SUBSCRIBE — a private link the owner's own calendar app (Google, Outlook,
 * Apple) reads every few hours, so CME deadlines, routines, their On Call
 * teaching list and the Teaching sessions they chose to add appear there
 * without exporting again. See `@/lib/calendar/feed-repository` for exactly
 * what a feed carries.
 *
 * The link is shown once, straight after it is made: only a hash of it is
 * stored, so it cannot be shown again. Losing it, or worrying it was shared,
 * means making a new one, which turns the old one off.
 */

type Status = "loading" | "unavailable" | "none" | "active" | "error";

export function calendarSubscriptionLinks(origin: string, path: string) {
  const https = new URL(path, origin).toString();
  const webcal = https.replace(/^https?:\/\//, "webcal://");
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=PsychSift`,
  };
}

async function readMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message ?? `${fallback} (${response.status}).`;
}

export function CalendarSubscribe({ testId = "calendar-subscribe" }: { testId?: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [links, setLinks] = useState<ReturnType<typeof calendarSubscriptionLinks> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "off" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/calendar/feed", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readMessage(response, "Could not check your calendar link"));
        return (await response.json()) as { subscribed: boolean; available: boolean };
      })
      .then((body) => {
        if (cancelled) return;
        setStatus(!body.available ? "unavailable" : body.subscribed ? "active" : "none");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function makeLink() {
    setBusy(true);
    setMessage(null);
    setCopied(false);
    try {
      const response = await fetch("/api/calendar/feed", { method: "POST" });
      if (!response.ok) throw new Error(await readMessage(response, "Could not make a calendar link"));
      const { path } = (await response.json()) as { path: string };
      setLinks(calendarSubscriptionLinks(window.location.origin, path));
      setStatus("active");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not make a calendar link.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/calendar/feed", { method: "DELETE" });
      if (!response.ok) throw new Error(await readMessage(response, "Could not turn the link off"));
      setLinks(null);
      setStatus("none");
      setMessage("Link turned off. Calendars using it stop updating.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not turn the link off.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function copy() {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.https);
      setCopied(true);
    } catch {
      setMessage("Could not copy. Press and hold the link below to copy it.");
    }
  }

  if (status === "unavailable") return null;

  return (
    <section data-testid={testId} aria-labelledby={`${testId}-title`} className={cn(cardSurface, "mt-5 p-4")}>
      <h2 id={`${testId}-title`} className="text-base font-semibold text-[color:var(--text)]">
        Keep your calendar up to date automatically
      </h2>
      <p className={cn(textMuted, "mt-1 text-sm")}>
        One private link keeps Google, Outlook or Apple Calendar up to date with your CPD deadlines, routines and
        teaching sessions, including Teaching sessions you chose to add. Cancelled sessions show as cancelled. It never
        includes your logged activities, attendance, join links, personal entries or anything about patients. Anyone
        with the link can see those dates, so keep it to yourself.
      </p>

      {status === "loading" ? (
        <p className={cn(textMuted, "mt-3 text-sm")} data-testid={`${testId}-loading`}>
          Checking your link…
        </p>
      ) : null}
      {status === "error" ? (
        <div className="mt-3">
          <InlineNotice tone="warning">Couldn&rsquo;t check your calendar link. Try again later.</InlineNotice>
        </div>
      ) : null}

      {links ? (
        <div className="mt-4 flex flex-col gap-3" data-testid={`${testId}-links`}>
          <p className="text-sm font-medium text-[color:var(--text)]">
            Your link is ready. Add it now: it is shown only this once.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={links.google}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonFaceClass({ variant: "secondary", size: "sm" })}
              data-testid={`${testId}-google`}
            >
              Google Calendar
            </a>
            <a
              href={links.outlook}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonFaceClass({ variant: "secondary", size: "sm" })}
              data-testid={`${testId}-outlook`}
            >
              Outlook
            </a>
            <a
              href={links.webcal}
              className={buttonFaceClass({ variant: "secondary", size: "sm" })}
              data-testid={`${testId}-apple`}
            >
              Apple Calendar
            </a>
            <Button variant="secondary" size="sm" icon={Copy} onClick={copy} testId={`${testId}-copy`}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className={cn(textMuted, "break-all text-xs")} data-testid={`${testId}-url`}>
            {links.https}
          </p>
          <p className={cn(textMuted, "text-xs")}>
            Calendars check for changes every few hours, so a new date can take a while to appear.
          </p>
        </div>
      ) : null}

      {status === "none" ? (
        <div className="mt-4">
          <Button
            variant="secondary"
            icon={CalendarPlus}
            busy={busy}
            busyLabel="Making your link…"
            onClick={makeLink}
            testId={`${testId}-create`}
          >
            Make my calendar link
          </Button>
        </div>
      ) : null}

      {status === "active" ? (
        <div className="mt-4 flex flex-col gap-2">
          {!links ? (
            <p className={cn(textMuted, "text-sm")} data-testid={`${testId}-active`}>
              You already have a calendar link. It can&rsquo;t be shown again. Make a new one if you need to add it
              somewhere else.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              disabled={busy}
              onClick={() => setConfirm("reset")}
              testId={`${testId}-reset`}
            >
              Make a new link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirm("off")}
              testId={`${testId}-off`}
            >
              Turn link off
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p role="status" className={cn(textMuted, "mt-3 text-sm")} data-testid={`${testId}-message`}>
          {message}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirm === "reset"}
        onCancel={() => setConfirm(null)}
        onConfirm={makeLink}
        title="Make a new calendar link?"
        description="Your current link stops working straight away. Any calendar using it stops updating until you add the new link."
        confirmLabel="Make a new link"
        tone="primary"
        busy={busy}
        busyLabel="Making your link…"
      />
      <ConfirmDialog
        open={confirm === "off"}
        onCancel={() => setConfirm(null)}
        onConfirm={turnOff}
        title="Turn your calendar link off?"
        description="The link stops working straight away. Dates already in your calendar may stay there until you remove the subscription in your calendar app."
        confirmLabel="Turn link off"
        busy={busy}
        busyLabel="Turning off…"
      />
    </section>
  );
}

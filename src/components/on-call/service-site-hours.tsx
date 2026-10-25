"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { InlineNotice } from "@/components/ui-primitives";
import { serviceActionSchema, type ServiceAction, type ServiceSite } from "@/lib/on-call/service-model";

export function ServiceSiteHours({
  site,
  onAction,
}: {
  site: ServiceSite;
  onAction: (action: ServiceAction) => Promise<unknown>;
}) {
  const savedStart = site.afterHoursStart ?? "";
  const savedEnd = site.afterHoursEnd ?? "";
  const [start, setStart] = useState(savedStart);
  const [end, setEnd] = useState(savedEnd);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  // The parent keys this form on the site only, so a save that reloads new
  // hours keeps this instance (and its "saved" message) and resyncs the
  // fields here, during render rather than in an effect.
  const [synced, setSynced] = useState({ start: savedStart, end: savedEnd });
  if (synced.start !== savedStart || synced.end !== savedEnd) {
    setSynced({ start: savedStart, end: savedEnd });
    setStart(savedStart);
    setEnd(savedEnd);
  }
  async function save() {
    const result = serviceActionSchema.safeParse({
      action: "site.update",
      siteId: site.id,
      afterHoursStart: start || null,
      afterHoursEnd: end || null,
    });
    if (!result.success) {
      setMessage({ text: "Set two different times, or clear both.", failed: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await onAction(result.data);
      setMessage({ text: "Hospital hours saved.", failed: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Hours could not be saved.", failed: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset
      className="grid gap-3 rounded-lg border border-[color:var(--border)] p-3"
      data-testid="service-site-hours"
    >
      <legend>{site.name}: after-hours period</legend>
      <p className="text-sm text-[color:var(--text-muted)]">
        Use the hospital’s Perth times. Leave both blank if the period is not set.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="site-hours-start"
          label="After hours starts"
          type="time"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
        <TextField
          id="site-hours-end"
          label="After hours ends"
          type="time"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
        />
      </div>
      <Button variant="secondary" busy={busy} onClick={() => void save()}>
        Save hospital hours
      </Button>
      {message ? <InlineNotice tone={message.failed ? "danger" : "neutral"}>{message.text}</InlineNotice> : null}
    </fieldset>
  );
}

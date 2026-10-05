"use client";

import { managerWaiting, RosterWaitingBadge } from "@/components/roster/manage/roster-manage-waiting";
import { useEffect, useState } from "react";

import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { useRosterSettings } from "@/components/roster/use-roster-settings";
import { formatPerthDay } from "@/lib/roster/shifts/perth-time";
import type { RosterTeam } from "@/lib/roster/team/model";

function isIosNotInstalled(): boolean {
  if (typeof navigator === "undefined" || !/iPhone|iPad|iPod/i.test(navigator.userAgent)) return false;
  return !(
    (navigator as Navigator & { standalone?: boolean }).standalone ||
    window.matchMedia?.("(display-mode: standalone)").matches
  );
}

function publicKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function usePhoneAlerts() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetch("/api/roster/alerts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check alerts");
        const payload = (await response.json()) as { configured?: boolean; publicKey?: string | null };
        if (!current) return;
        setConfigured(payload.configured === true && !!payload.publicKey);
        setPublicKey(payload.publicKey ?? null);
        if (payload.configured && "serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager?.getSubscription();
          if (subscription) {
            const check = await fetch("/api/roster/alerts/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: subscription.endpoint }),
              cache: "no-store",
            });
            if (!check.ok) throw new Error("Could not verify alert owner");
            const ownership = (await check.json()) as { owned?: boolean };
            if (current) setEnabled(ownership.owned === true);
          } else if (current) setEnabled(false);
        }
      })
      .catch(() => {
        if (current) setMessage("Phone alerts couldn't be checked.");
      });
    return () => {
      current = false;
    };
  }, []);

  async function toggle() {
    if (!configured || !publicKey || busy) return;
    if (isIosNotInstalled()) {
      setMessage("On iPhone, add Roster to your home screen first.");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setMessage("Phone alerts aren't available on this browser.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      if (!registration.pushManager) throw new Error("Push unavailable");
      let subscription = await registration.pushManager.getSubscription();
      if (enabled) {
        if (subscription) {
          await subscription.unsubscribe();
          const response = await fetch("/api/roster/alerts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          if (!response.ok) throw new Error("Could not remove alerts");
        }
        setEnabled(false);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Alerts are blocked on this phone. Turn them on in the phone's settings.");
        return;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKeyBytes(publicKey),
      });
      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys.auth) throw new Error("Missing subscription keys");
      const response = await fetch("/api/roster/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }),
      });
      if (!response.ok) throw new Error("Could not save alerts");
      setEnabled(true);
    } catch {
      setMessage("Phone alerts couldn't be changed. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return { configured, enabled, busy, message, toggle };
}

/** Can appear on the join screen as well as Settings. */
export function RosterAlertsSwitch() {
  const alerts = usePhoneAlerts();
  if (!alerts.configured) return null;
  return (
    <span className="grid justify-items-end gap-1">
      <ToggleSwitch
        enabled={alerts.enabled}
        disabled={alerts.busy}
        onToggle={() => void alerts.toggle()}
        aria-label="Alerts on this phone"
      />
      {alerts.message ? (
        <span role="status" className="max-w-48 text-right text-xs text-[color:var(--text-muted)]">
          {alerts.message}
        </span>
      ) : null}
    </span>
  );
}

function TeamRow({ team, actorId }: { team: RosterTeam; actorId: string | null }) {
  const overview = useRosterRead(team.enabled ? team.serviceId : null, "overview");
  const manager = overview.data?.managers
    ?.map((person) => person.name)
    .filter(Boolean)
    .join(", ");
  const ends = overview.data?.me.rotationEndsOn;
  const isManager = team.role === "manager" && team.enabled;
  const manage = useRosterRead(isManager ? team.serviceId : null, "manage");
  // Counted as Manage shows them: the manager's own swaps are left out, because the server refuses them.
  const waiting = manage.data ? managerWaiting(manage.data, { decisionsInStrip: true, actorId }).count : 0;
  const subtitle = [manager ? `manager ${manager}` : null, ends ? `to ${formatPerthDay(ends)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <ModeRow
        title={team.name}
        subtitle={subtitle || (team.enabled ? "Confirmed team" : "Not confirmed yet")}
        href={team.enabled ? "/roster/team" : undefined}
      />
      {isManager ? (
        <ModeRow
          title={
            <>
              Manage
              <RosterWaitingBadge count={waiting} />
            </>
          }
          href="/roster/manage"
          testId="roster-settings-manage"
        />
      ) : null}
    </>
  );
}

/** Settings: phone switch, category choices and confirmed teams in words. */
export function RosterAlertsSection() {
  const alerts = usePhoneAlerts();
  const settings = useRosterSettings();
  const teams = useRosterTeams();
  const [error, setError] = useState<string | null>(null);
  const preferences = settings.settings.alerts;

  async function change(which: "changes" | "requests") {
    const failure = await settings.update({ alerts: { ...preferences, [which]: !preferences[which] } });
    setError(failure);
  }

  return (
    <div className="grid gap-5">
      {alerts.configured ? (
        <ModeGroupedList eyebrow="Alerts">
          <ModeRow
            title="Alerts on this phone"
            trailing={
              <ToggleSwitch
                enabled={alerts.enabled}
                disabled={alerts.busy}
                onToggle={() => void alerts.toggle()}
                aria-label="Alerts on this phone"
              />
            }
          />
          <ModeRow
            title="Roster changes"
            trailing={
              <ToggleSwitch
                enabled={preferences.changes}
                disabled={settings.status !== "ready"}
                onToggle={() => void change("changes")}
                aria-label="Roster changes"
              />
            }
          />
          <ModeRow
            title="Swap and open-shift requests"
            trailing={
              <ToggleSwitch
                enabled={preferences.requests}
                disabled={settings.status !== "ready"}
                onToggle={() => void change("requests")}
                aria-label="Swap and open-shift requests"
              />
            }
          />
        </ModeGroupedList>
      ) : null}
      {alerts.message || error ? (
        <p role="status" className="text-sm text-[color:var(--text-muted)]">
          {alerts.message ?? error}
        </p>
      ) : null}
      <ModeGroupedList eyebrow="Your team">
        {teams.data?.teams?.length ? (
          teams.data.teams.map((team) => (
            <TeamRow key={team.serviceId} team={team} actorId={teams.data?.actorId ?? null} />
          ))
        ) : (
          <ModeRow title={teams.status === "loading" ? "Checking your teams…" : "No team yet"} />
        )}
      </ModeGroupedList>
    </div>
  );
}

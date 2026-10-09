"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { InformationPageBreadcrumbs, InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeNotice } from "@/components/mode-kit/notice";
import { RosterAlertsSwitch } from "@/components/roster/alerts/roster-alerts-section";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { UserPlus } from "lucide-react";
import { RosterPageHeader } from "@/components/roster/roster-ui";

import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { formatZonedDay, zonedToday } from "@/lib/work-time/format";

import { RosterSignInNotice } from "./roster-sign-in-notice";

type JoinState =
  | { kind: "entry" }
  | { kind: "joining" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "joined"; teamName: string; serviceName: string | null; rotationEndsOn: string | null };

type ApiAnswer = { serviceId?: unknown; code?: unknown; message?: unknown };
type Overview = { service?: { name?: unknown }; me?: { rotationEndsOn?: unknown } };

function codeFrom(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  try {
    const url = new URL(trimmed);
    if (url.origin !== window.location.origin || url.pathname !== "/roster/join") return null;
    const code = new URLSearchParams(url.hash.slice(1)).get("code");
    return code && /^[a-f0-9]{64}$/i.test(code) ? code.toLowerCase() : null;
  } catch {
    return null;
  }
}

function joinedCopy(overview: Overview | null): Extract<JoinState, { kind: "joined" }> {
  const fullName = typeof overview?.service?.name === "string" ? overview.service.name : "Roster";
  const parts = fullName.split(" · ");
  const teamName = parts.pop() || "Roster";
  return {
    kind: "joined",
    teamName,
    serviceName: parts.length ? parts.join(" · ") : null,
    rotationEndsOn: typeof overview?.me?.rotationEndsOn === "string" ? overview.me.rotationEndsOn : null,
  };
}

/** "Fri 9 Oct", or "Fri 9 Apr 2027" when the rotation ends in another year. */
function formatRotationEnd(value: string): string {
  return formatZonedDay(value, zonedToday(currentWorkTimeZone()));
}

export function RosterJoinPage() {
  const [state, setState] = useState<JoinState>({ kind: "entry" });
  const [input, setInput] = useState("");
  const [calendarShifts, setCalendarShifts] = useState<boolean | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const started = useRef(false);

  const loadOverview = useCallback(async (serviceId: string | null): Promise<Overview | null> => {
    let chosen = serviceId;
    if (!chosen) {
      const teamsResponse = await fetch("/api/roster/team", { cache: "no-store" });
      if (!teamsResponse.ok) return null;
      const teams = (await teamsResponse.json().catch(() => null)) as { teams?: { serviceId?: unknown }[] } | null;
      if (teams?.teams?.length !== 1 || typeof teams.teams[0]?.serviceId !== "string") return null;
      chosen = teams.teams[0].serviceId;
    }
    const response = await fetch(`/api/roster/team/${encodeURIComponent(chosen)}?what=overview`, { cache: "no-store" });
    return response.ok ? ((await response.json().catch(() => null)) as Overview | null) : null;
  }, []);

  const loadCalendarSetting = useCallback(async () => {
    try {
      const response = await fetch("/api/roster/settings", { cache: "no-store" });
      if (!response.ok) return;
      const settings = (await response.json().catch(() => null)) as { calendarShifts?: unknown } | null;
      if (typeof settings?.calendarShifts === "boolean") setCalendarShifts(settings.calendarShifts);
    } catch {
      // Joining succeeded even if optional settings could not be read.
    }
  }, []);

  const redeem = useCallback(
    async (code: string) => {
      setState({ kind: "joining" });
      try {
        const response = await fetch("/api/on-call/services/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ code }),
        });
        const answer = (await response.json().catch(() => null)) as ApiAnswer | null;
        if (response.status === 401) {
          setState({ kind: "signed-out" });
          return;
        }
        if (!response.ok && answer?.code !== "service_already_member") {
          setState({
            kind: "error",
            message:
              answer?.code === "service_invite_email_mismatch"
                ? "This invite was sent to a different email. Sign in with that email, or ask your manager for a new invite."
                : "This invite didn't work. Check you're signed in with the email it was sent to, or ask your manager for a new invite.",
          });
          return;
        }
        let overview: Overview | null = null;
        try {
          overview = await loadOverview(typeof answer?.serviceId === "string" ? answer.serviceId : null);
        } catch {
          // A completed join must never be shown as a failed invite because the
          // optional follow-up read failed after the invitation was consumed.
        }
        // Only a completed join clears the typed code; a failed one keeps it to fix or retry.
        setInput("");
        setState(joinedCopy(overview));
        void loadCalendarSetting();
      } catch {
        setState({
          kind: "error",
          message:
            "This invite didn't work. Check you're signed in with the email it was sent to, or ask your manager for a new invite.",
        });
      }
    },
    [loadOverview, loadCalendarSetting],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hash = window.location.hash;
    // Remove the bearer before any network request. Preserve Next's history
    // state and query so the App Router keeps its own navigation state intact.
    if (hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    if (!hash) return;
    const code = new URLSearchParams(hash.slice(1)).get("code");
    queueMicrotask(() => {
      if (code && /^[a-f0-9]{64}$/i.test(code)) void redeem(code.toLowerCase());
      else setState({ kind: "error", message: "That invite link is not valid. Ask your manager for a new one." });
    });
  }, [redeem]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = codeFrom(input);
    if (!code) {
      setState({ kind: "error", message: "Paste a Roster invite link or its 64-character code." });
      return;
    }
    void redeem(code);
  }

  async function toggleCalendar() {
    if (calendarShifts === null || calendarBusy) return;
    setCalendarBusy(true);
    try {
      const response = await fetch("/api/roster/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ calendarShifts: !calendarShifts }),
      });
      if (response.ok) setCalendarShifts(!calendarShifts);
    } catch {
      // The optional switch keeps its last confirmed state.
    } finally {
      setCalendarBusy(false);
    }
  }

  return (
    <InformationPageShell testId="roster-join-main" width="narrow">
      <div className="grid gap-5">
        {/* The page keeps its own header (no band), so it always offers a way back. */}
        <InformationPageBreadcrumbs home={{ label: "Roster", href: "/roster" }} />
        <RosterPageHeader icon={UserPlus} title="Join a team roster" ask={false} />
        {state.kind === "joining" ? <p role="status">Joining your team…</p> : null}
        {state.kind === "signed-out" ? (
          <RosterSignInNotice testId="roster-join-signed-out">
            Sign in, then open the invite link again.
          </RosterSignInNotice>
        ) : null}
        {state.kind === "error" ? <ModeNotice tone="warning">{state.message}</ModeNotice> : null}
        {state.kind === "joined" ? (
          <div className="grid gap-4">
            <p role="status" className="text-lg text-[color:var(--text-heading)]">
              You&apos;re in {state.teamName}
            </p>
            {state.serviceName || state.rotationEndsOn ? (
              <p className="text-sm text-[color:var(--text-muted)]">
                {[state.serviceName, state.rotationEndsOn ? `to ${formatRotationEnd(state.rotationEndsOn)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            <ModeGroupedList eyebrow="Optional" testId="roster-join-options">
              <ModeRow
                title="Alerts for swaps and changes"
                subtitle="Lock screen says only that something changed"
                trailing={<RosterAlertsSwitch />}
              />
              {calendarShifts !== null ? (
                <ModeRow
                  title="Shifts in my calendar"
                  subtitle="Adds team shifts to your calendar link"
                  trailing={
                    <ToggleSwitch
                      enabled={calendarShifts}
                      onToggle={() => void toggleCalendar()}
                      disabled={calendarBusy}
                      aria-label="Shifts in my calendar"
                    />
                  }
                />
              ) : null}
            </ModeGroupedList>
            <Link href="/roster" className={buttonFaceClass({ variant: "primary" })}>
              See my shifts
            </Link>
          </div>
        ) : state.kind === "joining" ? null : (
          <form onSubmit={submit} className="grid gap-3">
            <TextField
              label="Invite link or code"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <p className="m-0 text-xs text-[color:var(--text-muted)]" data-testid="roster-join-privacy">
              The team and its managers see your team shifts. Shifts you add yourself stay private.
            </p>
            <Button type="submit" variant="primary">
              Join team
            </Button>
          </form>
        )}
      </div>
    </InformationPageShell>
  );
}

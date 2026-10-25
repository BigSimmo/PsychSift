"use client";

import { useEffect, useRef, useState } from "react";

import {
  CARD_CLASS,
  META_CLASS,
  ROW_CLASS,
  SECTION_HEADING_CLASS,
} from "@/components/developer-area/hub/panel-primitives";
import { ModeNotice } from "@/components/mode-kit/notice";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { OwnerMember, OwnerTeam } from "@/lib/roster/owner/teams";

type ApiFailure = { message?: unknown };
type TeamList = { teams?: unknown };
type MemberList = { members?: unknown };

function isTeam(value: unknown): value is OwnerTeam {
  if (!value || typeof value !== "object") return false;
  const team = value as Record<string, unknown>;
  return (
    typeof team.serviceId === "string" &&
    typeof team.name === "string" &&
    typeof team.createdAt === "string" &&
    (team.verifiedAt === null || typeof team.verifiedAt === "string") &&
    typeof team.isDemo === "boolean" &&
    typeof team.activeMembers === "number" &&
    typeof team.managers === "number"
  );
}

function isMember(value: unknown): value is OwnerMember {
  if (!value || typeof value !== "object") return false;
  const member = value as Record<string, unknown>;
  return (
    typeof member.userId === "string" &&
    (member.displayName === null || typeof member.displayName === "string") &&
    (member.rosterName === null || typeof member.rosterName === "string") &&
    typeof member.serviceRole === "string" &&
    (member.rosterRole === "member" || member.rosterRole === "manager") &&
    (member.grade === null || typeof member.grade === "string") &&
    typeof member.joinedAt === "string"
  );
}

function teamName(full: string): string {
  return full.split(" · ").at(-1) || full;
}

async function fetchOwnerTeams(): Promise<{ kind: "unauthorized" } | { kind: "ready"; teams: OwnerTeam[] }> {
  const response = await fetch("/api/roster/owner/teams", { cache: "no-store" });
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
  if (!response.ok) throw new Error("owner teams unavailable");
  const answer = (await response.json()) as TeamList;
  if (!Array.isArray(answer.teams) || !answer.teams.every(isTeam)) throw new Error("owner teams shape");
  return { kind: "ready", teams: answer.teams };
}

export function RosterTeamsPanel() {
  const [teams, setTeams] = useState<OwnerTeam[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<OwnerMember[] | null>(null);
  // Separate from `members === null`, which means a load is still running: a
  // failed load used to leave "Loading people…" up for good beside its error.
  const [membersFailed, setMembersFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<OwnerTeam | null>(null);
  const [email, setEmail] = useState<{ userId: string; value: string | null } | null>(null);
  const memberLoad = useRef(0);
  const selected = teams?.find((team) => team.serviceId === selectedId) ?? null;

  async function loadTeams() {
    try {
      const result = await fetchOwnerTeams();
      if (result.kind === "unauthorized") {
        setTeams(null);
        setMembers(null);
        setSelectedId(null);
        setEmail(null);
        setError("Sign in as an administrator to change teams.");
        return;
      }
      setTeams(result.teams);
      setError(null);
    } catch {
      setError("Teams could not be loaded. Try again shortly.");
    }
  }

  async function loadMembers(serviceId: string) {
    const loadId = ++memberLoad.current;
    setMembers(null);
    setMembersFailed(false);
    setEmail(null);
    try {
      const response = await fetch(`/api/roster/owner/teams/${encodeURIComponent(serviceId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const answer = (await response.json()) as MemberList;
      if (!Array.isArray(answer.members) || !answer.members.every(isMember)) throw new Error();
      if (loadId === memberLoad.current) setMembers(answer.members);
    } catch {
      if (loadId === memberLoad.current) setMembersFailed(true);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchOwnerTeams().then(
      (result) => {
        if (!active) return;
        if (result.kind === "unauthorized") {
          setTeams(null);
          setMembers(null);
          setSelectedId(null);
          setEmail(null);
          setError("Sign in as an administrator to change teams.");
        } else {
          setTeams(result.teams);
          setError(null);
        }
      },
      () => {
        if (active) setError("Teams could not be loaded. Try again shortly.");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function change(serviceId: string, body: object) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/owner/teams/${encodeURIComponent(serviceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const answer = (await response.json().catch(() => null)) as ApiFailure | null;
        setError(typeof answer?.message === "string" ? answer.message : "The team could not be changed.");
        return;
      }
      setConfirmation(null);
      await loadTeams();
      if (body && "action" in body && body.action === "manager") await loadMembers(serviceId);
    } catch {
      setError("The team could not be changed. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  async function revealEmail(serviceId: string, userId: string) {
    setEmail(null);
    try {
      const response = await fetch(
        `/api/roster/owner/teams/${encodeURIComponent(serviceId)}?member=${encodeURIComponent(userId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const answer = (await response.json()) as { email?: unknown };
      if (answer.email !== null && typeof answer.email !== "string") throw new Error();
      setEmail({ userId, value: answer.email });
    } catch {
      setError("That person's email could not be loaded.");
    }
  }

  if (teams === null && !error) return <p className={META_CLASS}>Loading teams…</p>;
  if (teams === null) return <ModeNotice tone="warning">{error}</ModeNotice>;

  return (
    <div className="grid gap-6" data-testid="roster-teams-panel">
      {/* While the sheet is open its own body shows the error: the panel behind a
          modal is not where anyone is looking. */}
      {error && !confirmation ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
      <section className="grid gap-3" aria-label="Health service teams">
        <h2 className={SECTION_HEADING_CLASS}>Teams</h2>
        {teams.length === 0 ? <p className={META_CLASS}>No teams yet.</p> : null}
        <ul className="grid gap-2">
          {teams.map((team) => (
            <li key={team.serviceId} className={CARD_CLASS}>
              <p className="text-sm text-[color:var(--text-heading)]">{team.name}</p>
              <p className={META_CLASS}>
                {team.verifiedAt || team.isDemo ? "Confirmed" : "Not confirmed"} · {team.activeMembers} members ·{" "}
                {team.managers} roster managers
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSelectedId(team.serviceId);
                    void loadMembers(team.serviceId);
                  }}
                >
                  People
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setError(null);
                    setConfirmation(team);
                  }}
                >
                  {team.verifiedAt || team.isDemo ? "Change confirmation" : "Confirm team"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {selected ? (
        <section className="grid gap-3" aria-label={`People in ${selected.name}`}>
          <h2 className={SECTION_HEADING_CLASS}>People · {selected.name}</h2>
          {membersFailed ? (
            <div className="grid justify-items-start gap-2">
              <ModeNotice tone="warning">People in this team could not be loaded. Try again shortly.</ModeNotice>
              <Button type="button" variant="secondary" onClick={() => void loadMembers(selected.serviceId)}>
                Retry
              </Button>
            </div>
          ) : members === null ? (
            <p className={META_CLASS}>Loading people…</p>
          ) : null}
          {members?.length === 0 ? <p className={META_CLASS}>No active members.</p> : null}
          <ul className="grid gap-2">
            {members?.map((member) => (
              <li key={member.userId} className={ROW_CLASS}>
                <span className="text-sm text-[color:var(--text-heading)]">
                  {member.displayName || member.rosterName || "Name not set"}
                </span>
                <span className={META_CLASS}>{member.rosterRole === "manager" ? "Roster manager" : "Member"}</span>
                {member.grade ? <span className={META_CLASS}>{member.grade}</span> : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void revealEmail(selected.serviceId, member.userId)}
                >
                  Show email
                </Button>
                {email?.userId === member.userId ? (
                  <span className={META_CLASS}>{email.value || "No email on account"}</span>
                ) : null}
                {selected.verifiedAt || selected.isDemo ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void change(selected.serviceId, {
                        action: "manager",
                        userId: member.userId,
                        manager: member.rosterRole !== "manager",
                      })
                    }
                  >
                    {member.rosterRole === "manager" ? "Remove roster manager" : "Make roster manager"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {confirmation ? (
        <Sheet
          open
          onClose={() => setConfirmation(null)}
          title={confirmation.verifiedAt || confirmation.isDemo ? "Change team confirmation" : "Confirm team"}
          mobilePlacement="bottom"
        >
          <div className="grid gap-4">
            <p className="text-sm text-[color:var(--text-heading)]">
              {confirmation.verifiedAt || confirmation.isDemo
                ? `Remove confirmation for ${teamName(confirmation.name)}? Its members will lose access to the shared roster.`
                : `Confirm ${teamName(confirmation.name)}? Its members can then share a roster.`}
            </p>
            {error ? (
              <p role="alert" className="text-sm text-[color:var(--warning)]">
                {error}
              </p>
            ) : null}
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() =>
                void change(confirmation.serviceId, {
                  action: "verify",
                  verified: !confirmation.verifiedAt && !confirmation.isDemo,
                  isDemo: false,
                })
              }
            >
              {confirmation.verifiedAt || confirmation.isDemo ? "Remove confirmation" : "Confirm team"}
            </Button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

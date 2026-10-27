"use client";

import Link from "next/link";
import { useState } from "react";
import { ModeNotice } from "@/components/mode-kit/notice";
import { shortDayLabel } from "@/components/teaching/teaching-dates";
import type { OrganiseRead } from "@/components/teaching/organise-model";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Button } from "@/components/ui/button";
import { teachingErrorMessage, teachingPost, teachingServiceUrl } from "@/lib/teaching/client";
import { teachingDepthActionSchema, teachingDepthUrl, type SupervisionPairing } from "@/lib/teaching/depth-model";
import { memberLabel, type TeachingRole } from "@/lib/teaching/model";

export function TeachingSupervisionAdmin({
  serviceId,
  data,
  today,
  isAdmin,
  onSaved,
}: {
  serviceId: string;
  data: OrganiseRead;
  today: string;
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const resource = useTeachingResource<{ pairings: SupervisionPairing[]; supervisorsFromPeople?: boolean }>(
    teachingDepthUrl(serviceId, { action: "supervision.read" }),
  );
  const [registrarId, setRegistrarId] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [pairingId, setPairingId] = useState("");
  const [roleUser, setRoleUser] = useState("");
  const [role, setRole] = useState<TeachingRole>("doctor");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // One supervisor list: in a service that belongs to a hospital, People and roles names the supervisor.
  const fromPeople = resource.data?.supervisorsFromPeople === true;
  const field = "min-h-12 rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-3";
  async function post(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await teachingPost(url, body);
      setMessage("Saved.");
      resource.retry();
      onSaved();
    } catch (cause) {
      setMessage(teachingErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-3 border-t border-[color:var(--border)] pt-3">
      <h2 className="text-base-minus font-medium text-[color:var(--text-heading)]">Supervision pairings</h2>
      {fromPeople ? (
        <ModeNotice>
          Medical Workforce or the DCT names this service&apos;s supervisors in{" "}
          <Link href="/admin/people" className="underline" data-testid="teaching-supervision-people-link">
            People and roles
          </Link>
          . Each trainee&apos;s pairing starts and follows from there, and keeps its sessions here.
        </ModeNotice>
      ) : (
        <ModeNotice>
          A pairing involving the organiser must be set by a Teaching admin. Programme access never gives access to
          private CPD.
        </ModeNotice>
      )}
      {resource.status === "ready" ? (
        <ul role="list" className="grid gap-1 text-sm text-[color:var(--text-heading)]">
          {resource.data?.pairings.map((pairing) => (
            <li key={pairing.pairingId}>
              {pairing.registrarName} · {pairing.supervisorName} · {shortDayLabel(pairing.startsOn)} to{" "}
              {shortDayLabel(pairing.endsOn)}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p>Pairings {resource.status === "loading" ? "are loading…" : "could not load."}</p>
          {resource.status !== "loading" ? (
            <Button type="button" variant="secondary" onClick={resource.retry}>
              Try again
            </Button>
          ) : null}
        </>
      )}
      {fromPeople ? null : (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = teachingDepthActionSchema.safeParse(
              pairingId
                ? { action: "pairing.reassign", pairingId, supervisorId }
                : { action: "pairing.save", registrarId, supervisorId, startsOn, endsOn },
            );
            if (!parsed.success) {
              setMessage(parsed.error.issues[0]?.message ?? "Check the pairing.");
              return;
            }
            void post(teachingDepthUrl(serviceId), parsed.data);
          }}
        >
          <label className="grid gap-1">
            New pairing or reassign
            <select
              className={field}
              value={pairingId}
              disabled={busy}
              onChange={(event) => setPairingId(event.target.value)}
            >
              <option value="">New pairing</option>
              {resource.data?.pairings.map((pairing) => (
                <option key={pairing.pairingId} value={pairing.pairingId}>
                  {pairing.registrarName} — reassign supervisor
                </option>
              ))}
            </select>
          </label>
          {!pairingId ? (
            <label className="grid gap-1">
              Registrar
              <select
                className={field}
                value={registrarId}
                required
                disabled={busy}
                onChange={(event) => setRegistrarId(event.target.value)}
              >
                <option value="">Choose a member</option>
                {data.members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {memberLabel(member)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1">
            Supervisor
            <select
              className={field}
              value={supervisorId}
              required
              disabled={busy}
              onChange={(event) => setSupervisorId(event.target.value)}
            >
              <option value="">Choose a member</option>
              {data.members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {memberLabel(member)}
                </option>
              ))}
            </select>
          </label>
          {!pairingId ? (
            <>
              <label className="grid gap-1">
                Starts on
                <input
                  className={field}
                  type="date"
                  required
                  value={startsOn}
                  disabled={busy}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </label>
              <label className="grid gap-1">
                Ends on
                <input
                  className={field}
                  type="date"
                  required
                  min={startsOn}
                  value={endsOn}
                  disabled={busy}
                  onChange={(event) => setEndsOn(event.target.value)}
                />
              </label>
            </>
          ) : (
            <p>Pending confirmations will move to the new supervisor. Existing confirmations stay in the record.</p>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {pairingId ? "Reassign supervisor" : "Create pairing"}
          </Button>
        </form>
      )}
      {isAdmin ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void post(teachingServiceUrl(serviceId), { action: "role.set", userId: roleUser, role });
          }}
        >
          <h3 className="font-medium">Service access</h3>
          <label className="grid gap-1">
            Member
            <select
              className={field}
              value={roleUser}
              required
              disabled={busy}
              onChange={(event) => setRoleUser(event.target.value)}
            >
              <option value="">Choose a member</option>
              {data.members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {memberLabel(member)} ({member.role})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Role
            <select
              className={field}
              value={role}
              disabled={busy}
              onChange={(event) => setRole(event.target.value as TeachingRole)}
            >
              <option value="doctor">Member</option>
              <option value="organiser">Organiser</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <Button type="submit" variant="secondary" disabled={busy || !roleUser}>
            Save service role
          </Button>
        </form>
      ) : null}
      {busy ? <p role="status">Saving…</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

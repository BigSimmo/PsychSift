"use client";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { focusRing } from "@/components/card-recipes";
import { Button } from "@/components/ui/button";
import { WorkStateLoading } from "@/components/mode-kit/work-state";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { TextField } from "@/components/ui/text-field";
import { RosterInviteSheet } from "@/components/roster/invite/roster-invite-sheet";
import { postRosterAction, useRosterRead } from "@/components/roster/use-roster-team";
import { ROSTER_GRADES, type RosterPerson, type RosterTeam } from "@/lib/roster/team/model";

function PersonEditor({ person, team, refresh }: { person: RosterPerson; team: RosterTeam; refresh: () => void }) {
  const [name, setName] = useState(person.rosterName ?? "");
  const [grade, setGrade] = useState(person.grade ?? "");
  const [rotation, setRotation] = useState(person.rotationEndsOn ?? "");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function save(remove = false) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await postRosterAction(
      team.serviceId,
      remove
        ? { action: "member.remove", userId: person.userId }
        : {
            action: "role.set",
            userId: person.userId,
            ...(name !== (person.rosterName ?? "") ? { rosterName: name.trim() || null } : {}),
            ...(grade !== (person.grade ?? "") ? { grade: (grade || null) as RosterPerson["grade"] } : {}),
            ...(rotation !== (person.rotationEndsOn ?? "") ? { rotationEndsOn: rotation || null } : {}),
          },
    );
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setConfirm(false);
    setMessage(remove ? "Removed" : "Saved");
    refresh();
  }
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm">
        Grade
        <select
          className="min-h-12 w-full min-w-0 rounded border border-[color:var(--border)] bg-background p-2"
          value={grade}
          onChange={(event) => setGrade(event.target.value)}
        >
          <option value="">Grade not set</option>
          {ROSTER_GRADES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label="Name in roster file"
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label="Rotation ends"
        type="date"
        value={rotation}
        onChange={(event) => setRotation(event.target.value)}
      />
      {message ? <p role="status">{message}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          Save person
        </Button>
        {person.serviceRole === "member" ? (
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Remove
          </Button>
        ) : (
          <span className="text-sm text-[color:var(--text-muted)]">Remove in On call</span>
        )}
      </div>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        mobilePlacement="bottom"
        title={`Remove ${person.displayName ?? "this person"} from ${team.name}?`}
      >
        <p>They leave this team in On call, Teaching and Roster, and their open requests are cancelled.</p>
        {message ? <p role="alert">{message}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void save(true)}>
            Remove from team
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
function personTitle(person: RosterPerson): string {
  return `${person.displayName ?? "Name not available"}${person.role === "manager" ? " · Roster manager" : ""}`;
}

/**
 * The team as one row per person (name, grade, chevron). A row opens that
 * person's edit form in a sheet, so the list stays short and only one form is
 * open at a time.
 */
export function RosterPeopleList({ team }: { team: RosterTeam }) {
  const people = useRosterRead(team.serviceId, "people");
  const [invite, setInvite] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const person = people.data?.people.find((item) => item.userId === editing) ?? null;
  // The person stays chosen while the sheet closes, so it animates out and returns focus to the row.
  const shown = person;
  return (
    <>
      <section className="grid gap-2">
        <h2>People</h2>
        {people.status === "loading" && !people.data ? <WorkStateLoading label="Loading people…" /> : null}
        {people.data?.people.length ? (
          <ul className="divide-y divide-[color:var(--border)] rounded-xl border border-[color:var(--border)]">
            {people.data.people.map((item) => (
              <li key={item.userId}>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(item.userId);
                    setSheetOpen(true);
                  }}
                  className={cn(focusRing, "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left")}
                >
                  <span className="grid min-w-0 flex-1">
                    <span className="break-words">{personTitle(item)}</span>
                    <span className="text-sm capitalize text-[color:var(--text-muted)]">
                      {item.grade ?? "Grade not set"}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {people.message ? <p role="alert">{people.message}</p> : null}
      <Button onClick={() => setInvite(true)}>Invite by email</Button>
      <Sheet
        open={sheetOpen && person !== null}
        onClose={() => setSheetOpen(false)}
        title={shown ? personTitle(shown) : "Person"}
        description={team.name}
      >
        {shown ? <PersonEditor key={shown.userId} person={shown} team={team} refresh={people.reload} /> : null}
      </Sheet>
      {invite ? (
        <RosterInviteSheet serviceId={team.serviceId} teamName={team.name} onClose={() => setInvite(false)} />
      ) : null}
    </>
  );
}

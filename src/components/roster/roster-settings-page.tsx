"use client";

import { Check, Link2, Lock, MapPin, Moon, RefreshCw, Settings2, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CalendarSubscribe } from "@/components/calendar/calendar-subscribe";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeActionButton } from "@/components/mode-kit/action-button";
import { formatModeDate, formatModeTime } from "@/components/mode-kit/dates";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/components/ui-primitives";
import { updateReminderType, type ReminderLeadTime, type ReminderType } from "@/lib/reminders/settings-model";

import { RosterAlertsSection, RosterTeamsSection } from "./alerts/roster-alerts-section";
import { RosterSignInNotice } from "./invite/roster-sign-in-notice";
import {
  RosterFootnote,
  RosterIconLead,
  RosterList,
  RosterNote,
  RosterRow,
  RosterSectionHead,
  rosterFilledButton,
  rosterOutlineButton,
} from "./roster-list";
import { describeLinkFailure, useRosterLinks } from "./use-roster-links";
import { useRosterSettings } from "./use-roster-settings";
import { useRosterShifts } from "./use-roster-shifts";
import { RosterPageHeader } from "./roster-ui";

/**
 * Roster Settings: the calendar switch, the evening-before reminder,
 * workplaces, calendar links, and Delete my data.
 *
 * Delete asks no "Are you sure?". Everything is hidden at once and Undo shows
 * for 30 seconds; the delete request is sent only when those 30 seconds end
 * with the page still open. Leaving first, by closing the page or navigating
 * away inside the app, cancels it just as Undo does: nothing is deleted. Once
 * sent, the request carries `keepalive`, so leaving then does not cut it off. A
 * whole-account delete is the one Roster action that cannot be reversed, so
 * it keeps a longer window than the 10-second `ROSTER_UNDO_MS` used elsewhere.
 *
 * Removing a workplace or a calendar link asks first (ConfirmDialog), because
 * neither has an Undo.
 */

export const ROSTER_DELETE_UNDO_MS = 30_000;

/* The evening-before shift reminder is the shared model's "shifts" type with its fixed 20:00 lead time. */
const SHIFTS_REMINDER: ReminderType = "shifts";
const EVENING_BEFORE: ReminderLeadTime = "evening-before";

type DeleteState = "idle" | "pending" | "deleting" | "deleted";

export function RosterSettingsPage() {
  const shifts = useRosterShifts();
  const links = useRosterLinks();
  const settings = useRosterSettings();
  const { preferences, setPreference } = useAppPreferences();
  const [deleteState, setDeleteState] = useState<DeleteState>("idle");
  const [notice, setNotice] = useState<{ tone: "neutral" | "warning"; text: string } | null>(null);
  const timer = useRef<number | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: "workplace"; name: string } | { kind: "link"; id: string; host: string } | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const reminderOn = preferences.reminders.types[SHIFTS_REMINDER]?.calendarAlert === EVENING_BEFORE;
  const calendarShifts = settings.settings.calendarShifts;

  const workplaces = useMemo(() => {
    const names = new Set<string>();
    for (const shift of shifts.shifts) if (shift.workplace) names.add(shift.workplace);
    for (const name of Object.keys(settings.settings.codes)) if (name) names.add(name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [shifts.shifts, settings.settings.codes]);

  const { deleteAll, reload: reloadShifts } = shifts;
  const { reload: reloadLinks } = links;
  const sendDelete = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setDeleteState("deleting");
    // Committed once the undo window ends: `keepalive` lets the request outlive
    // the page if it is closed or left now. Only the pending window cancels.
    void deleteAll({ keepalive: true }).then((result) => {
      // A delete that removed your own data but left some team requests is done, with a note.
      setDeleteState(result.ok ? "deleted" : "idle");
      if (result.ok) {
        if (result.message) setNotice({ tone: "warning", text: result.message });
        return;
      }
      // A failure can come part way through, so show what is actually left rather than the old list.
      void reloadShifts();
      void reloadLinks();
      setNotice({
        tone: "warning",
        text: `${result.message ?? "Your roster data couldn't be deleted."} Some of it may already be gone; this page now shows what is left.`,
      });
    });
  }, [deleteAll, reloadShifts, reloadLinks]);

  // Leaving the page during the 30 seconds, closed or navigated away from
  // inside the app, cancels the pending delete: nothing is sent.
  useEffect(() => {
    if (deleteState !== "pending") return;
    const onPageHide = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setDeleteState("idle");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [deleteState]);

  useEffect(
    () => () => {
      if (timer.current === null) return;
      window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  function startDelete() {
    setNotice(null);
    setDeleteState("pending");
    timer.current = window.setTimeout(sendDelete, ROSTER_DELETE_UNDO_MS);
  }

  function undoDelete() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setDeleteState("idle");
  }

  async function toggleCalendarShifts() {
    const failure = await settings.update({ calendarShifts: !calendarShifts });
    if (failure) setNotice({ tone: "warning", text: failure });
  }

  function toggleReminder() {
    setPreference(
      "reminders",
      updateReminderType(preferences.reminders, SHIFTS_REMINDER, {
        calendarAlert: reminderOn ? "off" : EVENING_BEFORE,
      }),
    );
  }

  async function removeWorkplace(name: string) {
    // Its calendar links and imported shifts go together, so no refresh brings it back; then its codes.
    const removed = await shifts.removeWorkplace(name);
    if (removed) {
      setNotice({ tone: "warning", text: removed });
      return;
    }
    void links.reload();
    const failure = await settings.update({ codes: { [name]: null } });
    setNotice(failure ? { tone: "warning", text: failure } : { tone: "neutral", text: "Removed" });
  }

  async function linkAction(action: Promise<string | null>, done: string) {
    const failure = await action;
    setNotice(failure ? { tone: "warning", text: failure } : { tone: "neutral", text: done });
  }

  function linkStatus(link: (typeof links.links)[number]): string | null {
    return (
      describeLinkFailure(link.lastError) ??
      (link.lastFetchedAt
        ? `Updated ${formatModeDate(link.lastFetchedAt)} ${formatModeTime(link.lastFetchedAt)}`
        : null)
    );
  }

  /** A workplace's second line, from what is really saved for it: its calendar link's state and its codes. */
  function workplaceSub(name: string): string | undefined {
    const own = links.links.filter((link) => link.workplace === name);
    const parts = [
      own.length === 1 ? "Calendar link" : own.length > 1 ? `${own.length} calendar links` : null,
      Object.keys(settings.settings.codes[name] ?? {}).length ? "Shift codes saved" : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : undefined;
  }

  async function confirmRemoval() {
    if (!confirm) return;
    setConfirmBusy(true);
    if (confirm.kind === "workplace") await removeWorkplace(confirm.name);
    else await linkAction(links.remove(confirm.id), "Removed");
    setConfirmBusy(false);
    setConfirm(null);
  }

  if (deleteState !== "idle") {
    return (
      <InformationPageShell testId="roster-settings-main" width="narrow">
        <RosterPageHeader
          icon={Settings2}
          title="Settings"
          subtitle="Calendar links, hours and your data."
          ask={false}
        />
        <div className="grid gap-3" data-testid="roster-settings-deleting" data-mode-identity="roster">
          <RosterNote icon={deleteState === "deleted" ? Check : Trash2}>
            {deleteState === "pending"
              ? "Your Roster data will be deleted in 30 seconds. Leaving this page cancels it."
              : deleteState === "deleting"
                ? "Deleting your own Roster data…"
                : "Your own Roster data is deleted. Team rostered shifts remain with the team."}
          </RosterNote>
          {deleteState === "deleted" && notice ? (
            <RosterNote icon={TriangleAlert} tone="warning" testId="roster-settings-delete-partial">
              {notice.text}
            </RosterNote>
          ) : null}
          {deleteState === "pending" ? (
            <button type="button" className={cn(rosterOutlineButton, "justify-self-start")} onClick={undoDelete}>
              <Undo2 aria-hidden="true" className="size-icon-md" />
              Undo
            </button>
          ) : null}
        </div>
      </InformationPageShell>
    );
  }

  return (
    <InformationPageShell testId="roster-settings-main" width="narrow">
      <RosterPageHeader icon={Settings2} title="Settings" subtitle="Calendar links, hours and your data." ask={false} />
      <div className="grid min-w-0 gap-3" data-mode-identity="roster">
        {notice ? <ModeNotice tone={notice.tone}>{notice.text}</ModeNotice> : null}
        {shifts.status === "loading" ? (
          <ModeModuleSkeleton rows={4} eyebrow testId="roster-settings-loading" />
        ) : shifts.status === "signed-out" ? (
          <RosterSignInNotice testId="roster-settings-signed-out">
            Sign in to change Roster settings.
          </RosterSignInNotice>
        ) : (
          <>
            <section aria-labelledby="roster-settings-calendar-title" className="grid gap-3">
              <RosterSectionHead id="roster-settings-calendar-title" title="Calendar" />
              <RosterList label="Calendar" testId="roster-settings-calendar">
                <RosterRow
                  lead={<RosterIconLead icon={Link2} />}
                  title="Calendar link"
                  sub="Your shifts in your phone calendar"
                  action={
                    <ToggleSwitch
                      enabled={calendarShifts}
                      onToggle={() => void toggleCalendarShifts()}
                      aria-label="Shifts on my calendar link"
                      disabled={settings.status !== "ready"}
                    />
                  }
                />
              </RosterList>
              <RosterFootnote testId="roster-settings-calendar-note">
                {calendarShifts
                  ? "Your shifts for the next 60 days go on your private calendar link as shift type and time only, never the workplace. Anyone with the link can see them, so keep it to yourself."
                  : "Off: your shifts are not on your calendar link."}
              </RosterFootnote>
            </section>
            {calendarShifts ? <CalendarSubscribe testId="roster-settings-subscribe" /> : null}

            <RosterAlertsSection
              reminder={
                <RosterRow
                  lead={<RosterIconLead icon={Moon} />}
                  title="Remind me the evening before"
                  sub={
                    calendarShifts
                      ? "At 20:00 in your calendar · shift type and time only"
                      : "Turn on Calendar link first"
                  }
                  action={
                    <ToggleSwitch
                      enabled={calendarShifts && reminderOn}
                      onToggle={toggleReminder}
                      aria-label="Remind me the evening before"
                      disabled={!calendarShifts}
                    />
                  }
                />
              }
            />

            <section aria-labelledby="roster-settings-workplaces-title" className="grid gap-3">
              <RosterSectionHead id="roster-settings-workplaces-title" title="Workplaces" />
              {shifts.status === "error" ? (
                <div className="grid gap-3" data-testid="roster-settings-error">
                  <RosterNote icon={TriangleAlert} tone="warning" role="alert">
                    Your shifts could not be loaded.
                  </RosterNote>
                  <button
                    type="button"
                    className={cn(rosterFilledButton, "justify-self-start")}
                    onClick={() => void shifts.reload()}
                  >
                    <RefreshCw aria-hidden="true" className="size-icon-md" />
                    Try again
                  </button>
                </div>
              ) : (
                <RosterList label="Workplaces" testId="roster-settings-workplaces">
                  {workplaces.length === 0 ? (
                    <RosterRow lead={<RosterIconLead icon={MapPin} />} title="None yet" />
                  ) : (
                    workplaces.map((name) => (
                      <RosterRow
                        key={name}
                        lead={<RosterIconLead icon={MapPin} />}
                        title={<span className="line-clamp-2">{name}</span>}
                        sub={workplaceSub(name)}
                        action={
                          <ModeActionButton
                            icon={Trash2}
                            label={`Remove ${name}`}
                            onClick={() => setConfirm({ kind: "workplace", name })}
                            disabled={shifts.demoMode}
                          />
                        }
                      />
                    ))
                  )}
                </RosterList>
              )}
            </section>

            <section aria-labelledby="roster-settings-links-title" className="grid gap-3">
              <RosterSectionHead id="roster-settings-links-title" title="Roster calendar links" />
              {links.status === "error" ? (
                <div className="grid gap-3" data-testid="roster-settings-links-error">
                  <RosterNote icon={TriangleAlert} tone="warning" role="alert">
                    Your calendar links could not be loaded.
                  </RosterNote>
                  <button
                    type="button"
                    className={cn(rosterOutlineButton, "justify-self-start")}
                    onClick={() => void links.reload()}
                  >
                    <RefreshCw aria-hidden="true" className="size-icon-md" />
                    Try again
                  </button>
                </div>
              ) : (
                <RosterList label="Roster calendar links" testId="roster-settings-links">
                  {links.links.length === 0 ? (
                    <RosterRow lead={<RosterIconLead icon={Link2} />} title="None yet" />
                  ) : (
                    links.links.map((link) => (
                      <RosterRow
                        key={link.id}
                        lead={<RosterIconLead icon={Link2} />}
                        title={link.hostPreview}
                        sub={[linkStatus(link), link.workplace].filter(Boolean).join(" · ") || undefined}
                        action={
                          <span className="flex items-center">
                            <ModeActionButton
                              icon={RefreshCw}
                              label={`Refresh ${link.hostPreview}`}
                              onClick={() => void linkAction(links.refresh(link.id), "Refreshed")}
                            />
                            <ModeActionButton
                              icon={Trash2}
                              label={`Remove ${link.hostPreview}`}
                              onClick={() => setConfirm({ kind: "link", id: link.id, host: link.hostPreview })}
                            />
                          </span>
                        }
                      />
                    ))
                  )}
                </RosterList>
              )}
            </section>

            <RosterTeamsSection />

            <RosterNote icon={Lock} role="note" testId="roster-settings-who-sees">
              <span>
                <b className="font-semibold text-[color:var(--text-heading)]">Who sees what.</b> Shifts you add or
                import yourself are private to you. Shifts on a team roster are seen by that team and its manager. Dates
                you can&apos;t work, and leave you add to a team, are seen by your manager; teammates see only how many
                people are already off. Roster does not ask for patient details: do not put any in shift names or
                imported calendars.
              </span>
            </RosterNote>

            <section aria-labelledby="roster-settings-data-title" className="grid gap-3">
              <RosterSectionHead id="roster-settings-data-title" title="Your data" />
              <RosterList label="Your data" testId="roster-settings-delete">
                {shifts.demoMode ? (
                  <RosterRow
                    lead={<RosterIconLead icon={Trash2} />}
                    title="Delete my roster data"
                    sub="Not available in the demo"
                    dim
                  />
                ) : (
                  <RosterRow
                    lead={<RosterIconLead icon={Trash2} />}
                    title="Delete my roster data"
                    sub="Your shifts, leave, workplaces and their shift codes, roster calendar links, phone alerts and Roster settings"
                    onClick={startDelete}
                  />
                )}
              </RosterList>
              <RosterFootnote testId="roster-settings-delete-note">
                Your open swap and open-shift requests are withdrawn, and upcoming dates you can&apos;t work are cleared
                (if a team&apos;s requests cannot be withdrawn, you are told to check Requests). Shifts on a team roster
                stay with that team, which keeps its roster records for 12 months. Uploaded files are never kept. Extra
                time you logged is not removed here, and phone alerts stop on every device. You get 30 seconds to change
                your mind. After that it cannot be undone.
              </RosterFootnote>
            </section>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void confirmRemoval()}
        title={confirm?.kind === "link" ? "Remove calendar link?" : "Remove workplace?"}
        description={
          confirm?.kind === "workplace"
            ? `This removes ${confirm.name}: its calendar links, the shifts imported for it, and its shift codes. Shifts you added yourself stay.`
            : confirm?.kind === "link"
              ? `Roster stops updating from ${confirm.host}. Shifts already imported from it stay on your roster.`
              : ""
        }
        confirmLabel={confirm?.kind === "link" ? "Remove calendar link" : "Remove workplace"}
        busy={confirmBusy}
        busyLabel="Removing…"
      />
    </InformationPageShell>
  );
}

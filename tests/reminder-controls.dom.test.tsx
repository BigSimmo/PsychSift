import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { ReminderSettingsBlock } from "@/components/clinical-dashboard/settings-reminders";
import { OnCallNotificationsPanel } from "@/components/on-call/on-call-notifications";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import type { OnCallNotification } from "@/lib/on-call/notifications";
import {
  DEFAULT_REMINDER_SETTINGS,
  snoozeReminder,
  updateReminderType,
  type ReminderSettings,
} from "@/lib/reminders/settings";

// Invented data only.

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: "signed_out",
    isConfigured: false,
    error: null,
    notice: null,
    session: null,
    signInWithEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    favourites: {},
    clearFavourites: vi.fn(async () => true),
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const TODAY = "2026-09-26";

function StatefulBlock({
  initial,
  onChange,
}: {
  initial: ReminderSettings;
  onChange?: (next: ReminderSettings) => void;
}) {
  const [reminders, setReminders] = useState(initial);
  return (
    <ReminderSettingsBlock
      reminders={reminders}
      today={TODAY}
      onChange={(next) => {
        setReminders(next);
        onChange?.(next);
      }}
    />
  );
}

describe("Settings, Notifications, Reminders", () => {
  it("lists every reminder type with the defaults: shown in the app, no alerts", () => {
    render(<StatefulBlock initial={DEFAULT_REMINDER_SETTINGS} />);
    for (const label of ["CPD routines due", "CPD year-end claim", "On Call checks", "Compliance dates", "Teaching"]) {
      expect(screen.getByRole("switch", { name: `${label}: Show in the app` })).toHaveAttribute("aria-checked", "true");
    }
    expect(screen.getByRole("combobox", { name: "Compliance dates Phone calendar alert" })).toHaveValue("off");
    // On Call checks are never calendar dates, so there is no alert to choose.
    expect(screen.queryByRole("combobox", { name: "On Call checks Phone calendar alert" })).toBeNull();
    expect(within(screen.getByTestId("settings-reminder-on-call-checks")).getByText(/In the app only/)).toBeVisible();
    expect(screen.getByRole("switch", { name: "Quiet hours" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("combobox", { name: "Daily limit" })).toHaveValue("3");
    expect(screen.queryByText(/Snoozed until/)).toBeNull();
  });

  it("calls the mode CPD, never CME", () => {
    render(<StatefulBlock initial={DEFAULT_REMINDER_SETTINGS} />);
    const block = screen.getByTestId("settings-reminders");
    expect(block).toHaveTextContent(/which CPD and On Call reminders show in the app/);
    expect(block.textContent).not.toMatch(/\bCME\b/);
  });

  it("changes a type's alert, its in-app switch, quiet hours and the daily limit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatefulBlock initial={DEFAULT_REMINDER_SETTINGS} onChange={onChange} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Compliance dates Phone calendar alert" }), "1d");
    expect(onChange.mock.lastCall?.[0].types["compliance-dates"].calendarAlert).toBe("1d");

    await user.click(screen.getByRole("switch", { name: "Teaching: Show in the app" }));
    expect(onChange.mock.lastCall?.[0].types.teaching.showInApp).toBe(false);

    expect(screen.queryByRole("combobox", { name: "From" })).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Quiet hours" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "From" }), "22:00");
    await user.selectOptions(screen.getByRole("combobox", { name: "Until" }), "06:00");
    expect(onChange.mock.lastCall?.[0].quietHours).toEqual({ enabled: true, start: "22:00", end: "06:00" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Daily limit" }), "5");
    const last = onChange.mock.lastCall?.[0] as ReminderSettings;
    expect(last.maxAlertsPerDay).toBe(5);
    // Earlier changes survive later ones.
    expect(last.types["compliance-dates"].calendarAlert).toBe("1d");
    expect(last.types.teaching.showInApp).toBe(false);
  });

  it("shows a running snooze and resumes it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StatefulBlock initial={snoozeReminder(DEFAULT_REMINDER_SETTINGS, "cpd-routines", TODAY)} onChange={onChange} />,
    );
    const row = screen.getByTestId("settings-reminder-cpd-routines-snoozed");
    expect(row).toHaveTextContent("Snoozed until 3 Oct 2026.");
    await user.click(within(row).getByRole("button", { name: "Resume CPD routines due" }));
    expect(onChange.mock.lastCall?.[0].types["cpd-routines"].snoozedUntil).toBeNull();
    expect(screen.queryByText(/Snoozed until/)).toBeNull();
  });

  it("sits in the Notifications section of the real dialog and saves the choice", async () => {
    const user = userEvent.setup();
    const { SettingsDialog } = await import("@/components/clinical-dashboard/settings-dialog");
    render(
      <SettingsDialog
        open
        onClose={() => {}}
        identity={{ displayName: "Local session", initials: "LS", detail: "Browser only", signedIn: true }}
        onSignOut={() => {}}
        onOpenGuide={() => {}}
      />,
    );
    const section = document.getElementById("settings-section-notifications")!;
    const block = within(section).getByTestId("settings-reminders");
    await user.selectOptions(within(block).getByRole("combobox", { name: "Teaching Phone calendar alert" }), "1h");
    const stored = JSON.parse(window.localStorage.getItem("clinical-kb-preferences") ?? "{}");
    expect(stored.reminders.types.teaching.calendarAlert).toBe("1h");
  });
});

describe("CME dashboard reminders", () => {
  const NOW = new Date("2026-09-26T02:00:00Z");
  const dueRoutine: CmeRoutine = {
    id: "invented-routine",
    title: "Invented peer group",
    cadence: "monthly",
    usualHours: 1,
    usualAllocations: [],
    nextDue: "2026-09-20",
    archivedAt: null,
  };
  const reportingReminder = { year: 2025, notCopied: 2, closesOn: "2026-03-01" };

  function renderDashboard(reminders?: ReminderSettings, onSnoozeReminder?: (type: string) => void) {
    return render(
      <CmeDashboard
        set={DEMO_CME_YEAR}
        entries={DEMO_CME_ENTRIES}
        now={NOW}
        routines={[dueRoutine]}
        reportingReminder={reportingReminder}
        reminders={reminders}
        onSnoozeReminder={onSnoozeReminder}
      />,
    );
  }

  it("shows the year-end banner and due routines by default, with no snooze buttons unless wired", () => {
    renderDashboard();
    expect(screen.getByTestId("cme-reporting-reminder")).toBeInTheDocument();
    expect(screen.getByTestId("cme-routines-due")).toHaveTextContent("Invented peer group");
    expect(screen.queryByRole("button", { name: /Snooze a week/ })).toBeNull();
  });

  it("offers a week's snooze on each nudge", async () => {
    const user = userEvent.setup();
    const onSnooze = vi.fn();
    renderDashboard(DEFAULT_REMINDER_SETTINGS, onSnooze);
    await user.click(screen.getByRole("button", { name: "Snooze a week: CPD year-end claim" }));
    await user.click(screen.getByRole("button", { name: "Snooze a week: CPD routines due" }));
    expect(onSnooze.mock.calls).toEqual([["cpd-year-end"], ["cpd-routines"]]);
  });

  it("hides a snoozed nudge until the snooze date", () => {
    renderDashboard(snoozeReminder(DEFAULT_REMINDER_SETTINGS, "cpd-year-end", "2026-09-26"));
    expect(screen.queryByTestId("cme-reporting-reminder")).toBeNull();
    expect(screen.getByTestId("cme-routines-due")).toBeInTheDocument();
    cleanup();
    // Snoozed until the 26th: shown again on the 26th itself.
    renderDashboard(snoozeReminder(DEFAULT_REMINDER_SETTINGS, "cpd-year-end", "2026-09-19"));
    expect(screen.getByTestId("cme-reporting-reminder")).toBeInTheDocument();
  });

  it("hides a type turned off in the app", () => {
    renderDashboard(updateReminderType(DEFAULT_REMINDER_SETTINGS, "cpd-routines", { showInApp: false }));
    expect(screen.queryByTestId("cme-routines-due")).toBeNull();
    expect(screen.getByTestId("cme-reporting-reminder")).toBeInTheDocument();
  });
});

describe("On Call notification snooze", () => {
  const entry = { id: "e", section: "contacts", details: {} } as unknown as OnCallEntry;
  const notifications: OnCallNotification[] = [
    { id: "a:compliance-date-passed", kind: "compliance-date-passed", title: "Invented course", detail: "x", entry },
    { id: "b:overdue", kind: "overdue", title: "Invented ward", detail: "y", entry },
  ];

  it("offers one snooze per reminder type in the list", async () => {
    const user = userEvent.setup();
    const onSnooze = vi.fn();
    render(<OnCallNotificationsPanel notifications={notifications} onSnooze={onSnooze} />);
    await user.click(screen.getByRole("button", { name: "Snooze compliance dates for a week" }));
    await user.click(screen.getByRole("button", { name: "Snooze On Call checks for a week" }));
    expect(onSnooze.mock.calls).toEqual([["compliance-dates"], ["on-call-checks"]]);
  });

  it("offers no snooze when there is nothing to snooze, or no handler", () => {
    render(<OnCallNotificationsPanel notifications={[]} onSnooze={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Snooze/ })).toBeNull();
    cleanup();
    render(<OnCallNotificationsPanel notifications={notifications} />);
    expect(screen.queryByRole("button", { name: /Snooze/ })).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AlertsBellPhoneSection, bellPhoneSubtitle } from "@/components/alerts/alerts-bell-phone-section";
import { DEFAULT_REMINDER_SETTINGS, mergeReminderSettings, type ReminderSettings } from "@/lib/reminders/settings";

afterEach(cleanup);

const on = mergeReminderSettings(DEFAULT_REMINDER_SETTINGS, { bellPhone: { enabled: true } });

describe("Bell reminders on the Alerts page", () => {
  it("says what will actually happen on this device", () => {
    expect(bellPhoneSubtitle(DEFAULT_REMINDER_SETTINGS, "on", false, false)).toBe("Off · they still show in the bell");
    expect(bellPhoneSubtitle(on, "off", false, false)).toBe("On · turn on phone alerts below to get them");
    expect(bellPhoneSubtitle(on, "on", true, false)).toBe("On · not on this shared computer");
    expect(bellPhoneSubtitle(on, "on", false, true)).toBe("On · when each falls due, after quiet hours");
    const allOff = mergeReminderSettings(on, {
      bellPhone: { areas: { "on-call": false, roster: false, cme: false, teaching: false, "my-work": false } },
    });
    expect(bellPhoneSubtitle(allOff, "on", false, false)).toBe("On · every area is off");
  });

  it("shows area switches only once it is on, and each switch saves", async () => {
    const onChange = vi.fn<(next: ReminderSettings) => void>();
    const { rerender } = render(
      <AlertsBellPhoneSection reminders={DEFAULT_REMINDER_SETTINGS} onChange={onChange} phone="on" shared={false} />,
    );
    expect(screen.queryByTestId("alerts-bell-phone-cme")).toBeNull();
    await userEvent.click(screen.getByRole("switch", { name: "Buzz my phone for bell reminders" }));
    expect(onChange.mock.calls[0]?.[0].bellPhone.enabled).toBe(true);

    rerender(<AlertsBellPhoneSection reminders={on} onChange={onChange} phone="on" shared={false} />);
    await userEvent.click(screen.getByRole("switch", { name: "CPD reminders buzz my phone" }));
    expect(onChange.mock.calls[1]?.[0].bellPhone.areas.cme).toBe(false);
    expect(screen.getByTestId("alerts-bell-phone-lock-screen").textContent).toContain("Something in My Day needs you");
  });
});

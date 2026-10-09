/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { addDays } from "@/lib/calendar/calendar-event";
import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";
import { bookingCalendarId } from "@/lib/work-screens/admin/bookings";
import {
  readBookingCalendarEvents,
  readBookingsSnapshot,
  resetBookings,
} from "@/lib/work-screens/admin/bookings-store";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/bookings",
  useRouter: () => router,
  useSearchParams: () => search.params,
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true }),
  useOptionalAccountData: () => ({ isAuthenticated: true }),
}));

// The sign-in dialog needs the auth provider, which a unit render does not mount.
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));

// Signed in, not a brand-new account: the example data switch follows only what the test sets.
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: "authenticated", session: null, authEpoch: 0 }),
}));

import { AdminBookingsPage } from "@/components/work-screens/admin/bookings-page";
import { AdminCoursesPage } from "@/components/work-screens/admin/courses-page";

const LOAD = { timeout: 5000 };
const BLS = "example:course-bls";
const ECT = "example:course-ect";
const GRAND_ROUND = "example:course-grand-round";

function withToasts(node: ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

function at(query: string) {
  search.params = new URLSearchParams(query);
}

function calendarEntry(courseId: string) {
  return readBookingCalendarEvents().find((event) => event.id === bookingCalendarId(courseId));
}

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
  resetBookings();
  router.push.mockClear();
  search.params = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  resetBookings();
  vi.restoreAllMocks();
});

describe("Example data off", () => {
  beforeEach(() => {
    act(() => setExampleDataOn(false));
  });

  it("Bookings says no courses are posted yet and offers the example", async () => {
    withToasts(<AdminBookingsPage />);
    const card = screen.getByTestId("admin-bookings-not-set-up");
    expect(card.textContent).toContain("No courses are posted yet");
    expect(within(card).getByRole("button", { name: "Try it with examples" })).toBeTruthy();
    expect(screen.queryByTestId("admin-bookings-open")).toBeNull();

    fireEvent.click(within(card).getByTestId("bookings-try-example"));
    expect(await screen.findByTestId("admin-bookings-open", undefined, LOAD)).toBeTruthy();
  });

  it("Courses shows the organiser's wording", () => {
    withToasts(<AdminCoursesPage />);
    const card = screen.getByTestId("admin-courses-not-set-up");
    expect(card.textContent).toContain("Posting courses is not switched on yet");
    expect(within(card).getByRole("button", { name: "Try it with examples" })).toBeTruthy();
  });
});

describe("Bookings with example data on", () => {
  beforeEach(() => {
    act(() => setExampleDataOn(true));
  });

  it("lists open courses, puts Basic life support under renewals, and filters to work requirements", async () => {
    withToasts(<AdminBookingsPage />);
    const open = await screen.findByTestId("admin-bookings-open", undefined, LOAD);
    expect(open.textContent).toContain("Respirator fit test");
    expect(open.textContent).toContain("Basic life support");
    expect(open.textContent).toContain("ECT credentialing session");
    // A draft and a past course are never open to book.
    expect(open.textContent).not.toContain("Clozapine prescribing");
    expect(open.textContent).not.toContain("Manual handling");
    expect(screen.getByTestId("admin-bookings-renewals").textContent).toContain("Basic life support");

    fireEvent.click(screen.getByTestId("admin-bookings-filter-requirement"));
    const filtered = screen.getByTestId("admin-bookings-open");
    expect(filtered.textContent).toContain("Respirator fit test");
    expect(filtered.textContent).toContain("Safe restraint refresher");
    expect(filtered.textContent).not.toContain("Basic life support");
    expect(filtered.textContent).not.toContain("Mental Health Act forms");
  });

  it("books a place on Basic life support: Booked, one fewer place, and in the calendar", async () => {
    at(`course=${BLS}`);
    withToasts(<AdminBookingsPage />);
    const detail = await screen.findByTestId("admin-bookings-detail", undefined, LOAD);
    expect(detail.textContent).toContain("4 of 12 left");
    expect(calendarEntry(BLS)).toBeUndefined();

    fireEvent.click(screen.getByTestId("admin-bookings-book"));
    expect(screen.getByTestId("admin-bookings-book-sheet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-bookings-book-confirm"));

    const after = screen.getByTestId("admin-bookings-detail");
    expect(within(after).getByText("Booked")).toBeTruthy();
    expect(after.textContent).toContain("3 of 12 left");
    expect(screen.getByTestId("admin-bookings-cancel").textContent).toContain("Cancel booking");
    const entry = calendarEntry(BLS);
    expect(entry).toMatchObject({ title: "Basic life support", startTime: "13:00" });
    expect(entry?.status).toBeUndefined();
  });

  it("offers the waitlist on a full course", async () => {
    at(`course=${ECT}`);
    withToasts(<AdminBookingsPage />);
    await screen.findByTestId("admin-bookings-detail", undefined, LOAD);
    expect(screen.getByTestId("admin-bookings-book").textContent).toContain("Join the waitlist");
    expect(screen.getByTestId("admin-bookings-availability").textContent).toContain("It's full");
  });

  it("cancelling a booking takes it off the calendar", async () => {
    at(`course=${GRAND_ROUND}`);
    withToasts(<AdminBookingsPage />);
    await screen.findByTestId("admin-bookings-detail", undefined, LOAD);
    expect(calendarEntry(GRAND_ROUND)?.status).toBeUndefined();

    fireEvent.click(screen.getByTestId("admin-bookings-cancel"));
    expect(screen.getByTestId("admin-bookings-cancel-sheet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-bookings-cancel-confirm"));

    const entry = calendarEntry(GRAND_ROUND);
    expect(entry === undefined || entry.status === "cancelled").toBe(true);
    expect(screen.getByTestId("admin-bookings-book").textContent).toContain("Book a place");
  });

  it("My bookings shows the organiser's change and the waitlist", async () => {
    at("view=mine");
    withToasts(<AdminBookingsPage />);
    const change = await screen.findByTestId(`bookings-change-${GRAND_ROUND}`, undefined, LOAD);
    expect(change.textContent).toContain("Grand round presenting changed");
    expect(change.textContent).toContain("Your calendar is already updated.");
    const waitlist = screen.getByTestId("admin-bookings-mine-waitlist");
    expect(waitlist.textContent).toContain("Mental Health Act forms");
    expect(waitlist.textContent).toContain("in line");
    expect(screen.getByTestId("admin-bookings-mine-booked").textContent).toContain("Grand round presenting");
  });
});

describe("Courses with example data on", () => {
  beforeEach(() => {
    act(() => setExampleDataOn(true));
  });

  it("will not post an empty form, then posts a valid one and opens it", async () => {
    at("new=1");
    withToasts(<AdminCoursesPage />);
    await screen.findByTestId("admin-courses-form", undefined, LOAD);
    const before = readBookingsSnapshot().state.courses.length;

    fireEvent.click(screen.getByTestId("admin-courses-submit"));
    expect(screen.getByText("Add a title.")).toBeTruthy();
    expect(screen.getByText("Add where it is.")).toBeTruthy();
    expect(readBookingsSnapshot().state.courses).toHaveLength(before);
    expect(router.push).not.toHaveBeenCalled();

    const today = (screen.getByTestId("admin-courses-date") as HTMLInputElement).min;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(screen.getByTestId("admin-courses-title"), { target: { value: "Wellbeing workshop" } });
    fireEvent.change(screen.getByTestId("admin-courses-date"), { target: { value: addDays(today, 21) } });
    fireEvent.change(screen.getByTestId("admin-courses-start"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByTestId("admin-courses-end"), { target: { value: "10:30" } });
    fireEvent.change(screen.getByTestId("admin-courses-location"), { target: { value: "Seminar room 3" } });
    fireEvent.change(screen.getByTestId("admin-courses-capacity"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("admin-courses-submit"));

    const courses = readBookingsSnapshot().state.courses;
    expect(courses).toHaveLength(before + 1);
    const posted = courses.at(-1)!;
    expect(posted).toMatchObject({ title: "Wellbeing workshop", status: "posted", capacity: 10 });
    expect(posted.id.startsWith("example:")).toBe(true);
    expect(router.push).toHaveBeenCalledWith(ADMIN_WORK_SCREEN_HREFS.organiserCourse(posted.id));
  });

  it("asks before moving a booked course's time, naming the change", async () => {
    at(`course=${BLS}`);
    withToasts(<AdminCoursesPage />);
    await screen.findByTestId("admin-courses-detail", undefined, LOAD);
    fireEvent.click(screen.getByTestId("admin-courses-edit"));
    fireEvent.change(screen.getByTestId("admin-courses-start"), { target: { value: "14:00" } });
    fireEvent.click(screen.getByTestId("admin-courses-save"));

    const sheet = screen.getByTestId("admin-courses-confirm-sheet");
    expect(sheet.textContent).toContain("Save changes?");
    expect(sheet.textContent).toContain("Time: 13:00 to 16:30 now 14:00 to 16:30");
    expect(screen.getByTestId("admin-courses-confirm").textContent).toContain("Save and update 8 calendars");
    // Nothing moves until the organiser confirms.
    expect(readBookingsSnapshot().state.courses.find((course) => course.id === BLS)?.startTime).toBe("13:00");

    fireEvent.click(screen.getByTestId("admin-courses-confirm"));
    const saved = readBookingsSnapshot().state.courses.find((course) => course.id === BLS);
    expect(saved?.startTime).toBe("14:00");
    expect(saved?.change?.summary).toContain("Time: 13:00 to 16:30 now 14:00 to 16:30");
  });
});

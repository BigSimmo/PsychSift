/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HospitalStartersOutcome } from "@/lib/work-roles/hospital-starters-client";
import type { HospitalStarter } from "@/lib/work-roles/hospital-starters-model";

const H1 = "11111111-1111-4111-8111-111111111111";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/hospital/starters",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/work-time/use-work-time-zone", () => ({
  useWorkTimeZone: () => ({ zone: "Australia/Perth" }),
}));

const screenState = vi.hoisted(() => ({
  roles: { status: "ready", grants: [] as unknown[] } as Record<string, unknown>,
}));

vi.mock("@/components/work-screens/hospital/hospital-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/work-screens/hospital/hospital-shared")>();
  return {
    ...actual,
    HospitalHeading: ({ title }: { title: string }) => <h1>{title}</h1>,
    useHospitalScreenState: () => ({
      roles: screenState.roles,
      signedOut: false,
      showExample: false,
      turnOnExample: vi.fn(),
      online: true,
    }),
    useAdminHospitalList: () => ({ status: "off", retry: vi.fn() }),
  };
});

const outcome = vi.hoisted(() => ({ value: null as HospitalStartersOutcome | null }));
vi.mock("@/lib/work-roles/hospital-starters-client", () => ({
  fetchHospitalStarters: async () => outcome.value,
}));

import { AdminHospitalStartersPage } from "@/components/work-screens/hospital/hospital-starters-page";

const view = (starters: HospitalStarter[], teams = [{ serviceId: "t1", name: "Ward A" }]) =>
  ({ status: "ok", data: { hospital: { id: H1, name: "Example Hospital" }, teams, starters } }) as const;

function starter(id: string, startsOn: string | null, toDo: string[] = ["Pager collected"]): HospitalStarter {
  return { id, name: `Dr ${id} Example`, teams: ["Ward A"], startsOn, done: 1, total: 1 + toDo.length, toDo };
}

const day = (offset: number) => {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
};

beforeEach(() => {
  screenState.roles = { status: "ready", grants: [{ role: "workforce", hospitalId: H1, serviceIds: ["t1"] }] };
});

afterEach(() => {
  cleanup();
});

describe("AdminHospitalStartersPage", () => {
  it("explains how doctors share when nobody is sharing yet", async () => {
    outcome.value = view([]);
    render(<AdminHospitalStartersPage />);
    const empty = await screen.findByTestId("admin-hospital-starters-empty");
    expect(empty).toHaveTextContent("Nobody is sharing yet");
    expect(empty).toHaveTextContent("Doctors choose to share from their own New job page");
  });

  it("says when no teams are linked", async () => {
    outcome.value = view([], []);
    render(<AdminHospitalStartersPage />);
    expect(await screen.findByTestId("admin-hospital-starters-no-teams")).toHaveTextContent("No teams linked yet");
  });

  it("shows a failed read as a failure with Try again, never as nobody sharing", async () => {
    outcome.value = { status: "error", message: null };
    render(<AdminHospitalStartersPage />);
    expect(await screen.findByTestId("admin-hospital-starters-error")).toBeTruthy();
    expect(screen.queryByTestId("admin-hospital-starters-empty")).toBeNull();
  });

  it("lists the nearest start first and folds away starters from more than four weeks ago", async () => {
    outcome.value = view([starter("later", day(20)), starter("soon", day(2)), starter("old", day(-40))]);
    render(<AdminHospitalStartersPage />);
    const upcoming = await screen.findByTestId("admin-hospital-starters-group-upcoming");
    const names = [...upcoming.querySelectorAll(".work-row__title")].map((node) => node.textContent);
    expect(names).toEqual(["Dr soon Example", "Dr later Example"]);
    expect(upcoming).toHaveTextContent("Still to do: Pager collected");
    expect(screen.queryByText("Dr old Example")).toBeNull();
    const toggle = screen.getByTestId("admin-hospital-starters-past-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByText("Dr old Example")).toBeTruthy();
  });

  it("is for Medical Workforce and the administrator only", () => {
    screenState.roles = { status: "ready", grants: [{ role: "dct", hospitalId: H1, serviceIds: ["t1"] }] };
    render(<AdminHospitalStartersPage />);
    expect(screen.getByTestId("admin-hospital-starters-not-for-you")).toBeTruthy();
  });
});

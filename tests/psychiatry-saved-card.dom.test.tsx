/** @vitest-environment jsdom */

// The Psychiatry hub's Saved page groups what the reader starred by kind, and says so when only some
// saved items loaded, rather than showing a short list, or "Nothing saved", as if it were complete.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileText } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

let hookValue: { items: unknown[]; status: string; refetch: () => void };
vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => hookValue,
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="sign-in-dialog" /> : null),
}));

import { PsychiatrySavedCard } from "@/components/psychiatry/psychiatry-saved-card";

afterEach(cleanup);

const item = (type: string, id: string, title: string) => ({
  id: `${type}:${id}`,
  type,
  title,
  meta: "Meta line",
  set: "Saved",
  href: `/${type}/${id}`,
  icon: FileText,
});
const form = item("forms", "form-1a", "Form 1A");
const differential = item("differentials", "low-mood", "Low mood");
const therapy = item("therapies", "ba", "Behavioural activation");
const service = item("services", "a", "A clinic");

describe("PsychiatrySavedCard", () => {
  it("keeps what loaded and warns, with 'at least', when some saved items failed", () => {
    hookValue = { items: [form, differential], status: "partial", refetch: vi.fn() };
    render(<PsychiatrySavedCard />);
    expect(screen.getByTestId("psychiatry-saved-partial")).toHaveTextContent(
      "Some saved items could not load, so this list may be incomplete. Showing at least 2.",
    );
    expect(screen.getByTestId("psychiatry-saved-filter-all")).toHaveTextContent("All 2+");
    expect(screen.getByTestId("psychiatry-saved-filter-therapies")).toHaveTextContent("Therapies –");
    expect(screen.getByRole("link", { name: /Form 1A/ })).toHaveAttribute("href", "/forms/form-1a");
  });

  it("does not claim nothing is saved when the only loaded item is a service", () => {
    hookValue = { items: [service], status: "partial", refetch: vi.fn() };
    render(<PsychiatrySavedCard />);
    expect(screen.getByTestId("psychiatry-saved-partial")).toBeTruthy();
    expect(screen.queryByTestId("psychiatry-saved-empty")).toBeNull();
    expect(screen.queryByText("A clinic")).toBeNull();
  });

  it("groups by kind with counts that add up, and filters to one kind", () => {
    hookValue = { items: [form, differential, therapy, service], status: "ready", refetch: vi.fn() };
    render(<PsychiatrySavedCard />);
    expect(screen.getByTestId("psychiatry-saved-filter-all")).toHaveTextContent("All 3");
    expect(screen.getByTestId("psychiatry-saved-forms")).toHaveTextContent("Form 1A");
    expect(screen.getByTestId("psychiatry-saved-differentials")).toHaveTextContent("Low mood");
    fireEvent.click(screen.getByTestId("psychiatry-saved-filter-therapies"));
    expect(screen.getByTestId("psychiatry-saved-filter-therapies")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("psychiatry-saved-forms")).toBeNull();
    expect(screen.getByTestId("psychiatry-saved-therapies")).toHaveTextContent("Behavioural activation");
  });

  it("asks a signed-out reader to sign in, with the app’s own dialog", async () => {
    hookValue = { items: [], status: "unauthorized", refetch: vi.fn() };
    render(<PsychiatrySavedCard />);
    expect(screen.getByTestId("psychiatry-saved-signed-out")).toHaveTextContent("Sign in to see what you’ve saved.");
    fireEvent.click(screen.getByTestId("psychiatry-saved-sign-in"));
    expect(await screen.findByTestId("sign-in-dialog")).toBeTruthy();
  });
});

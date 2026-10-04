/** @vitest-environment jsdom */

// The Psychiatry hub's Saved page says so when only some saved items loaded,
// rather than showing a short list, or "Nothing saved", as if it were complete.

import { cleanup, render, screen } from "@testing-library/react";
import { FileText } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

let hookValue: { items: unknown[]; status: string; refetch: () => void };
vi.mock("@/components/clinical-dashboard/use-saved-registry-favourites", () => ({
  useSavedRegistryFavourites: () => hookValue,
}));

import { PsychiatrySavedCard } from "@/components/psychiatry/psychiatry-saved-card";

afterEach(cleanup);

const form = { id: "f1", type: "forms", title: "Form 1A", set: "Forms", href: "/forms/form-1a", icon: FileText };
const service = { id: "s1", type: "services", title: "A clinic", set: "Services", href: "/services/a", icon: FileText };

describe("PsychiatrySavedCard", () => {
  it("keeps what loaded and warns when some saved items failed", () => {
    hookValue = { items: [form], status: "partial", refetch: vi.fn() };
    render(<PsychiatrySavedCard />);
    expect(screen.getByTestId("psychiatry-saved-partial")).toHaveTextContent(/may be incomplete/);
    expect(screen.getByRole("link", { name: /Form 1A/ })).toHaveAttribute("href", "/forms/form-1a");
  });

  it("does not claim nothing is saved when the only loaded item is a service", () => {
    hookValue = { items: [service], status: "partial", refetch: vi.fn() };
    render(<PsychiatrySavedCard />);
    expect(screen.getByTestId("psychiatry-saved-partial")).toBeTruthy();
    expect(screen.queryByTestId("psychiatry-saved-empty")).toBeNull();
  });
});

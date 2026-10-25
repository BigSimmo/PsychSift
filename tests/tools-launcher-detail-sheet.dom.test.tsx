/** @vitest-environment jsdom */

// The quick shortcuts on the Tools home are drawn whatever filter is active. The
// detail sheet used to be fed the highlighted card, which falls back to the first
// filtered tool when the tapped one is filtered out, so tapping "Safety check"
// under the Evidence filter opened a Documents-style reference tool instead.

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationsLauncherWorkspace } from "@/components/applications-launcher-page";

const authSession = vi.hoisted(() => ({
  status: "signed_out" as string,
  session: null,
  isConfigured: true,
  error: null,
  notice: null,
  signInWithEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/tools",
}));

vi.mock("@/components/clinical-dashboard/search-command-context", () => ({
  useSearchCommand: () => null,
}));

afterEach(cleanup);

describe("Tools launcher detail sheet", () => {
  it("opens the tapped shortcut's tool even when the active filter hides it", async () => {
    const user = userEvent.setup();
    render(<ApplicationsLauncherWorkspace canAccessFavourites={false} />);

    await user.click(screen.getByRole("radio", { name: /Evidence/ }));
    await user.click(screen.getAllByTestId("tool-shortcut-risk-safety")[0]);

    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Risk & Safety" })).toBeTruthy();
    const open = within(sheet).getByRole("link", { name: /Open safety check/ });
    expect(open.getAttribute("href")).toBe("/?mode=answer&q=safety%20check&focus=1");
    // The duplicate "View example" link went to the same route as the main action.
    expect(within(sheet).queryByRole("link", { name: /View example/ })).toBeNull();
  });
});

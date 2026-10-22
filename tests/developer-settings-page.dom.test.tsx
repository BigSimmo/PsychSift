import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeveloperSettingsCheckPage from "@/app/(admin)/admin/developer-hub/settings/page";
import type { SettingsCheck } from "@/lib/developer-area/settings-check";

// PanelPageShell's back control is a ContextualBackLink, which calls
// next/navigation's useRouter. Outside an app-router tree that throws.
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/developer-hub/settings",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

// `connection()` needs a request scope; the page only awaits it.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

/**
 * Only the resolver is mocked. The row builder and summary stay real, so the
 * page is exercised against the same rows production would compute. The access
 * rule and the no-value rule are owned by tests/developer-settings-check.test.ts.
 */
const source = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

vi.mock("@/lib/developer-area/settings-check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/developer-area/settings-check")>();
  return {
    ...actual,
    resolveSettingsCheck: async (): Promise<SettingsCheck> =>
      source.value === null
        ? { kind: "unauthorized" }
        : { kind: "checked", rows: actual.buildSettingsCheckRows(source.value) },
  };
});

afterEach(() => {
  source.value = null;
});

describe("developer settings check page", () => {
  it("shows a sign-in message and no rows to anyone without the administrator claim", async () => {
    render(await DeveloperSettingsCheckPage());

    expect(screen.getByTestId("developer-settings")).toBeInTheDocument();
    expect(screen.getByTestId("developer-settings-unauthorized")).toHaveTextContent(
      "Sign in as an administrator to see settings.",
    );
    expect(screen.queryByTestId("developer-settings-summary")).toBeNull();
    expect(screen.queryAllByTestId(/^developer-settings-row-/)).toHaveLength(0);
  });

  it("says values never leave the server and that the page changes nothing", async () => {
    render(await DeveloperSettingsCheckPage());
    expect(screen.getByTestId("developer-settings")).toHaveTextContent(/values never leave the server/);
    expect(screen.getByTestId("developer-settings")).toHaveTextContent(/this page changes nothing/);
  });

  it("summarises what needs attention and lists it with a link to the row", async () => {
    source.value = { RAG_PERSIST_ANSWER_TEXT: "true" };
    render(await DeveloperSettingsCheckPage());

    const attention = screen.getByTestId("developer-settings-count-attention");
    expect(Number(attention.textContent)).toBeGreaterThan(0);
    const list = screen.getByTestId("developer-settings-attention-list");
    expect(within(list).getByRole("link", { name: "Save answer text" })).toHaveAttribute(
      "href",
      "#setting-RAG_PERSIST_ANSWER_TEXT",
    );

    const row = screen.getByTestId("developer-settings-row-RAG_PERSIST_ANSWER_TEXT");
    expect(row).toHaveAttribute("data-attention", "true");
    expect(row).toHaveTextContent("Expected: Off");
    expect(screen.getByTestId("developer-settings-state-RAG_PERSIST_ANSWER_TEXT")).toHaveTextContent("On");
  });

  it("renders each group, the key in small text, and an as-built note only for NEXT_PUBLIC_ settings", async () => {
    source.value = { NEXT_PUBLIC_SUPABASE_URL: "https://sjrfecxgysukkwxsowpy.supabase.co" };
    render(await DeveloperSettingsCheckPage());

    for (const group of ["privacy", "answer-engine", "connections", "alerts-and-access"]) {
      expect(screen.getByTestId(`developer-settings-group-${group}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("developer-settings-row-OPENAI_API_KEY")).toHaveTextContent("OPENAI_API_KEY");
    expect(screen.getByTestId("developer-settings-as-built-NEXT_PUBLIC_SUPABASE_URL")).toHaveTextContent("As built");
    expect(screen.queryByTestId("developer-settings-as-built-OPENAI_API_KEY")).toBeNull();
    expect(screen.getByTestId("developer-settings-row-RAG_SEMANTIC_RERANK_ENABLED")).toHaveTextContent(
      "No fixed expectation",
    );
  });

  it("never renders a heavy font weight", async () => {
    source.value = {};
    const { container } = render(await DeveloperSettingsCheckPage());
    const body = container.querySelector("[data-testid='developer-settings-summary']")!.parentElement!;
    const groups = Array.from(
      body.querySelectorAll("[data-testid^='developer-settings-group-'], [data-testid='developer-settings-summary']"),
    );
    for (const element of groups) {
      expect(element.innerHTML).not.toMatch(/font-(bold|extrabold|black)/);
    }
  });
});

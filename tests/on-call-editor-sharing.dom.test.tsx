/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";

/**
 * Only a site administrator may share an On Call entry with everyone signed in (owner decision,
 * 25 Oct 2026). The editor does not offer an ordinary account a share it would be refused.
 */

const auth = vi.hoisted(() => ({ current: null as null | { status: string; session: unknown } }));

vi.mock("@/lib/example-data/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/example-data/store")>()),
  useAuthIfAvailable: () => auth.current,
}));

import { OnCallEntryEditor } from "@/components/on-call/on-call-entry-editor";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  auth.current = null;
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SHARED_CONTACT: OnCallEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  section: "contacts",
  slug: "ed-registrar",
  title: "ED registrar",
  subtitle: null,
  body: null,
  details: { role: "ED registrar", phone: "0412 345 678" },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: false,
  includeOnCard: true,
  sortOrder: 0,
  lastVerifiedAt: null,
};

function signedIn(appMetadata: Record<string, unknown>) {
  auth.current = { status: "authenticated", session: { user: { id: "u1", app_metadata: appMetadata } } };
}

describe("OnCallEntryEditor — who may share an entry", () => {
  it("tells an ordinary account its entry is private, and saves it private and off the card", async () => {
    signedIn({});
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: { ...SHARED_CONTACT, isPersonal: true } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="contacts" entry={null} onSaved={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole("checkbox", { name: /^Private — only you/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /^Include on printable card/ })).toBeNull();
    expect(screen.getByTestId("on-call-entry-editor-administrator-privacy")).toHaveTextContent(
      /only an administrator can share/i,
    );

    await user.type(screen.getByLabelText(/^Title/), "My mobile");
    await user.type(screen.getByLabelText(/^Role/), "Me");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.isPersonal).toBe(true);
    expect(body.includeOnCard).toBe(false);
  });

  it("keeps the share choice for an administrator", () => {
    signedIn({ site_role: "administrator" });
    render(<OnCallEntryEditor open section="contacts" entry={SHARED_CONTACT} onSaved={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: /^Private — only you/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Include on printable card/ })).toBeChecked();
    expect(screen.queryByTestId("on-call-entry-editor-administrator-privacy")).toBeNull();
  });
});

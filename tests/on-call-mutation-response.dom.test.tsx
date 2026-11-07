/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { startTransition, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnCallEntryEditor, OnCallVerifyButton } from "@/components/on-call/on-call-entry-editor";
import { cacheOnCallEntries, clearOnCallEntryCache } from "@/lib/on-call/entry-store";
import { patchEntry } from "@/components/admin/junior/junior-shared";
import { onCallEntryFixture } from "./helpers/on-call-entry-fixture";

const entry = onCallEntryFixture({
  section: "contacts",
  title: "Synthetic contact",
  updatedAt: "2026-11-05T12:00:00.123456+00:00",
  details: { role: "Synthetic role" },
  lastVerifiedAt: null,
});
const other = { ...entry, id: "99999999-9999-4999-8999-999999999999" };

afterEach(() => {
  cleanup();
  clearOnCallEntryCache();
  vi.restoreAllMocks();
});

describe("On Call update response identity", () => {
  it("refuses a versionless legacy row before sending verification", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ entry }));
    render(<OnCallVerifyButton entry={{ ...entry, updatedAt: undefined }} onVerified={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Still correct" }));
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/reload/i);
  });

  it("refuses a valid verification response for a different row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ entry: other }));
    const onVerified = vi.fn();
    render(<OnCallVerifyButton entry={entry} onVerified={onVerified} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Still correct" }));
    await screen.findByRole("alert");
    expect(onVerified).not.toHaveBeenCalled();
  });

  it.each(["edited", "deleted"])("does not apply a delayed verification after its row is %s", async (change) => {
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    cacheOnCallEntries([entry]);
    const onVerified = vi.fn();
    render(<OnCallVerifyButton entry={entry} onVerified={onVerified} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Still correct" }));
    cacheOnCallEntries(change === "edited" ? [{ ...entry, title: "Newer synthetic edit" }] : []);
    await act(async () => {
      release(Response.json({ entry: { ...entry, lastVerifiedAt: "2026-11-05T12:00:00Z" } }));
    });
    expect(onVerified).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/changed|removed/i);
  });

  it("accepts a delayed verification when only an unrelated row changed", async () => {
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    cacheOnCallEntries([entry, other]);
    const onVerified = vi.fn();
    render(<OnCallVerifyButton entry={entry} onVerified={onVerified} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Still correct" }));
    cacheOnCallEntries([entry, { ...other, title: "Unrelated edit" }]);
    const verified = { ...entry, lastVerifiedAt: "2026-11-05T12:00:00Z" };
    await act(async () => {
      release(Response.json({ entry: verified }));
    });
    expect(onVerified).toHaveBeenCalledWith(verified);
    expect(fetch).toHaveBeenCalledWith(`/api/on-call/entries/${entry.id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: "2026-11-05T12:00:00.123456+00:00" }),
    });
  });

  it("accepts the visible row's verification after an uncommitted suspended render", async () => {
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const suspended = new Promise<void>(() => {});
    const attempted = vi.fn();
    function SuspendCandidate({ blocked }: { blocked: boolean }) {
      if (blocked) {
        attempted();
        throw suspended;
      }
      return null;
    }
    const onVerified = vi.fn();
    const content = (candidate: typeof entry, blocked: boolean) => (
      <Suspense fallback={<p>Loading candidate</p>}>
        <OnCallVerifyButton entry={candidate} onVerified={onVerified} />
        <SuspendCandidate blocked={blocked} />
      </Suspense>
    );
    const view = render(content(entry, false));
    await userEvent.setup().click(screen.getByRole("button", { name: "Still correct" }));
    await act(async () => {
      startTransition(() => {
        view.rerender(content({ ...entry, title: "Uncommitted candidate" }, true));
      });
    });
    expect(attempted).toHaveBeenCalled();
    expect(screen.queryByText("Loading candidate")).not.toBeInTheDocument();
    const verified = { ...entry, lastVerifiedAt: "2026-11-05T12:00:00Z" };
    await act(async () => {
      release(Response.json({ entry: verified }));
    });
    expect(onVerified).toHaveBeenCalledWith(verified);
  });

  it("refuses the previous row's delayed verification after a committed prop change", async () => {
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const onVerified = vi.fn();
    const view = render(<OnCallVerifyButton entry={entry} onVerified={onVerified} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Still correct" }));
    view.rerender(<OnCallVerifyButton entry={{ ...entry, title: "Committed edit" }} onVerified={onVerified} />);
    await act(async () => {
      release(Response.json({ entry: { ...entry, lastVerifiedAt: "2026-11-05T12:00:00Z" } }));
    });
    expect(onVerified).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/changed/i);
  });

  it("does not deliver a delayed verification after its button unmounts", async () => {
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const onVerified = vi.fn();
    const view = render(<OnCallVerifyButton entry={entry} onVerified={onVerified} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Still correct" }));
    view.unmount();
    await act(async () => {
      release(Response.json({ entry: { ...entry, lastVerifiedAt: "2026-11-05T12:00:00Z" } }));
    });
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("keeps the editor open when a PATCH returns a different valid row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ entry: other }));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<OnCallEntryEditor open section="contacts" entry={entry} onSaved={onSaved} onClose={onClose} />);
    await user.type(screen.getByLabelText("Subtitle"), "Synthetic edit");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));
    await waitFor(() => expect(screen.getByText("Save response was invalid.")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses a common Admin PATCH response for a different valid row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ entry: other }));
    await expect(patchEntry(entry.id, {})).rejects.toThrow("Save response was invalid.");
  });
});

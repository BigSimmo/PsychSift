/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { OnCallEntryEditor, OnCallVerifyButton } from "@/components/on-call/on-call-entry-editor";
import { OnCallFreshnessBadge } from "@/components/on-call/on-call-freshness-badge";
import { clearOnCallEntryCache } from "@/lib/on-call/entry-cache-keys";
import { COMPLIANCE_KIND } from "@/lib/on-call/compliance";
import { ON_CALL_RECURRENCE_FREQUENCIES, onCallEntryFreshness, type OnCallEntry } from "@/lib/on-call/entry-model";
import { ROLE_EXPLAINER_KIND } from "@/lib/on-call/who-is-who";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const NOW = new Date("2026-09-04T00:00:00.000Z");

const ED_REGISTRAR: OnCallEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  section: "contacts",
  slug: "ed-registrar",
  title: "ED registrar",
  subtitle: null,
  body: null,
  details: { role: "ED registrar", phone: "0412 345 678" },
  linkedDocumentIds: [],
  tags: ["Emergency Department"],
  isPersonal: false,
  includeOnCard: true,
  sortOrder: 3,
  lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
};

const STALE_ANAESTHETIST: OnCallEntry = {
  id: "33333333-3333-4333-8333-333333333333",
  section: "contacts",
  slug: "on-call-anaesthetist",
  updatedAt: "2026-11-05T00:00:00.123456+00:00",
  title: "On-call anaesthetist",
  subtitle: null,
  body: null,
  details: { role: "On-call anaesthetist", phone: "0400 000 000" },
  linkedDocumentIds: [],
  tags: ["Theatre"],
  isPersonal: false,
  includeOnCard: false,
  sortOrder: 0,
  lastVerifiedAt: new Date("2020-01-01T00:00:00.000Z").toISOString(),
};

describe("On Call editor account transitions", () => {
  it("closes a retained draft on a session change so it cannot be saved as the next account", async () => {
    const user = userEvent.setup();
    const request = vi.spyOn(globalThis, "fetch");
    const props = { open: true, section: "contacts" as const, entry: null, onSaved: vi.fn(), onClose: vi.fn() };
    const view = render(<OnCallEntryEditor {...props} />);
    await user.type(screen.getByLabelText(/^Title/), "Synthetic account A private draft");
    await user.type(screen.getByLabelText(/^Role/), "Synthetic role");
    act(() => clearOnCallEntryCache());
    view.rerender(<OnCallEntryEditor {...props} />);
    expect(screen.queryByDisplayValue("Synthetic account A private draft")).toBeNull();
    expect(screen.queryByTestId("on-call-entry-editor-save")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    // Explicitly closing/reopening gives the new account a fresh draft.
    view.rerender(<OnCallEntryEditor {...props} open={false} />);
    view.rerender(<OnCallEntryEditor {...props} />);
    expect(screen.getByLabelText(/^Title/)).toHaveValue("");
  });

  it.each(["save", "delete", "verify"])(
    "suppresses a late %s callback and close after the account changes",
    async (operation) => {
      const user = userEvent.setup();
      let release!: (response: Response) => void;
      const request = vi.spyOn(globalThis, "fetch").mockReturnValue(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      );
      const onSaved = vi.fn();
      const onDeleted = vi.fn();
      const onClose = vi.fn();
      render(
        <OnCallEntryEditor
          open
          section="contacts"
          entry={STALE_ANAESTHETIST}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onClose={onClose}
        />,
      );
      if (operation === "save") {
        await user.type(screen.getByLabelText("Subtitle"), "Synthetic update");
        await user.click(screen.getByTestId("on-call-entry-editor-save"));
      } else if (operation === "verify") {
        await user.click(screen.getByTestId(`on-call-verify-${STALE_ANAESTHETIST.slug}`));
      } else {
        await user.click(screen.getByTestId("on-call-entry-editor-delete"));
        await user.click(screen.getByRole("button", { name: `Delete ${STALE_ANAESTHETIST.title}` }));
      }
      expect(request).toHaveBeenCalledTimes(1);
      clearOnCallEntryCache();
      await act(async () => {
        release(jsonResponse({ entry: STALE_ANAESTHETIST, deleted: true }));
      });
      expect(onSaved).not.toHaveBeenCalled();
      expect(onDeleted).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
  );
});

describe("OnCallEntryEditor — creating", () => {
  it("posts a new entry with the fields entered and hands the saved entry back", async () => {
    const user = userEvent.setup();
    const created: OnCallEntry = { ...ED_REGISTRAR, id: "22222222-2222-4222-8222-222222222222", slug: "new-registrar" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: created }));
    vi.stubGlobal("fetch", fetchMock);

    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(<OnCallEntryEditor open section="contacts" entry={null} onSaved={onSaved} onClose={onClose} />);

    await user.type(screen.getByLabelText(/^Title/), "New registrar");
    await user.type(screen.getByLabelText(/^Role/), "New ED registrar");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/on-call/entries");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.section).toBe("contacts");
    expect(body.title).toBe("New registrar");
    expect(body.details).toEqual({ role: "New ED registrar" });
    // No id is sent on create — the server assigns it.
    expect(body.id).toBeUndefined();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("OnCallEntryEditor — editing", () => {
  it("sends a PATCH carrying the FULL entry, not just the changed field", async () => {
    const user = userEvent.setup();
    const saved: OnCallEntry = { ...ED_REGISTRAR, subtitle: "Updated" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: saved }));
    vi.stubGlobal("fetch", fetchMock);

    const onSaved = vi.fn();
    render(<OnCallEntryEditor open section="contacts" entry={ED_REGISTRAR} onSaved={onSaved} onClose={vi.fn()} />);

    const subtitleField = screen.getByLabelText("Subtitle");
    await user.type(subtitleField, "Updated");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/on-call/entries/${ED_REGISTRAR.id}`);
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    // The ruling this editor exists to satisfy: every field round-trips, most
    // importantly the freshness record, even though only the subtitle changed.
    expect(body.lastVerifiedAt).toBe(ED_REGISTRAR.lastVerifiedAt);
    expect(body.sortOrder).toBe(ED_REGISTRAR.sortOrder);
    expect(body.slug).toBe(ED_REGISTRAR.slug);
    expect(body.tags).toEqual(ED_REGISTRAR.tags);
    expect(body.includeOnCard).toBe(ED_REGISTRAR.includeOnCard);
    expect(body.subtitle).toBe("Updated");
    expect(body.details).toEqual(ED_REGISTRAR.details);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });

  it("pre-fills the per-section fields from the entry being edited", () => {
    render(<OnCallEntryEditor open section="contacts" entry={ED_REGISTRAR} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/^Title/)).toHaveValue("ED registrar");
    expect(screen.getByLabelText(/^Role/)).toHaveValue("ED registrar");
    expect(screen.getByLabelText("Direct phone")).toHaveValue("0412 345 678");
  });
});

describe("OnCallEntryEditor — deleting", () => {
  it("guards delete with a ConfirmDialog whose confirm label names the actual entry, then calls DELETE", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deleted: true, id: ED_REGISTRAR.id }));
    vi.stubGlobal("fetch", fetchMock);

    const onDeleted = vi.fn();
    const onClose = vi.fn();
    render(
      <OnCallEntryEditor
        open
        section="contacts"
        entry={ED_REGISTRAR}
        onSaved={vi.fn()}
        onDeleted={onDeleted}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByTestId("on-call-entry-editor-delete"));

    const dialog = await screen.findByTestId("confirm-dialog");
    // Never "Confirm" — the label names the entry, not a generic verb.
    const confirmButton = within(dialog).getByRole("button", { name: "Delete ED registrar" });
    expect(within(dialog).queryByRole("button", { name: "Confirm" })).toBeNull();

    await user.click(confirmButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/on-call/entries/${ED_REGISTRAR.id}`);
    expect(init.method).toBe("DELETE");

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(ED_REGISTRAR.id));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not offer delete when the caller supplies no onDeleted (create-only use)", () => {
    render(<OnCallEntryEditor open section="contacts" entry={null} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId("on-call-entry-editor-delete")).toBeNull();
  });
});

describe("OnCallEntryEditor — per-section fields follow the chosen section", () => {
  it('shows the contacts-specific fields (Role, Direct phone) for section="contacts"', () => {
    render(<OnCallEntryEditor open section="contacts" entry={null} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/^Role/)).toBeInTheDocument();
    expect(screen.getByLabelText("Direct phone")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Category/)).toBeNull();
    expect(screen.queryByLabelText(/^Trigger/)).toBeNull();
  });

  it('shows the logistics-specific fields (a Category select) for section="logistics", not the contacts fields', () => {
    render(<OnCallEntryEditor open section="logistics" entry={null} onSaved={vi.fn()} onClose={vi.fn()} />);
    const categoryField = screen.getByLabelText(/^Category/);
    expect(categoryField.tagName).toBe("SELECT");
    expect(screen.queryByLabelText(/^Role/)).toBeNull();
    expect(screen.queryByLabelText("Direct phone")).toBeNull();
  });

  it('shows the playbook-specific Trigger field for section="playbook"', () => {
    render(<OnCallEntryEditor open section="playbook" entry={null} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/^Trigger/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Escalation steps/)).toBeInTheDocument();
  });
});

describe("OnCallEntryEditor — validation", () => {
  it("surfaces a required-field validation error through FieldError and does not call the API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="contacts" entry={null} onSaved={vi.fn()} onClose={vi.fn()} />);

    // Title is filled but the section-required "Role" field is left blank.
    await user.type(screen.getByLabelText(/^Title/), "New registrar");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(screen.getAllByTestId("field-error").length).toBeGreaterThan(0));
    expect(screen.getByLabelText(/^Role/)).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OnCallVerifyButton — the one-tap 'still correct' action", () => {
  /** Minimal harness proving the button actually clears the stale badge in the
   *  UI, not just that a callback fires. */
  function VerifyHarness({ initial }: { initial: OnCallEntry }) {
    const [entry, setEntry] = useState(initial);
    return (
      <div>
        <OnCallFreshnessBadge freshness={onCallEntryFreshness(entry, NOW)} />
        <OnCallVerifyButton entry={entry} onVerified={setEntry} />
      </div>
    );
  }

  it("calls the verify route and flips the badge from stale to fresh in one tap", async () => {
    const user = userEvent.setup();
    const verified: OnCallEntry = { ...STALE_ANAESTHETIST, lastVerifiedAt: NOW.toISOString() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: verified }));
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyHarness initial={STALE_ANAESTHETIST} />);

    expect(screen.getByTestId("on-call-freshness-badge")).toHaveAttribute("data-freshness-state", "stale");

    await user.click(screen.getByTestId(`on-call-verify-${STALE_ANAESTHETIST.slug}`));

    expect(fetchMock).toHaveBeenCalledWith(`/api/on-call/entries/${STALE_ANAESTHETIST.id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: STALE_ANAESTHETIST.updatedAt }),
    });

    await waitFor(() =>
      expect(screen.getByTestId("on-call-freshness-badge")).toHaveAttribute("data-freshness-state", "fresh"),
    );
  });

  it("shows an inline error and leaves the entry stale when the verify request fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Server error." }, 500)));

    render(<VerifyHarness initial={STALE_ANAESTHETIST} />);
    await user.click(screen.getByTestId(`on-call-verify-${STALE_ANAESTHETIST.slug}`));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByTestId("on-call-freshness-badge")).toHaveAttribute("data-freshness-state", "stale");
  });
});

describe("OnCallEntryEditor — the in-sheet quick verify for a stale entry", () => {
  it("offers the same one-tap verify action inside the editor when the entry being edited is stale", async () => {
    const user = userEvent.setup();
    const verified: OnCallEntry = { ...STALE_ANAESTHETIST, lastVerifiedAt: new Date().toISOString() };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ entry: verified })));

    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <OnCallEntryEditor open section="contacts" entry={STALE_ANAESTHETIST} onSaved={onSaved} onClose={onClose} />,
    );

    await user.click(screen.getByTestId(`on-call-verify-${STALE_ANAESTHETIST.slug}`));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(verified));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not show the quick verify action for a fresh entry", () => {
    render(<OnCallEntryEditor open section="contacts" entry={ED_REGISTRAR} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId(`on-call-verify-${ED_REGISTRAR.slug}`)).toBeNull();
  });
});

describe("OnCallEntryEditor — preserved detail fields", () => {
  it("keeps a role explainer's kind on an ordinary edit", async () => {
    const user = userEvent.setup();
    const explainer: OnCallEntry = {
      ...ED_REGISTRAR,
      details: { role: "ED registrar", kind: ROLE_EXPLAINER_KIND },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: explainer }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="contacts" entry={explainer} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /who's who entry/i })).toBeChecked();
    await user.type(screen.getByLabelText("Subtitle"), "Updated");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.details.kind).toBe(ROLE_EXPLAINER_KIND);
    expect(body.details.role).toBe("ED registrar");
  });

  it("posts the Who's who discriminator when creating from that page", async () => {
    const user = userEvent.setup();
    const created: OnCallEntry = {
      ...ED_REGISTRAR,
      id: "55555555-5555-4555-8555-555555555555",
      details: { role: "Consultant", kind: ROLE_EXPLAINER_KIND },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: created }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OnCallEntryEditor
        open
        section="contacts"
        entry={null}
        createAsRoleExplainer
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: /who's who entry/i })).toBeChecked();
    await user.type(screen.getByLabelText(/^Title/), "Consultant");
    await user.type(screen.getByLabelText(/^Role/), "Consultant");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.details).toEqual({ role: "Consultant", kind: ROLE_EXPLAINER_KIND });
  });

  it("keeps an orientation checklist the form has no input for", async () => {
    const user = userEvent.setup();
    const checklist = [{ text: "Collect the phone" }, { text: "Hand back the keycard" }];
    const orientation: OnCallEntry = {
      ...ED_REGISTRAR,
      section: "orientation",
      slug: "first-fifteen",
      title: "Your first fifteen minutes",
      details: { pinnedSummaryIsOwnerNote: true, checklist },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: orientation }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="orientation" entry={orientation} onSaved={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Subtitle"), "Updated");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.details.checklist).toEqual(checklist);
    expect(body.details.pinnedSummaryIsOwnerNote).toBe(true);
  });

  it("keeps a teaching date when the owner only edits the free-text when", async () => {
    const user = userEvent.setup();
    const session: OnCallEntry = {
      ...ED_REGISTRAR,
      section: "education",
      slug: "journal-club",
      title: "Journal club",
      details: { nextOccurrence: "Thursday 1pm", nextOccurrenceDate: "2026-09-16" },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: session }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="education" entry={session} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Next occurrence date")).toHaveValue("2026-09-16");
    await user.type(screen.getByLabelText("Subtitle"), "Updated");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.details.nextOccurrenceDate).toBe("2026-09-16");
    expect(body.details.nextOccurrence).toBe("Thursday 1pm");
  });
});

describe("OnCallEntryEditor — accessible name", () => {
  it("names itself after the entry when editing", () => {
    render(<OnCallEntryEditor open section="contacts" entry={ED_REGISTRAR} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Edit ED registrar" })).toBeInTheDocument();
  });

  it("names itself after the section when creating", () => {
    render(<OnCallEntryEditor open section="contacts" entry={null} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add to Contacts" })).toBeInTheDocument();
  });

  // Regression, 2026-09-24: both pages below write another page's stored
  // section, and the sheet used to name that section ("Add to Admin", "Add to
  // Contacts") instead of the page the reader was adding to.
  it("names the Compliance page, not Admin, when adding a requirement", () => {
    render(
      <OnCallEntryEditor
        open
        section="logistics"
        createAsCompliance
        entry={null}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Add to Compliance" })).toBeInTheDocument();
  });

  it("names Who's who, not Contacts, when adding a role", () => {
    render(
      <OnCallEntryEditor
        open
        section="contacts"
        createAsRoleExplainer
        entry={null}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Add to Who's who" })).toBeInTheDocument();
  });
});

const JOURNAL_CLUB: OnCallEntry = {
  id: "44444444-4444-4444-8444-444444444444",
  section: "education",
  slug: "journal-club",
  title: "Journal club",
  subtitle: null,
  body: null,
  details: { nextOccurrence: "Thursday 1pm", nextOccurrenceDate: "2026-09-17", topics: [] },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: false,
  includeOnCard: false,
  sortOrder: 0,
  lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
};

describe("OnCallEntryEditor — a teaching session that repeats", () => {
  // Codex P2 on PR #2806: bare "Weekly" and "Monthly" promise more than the
  // schedule can do. Monthly repeats on the anchor's calendar DATE, so a "third
  // Sunday of the month" session drifts onto a weekday, and nothing here can
  // express a term that ends. The labels now say what each option actually does,
  // and the hint names what cannot be expressed at all.
  it("says what each frequency actually does, rather than promising more than it can", () => {
    render(<OnCallEntryEditor open section="education" entry={JOURNAL_CLUB} onSaved={vi.fn()} onClose={vi.fn()} />);

    const control = screen.getByLabelText(/^Repeats/);
    const options = within(control)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual([
      "Does not repeat",
      "Weekly, on the same weekday",
      "Fortnightly, on the same weekday",
      "Monthly, on the same date",
    ]);
  });

  it("warns that a weekday-of-the-month or a term that ends cannot be expressed", () => {
    render(<OnCallEntryEditor open section="education" entry={JOURNAL_CLUB} onSaved={vi.fn()} onClose={vi.fn()} />);

    const control = screen.getByLabelText(/^Repeats/);
    const hintId = (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean)[0];
    const hint = hintId ? document.getElementById(hintId) : null;
    expect(hint).toHaveTextContent(/third Sunday/i);
    expect(hint).toHaveTextContent(/stops/i);
  });

  it("gives every frequency the model has a label, so adding one cannot be forgotten", () => {
    render(<OnCallEntryEditor open section="education" entry={JOURNAL_CLUB} onSaved={vi.fn()} onClose={vi.fn()} />);

    const control = screen.getByLabelText(/^Repeats/);
    const values = within(control)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);
    expect(values).toEqual([...ON_CALL_RECURRENCE_FREQUENCIES]);
  });

  it("saves the chosen frequency as a structured rule beside the owner's free text", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: JOURNAL_CLUB }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="education" entry={JOURNAL_CLUB} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/^Repeats/), "weekly");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.details.recurrenceRule).toEqual({ frequency: "weekly" });
    // The owner's own wording is not replaced by the rule.
    expect(body.details.nextOccurrence).toBe("Thursday 1pm");
  });

  it("clears a stored rule when the owner says it no longer repeats", async () => {
    const user = userEvent.setup();
    const repeating: OnCallEntry = {
      ...JOURNAL_CLUB,
      details: { ...(JOURNAL_CLUB.details as Record<string, unknown>), recurrenceRule: { frequency: "monthly" } },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: repeating }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="education" entry={repeating} onSaved={vi.fn()} onClose={vi.fn()} />);

    // The stored rule is what the control opens on, rather than a blank.
    expect(screen.getByLabelText(/^Repeats/)).toHaveValue("monthly");

    await user.selectOptions(screen.getByLabelText(/^Repeats/), "");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.details.recurrenceRule).toBeUndefined();
  });

  it("refuses a frequency with no date to count from, rather than saving a rule that does nothing", async () => {
    const user = userEvent.setup();
    const undated: OnCallEntry = { ...JOURNAL_CLUB, details: { nextOccurrence: "Thursday 1pm", topics: [] } };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="education" entry={undated} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/^Repeats/), "weekly");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    expect(await screen.findByText(/needs a next occurrence date/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * Admin and Compliance share the `logistics` section, so the tick box in this
 * editor is the only thing that decides which page a row lands on and which
 * fields it may keep. Both directions delete stored data, which is why every
 * test below asserts what survives as well as what goes.
 */
const PAYROLL_OFFICE: OnCallEntry = {
  id: "66666666-6666-4666-8666-666666666666",
  section: "logistics",
  slug: "payroll-office",
  title: "Payroll office",
  subtitle: null,
  body: null,
  details: {
    category: "Pay",
    location: "Level 2, Block B",
    hours: "0800-1600",
    phone: "x2201",
    url: "https://example.org/payroll",
  },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: false,
  includeOnCard: false,
  sortOrder: 0,
  lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
};

const AHPRA_REGISTRATION: OnCallEntry = {
  id: "77777777-7777-4777-8777-777777777777",
  section: "logistics",
  slug: "ahpra-registration",
  title: "Ahpra registration",
  subtitle: null,
  body: null,
  details: {
    category: "Registration",
    kind: COMPLIANCE_KIND,
    consequence: "stops-work",
    expiresOn: "2027-03-12",
    issuingBody: "Ahpra",
  },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: true,
  includeOnCard: false,
  sortOrder: 0,
  lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
};

function savedDetails(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string).details as Record<string, unknown>;
}

/** The error text actually wired to a control, rather than any error on screen:
 *  a message the owner cannot see from the field they got wrong is not a
 *  message. */
function errorTextFor(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  return ids
    .map((id) => document.getElementById(id))
    .filter((node): node is HTMLElement => node?.dataset.testid === "field-error")
    .map((node) => node.textContent ?? "")
    .join(" ");
}

const complianceTickBox = () => screen.getByRole("checkbox", { name: /compliance requirement/i });

describe("OnCallEntryEditor — the Admin/Compliance tick box", () => {
  it("swaps the admin fields for the compliance fields", async () => {
    const user = userEvent.setup();
    render(<OnCallEntryEditor open section="logistics" entry={PAYROLL_OFFICE} onSaved={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByLabelText("Location")).toHaveValue("Level 2, Block B");
    expect(screen.queryByLabelText("Recorded expiry")).toBeNull();

    await user.click(complianceTickBox());

    expect(screen.queryByLabelText("Location")).toBeNull();
    expect(screen.getByLabelText("Recorded expiry")).toBeInTheDocument();
    expect(screen.getByLabelText(/^What lapsing costs/)).toBeInTheDocument();
  });

  it("announces the change of shape for a reader who cannot see it", async () => {
    const user = userEvent.setup();
    render(<OnCallEntryEditor open section="logistics" entry={PAYROLL_OFFICE} onSaved={vi.fn()} onClose={vi.fn()} />);

    const liveRegion = screen.getByTestId("on-call-entry-editor-form-shape");
    // Silent on mount: a live region that always carries text announces itself.
    expect(liveRegion).toHaveTextContent("");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");

    await user.click(complianceTickBox());
    expect(liveRegion).toHaveTextContent(/compliance requirement fields replaced the admin fields/i);

    await user.click(complianceTickBox());
    expect(liveRegion).toHaveTextContent(/admin fields replaced the compliance requirement fields/i);
  });

  it("replaces the privacy tick box with a statement while the row is a requirement", async () => {
    const user = userEvent.setup();
    render(<OnCallEntryEditor open section="logistics" entry={PAYROLL_OFFICE} onSaved={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: /^Private — only you/ })).toBeInTheDocument();
    expect(screen.queryByTestId("on-call-entry-editor-compliance-privacy")).toBeNull();

    await user.click(complianceTickBox());

    expect(screen.queryByRole("checkbox", { name: /^Private — only you/ })).toBeNull();
    expect(screen.getByTestId("on-call-entry-editor-compliance-privacy")).toHaveTextContent(/private to you/i);
    // Nor the printable-card tick, which a requirement can never act on.
    expect(screen.queryByRole("checkbox", { name: /printable card/i })).toBeNull();

    // Unticking puts the choice back on screen still ticked, rather than
    // silently returning the row to the page anyone can open.
    await user.click(complianceTickBox());
    expect(screen.getByRole("checkbox", { name: /^Private — only you/ })).toBeChecked();
  });
});

describe("OnCallEntryEditor — naming the fields a switch deletes", () => {
  it("names the admin fields BEFORE the box is ticked, not after they are gone", () => {
    render(<OnCallEntryEditor open section="logistics" entry={PAYROLL_OFFICE} onSaved={vi.fn()} onClose={vi.fn()} />);

    const warning = screen.getByText(/are deleted/i);
    expect(warning).toHaveTextContent(/Tick it/i);
    expect(warning).toHaveTextContent(/Location/);
    expect(warning).toHaveTextContent(/Hours/);
    expect(warning).toHaveTextContent(/Phone/);
  });

  it("keeps naming them once the box is ticked, and says how to keep them", async () => {
    const user = userEvent.setup();
    render(<OnCallEntryEditor open section="logistics" entry={PAYROLL_OFFICE} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.click(complianceTickBox());

    const warning = screen.getByText(/Saving now deletes/i);
    expect(warning).toHaveTextContent(/Location/);
    expect(warning).toHaveTextContent(/Hours/);
    expect(warning).toHaveTextContent(/Phone/);
    expect(warning).toHaveTextContent(/Untick/i);
  });

  it("names the compliance fields an untick would delete, in the mirror direction", async () => {
    const user = userEvent.setup();
    render(
      <OnCallEntryEditor open section="logistics" entry={AHPRA_REGISTRATION} onSaved={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByText(/are deleted/i)).toHaveTextContent(/Untick it/i);

    await user.click(complianceTickBox());

    const warning = screen.getByText(/Saving now deletes/i);
    expect(warning).toHaveTextContent(/Recorded expiry/);
    expect(warning).toHaveTextContent(/Issued by/);
    expect(warning).toHaveTextContent(/What lapsing costs/);
  });

  // `/deleted/`, not `/are deleted/`: an empty at-risk list would render
  // "Tick it and is deleted", which the narrower pattern lets through — found
  // by mutating the guard away and watching this test stay green.
  it("says nothing when the row holds none of the other taxonomy's fields", () => {
    const bare: OnCallEntry = { ...PAYROLL_OFFICE, details: { category: "Pay" } };
    render(<OnCallEntryEditor open section="logistics" entry={bare} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/deleted/i)).toBeNull();
  });
});

describe("OnCallEntryEditor — an unrelated edit is not a licence to delete", () => {
  it("keeps compliance fields stranded on an admin row when the owner edits the subtitle", async () => {
    const user = userEvent.setup();
    const stranded: OnCallEntry = {
      ...PAYROLL_OFFICE,
      details: {
        category: "Pay",
        location: "Level 2, Block B",
        // Left behind by an earlier reclassification: no Admin page renders
        // these, and no box in this form shows them.
        consequence: "stops-work",
        expiresOn: "2027-03-12",
        issuingBody: "Ahpra",
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: stranded }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="logistics" entry={stranded} onSaved={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Subtitle"), "Ask at the window");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const details = savedDetails(fetchMock);
    expect(details.expiresOn).toBe("2027-03-12");
    expect(details.consequence).toBe("stops-work");
    expect(details.issuingBody).toBe("Ahpra");
    // The edit the owner actually made still lands.
    expect(details.location).toBe("Level 2, Block B");
  });

  it("keeps admin fields stranded on a requirement when the owner edits the subtitle", async () => {
    const user = userEvent.setup();
    const stranded: OnCallEntry = {
      ...AHPRA_REGISTRATION,
      details: { ...(AHPRA_REGISTRATION.details as Record<string, unknown>), location: "Level 2, Block B" },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: stranded }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="logistics" entry={stranded} onSaved={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Subtitle"), "Renewal opens in January");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const details = savedDetails(fetchMock);
    expect(details.location).toBe("Level 2, Block B");
    expect(details.expiresOn).toBe("2027-03-12");
    expect(details.kind).toBe(COMPLIANCE_KIND);
  });

  it("still clears the departing taxonomy when the owner actually switches", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: AHPRA_REGISTRATION }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OnCallEntryEditor open section="logistics" entry={AHPRA_REGISTRATION} onSaved={vi.fn()} onClose={vi.fn()} />,
    );

    await user.click(complianceTickBox());
    await user.selectOptions(screen.getByLabelText(/^Category/), "Forms");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const details = savedDetails(fetchMock);
    expect(details).toEqual({ category: "Forms" });
  });

  it("clears the admin fields when a note becomes a requirement, keeping category and url", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: PAYROLL_OFFICE }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="logistics" entry={PAYROLL_OFFICE} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.click(complianceTickBox());
    await user.selectOptions(screen.getByLabelText(/^Category/), "Registration");
    // Typed on the way through, on the side of the split the sweep is also
    // walking: it must never delete what the owner just entered.
    await user.type(screen.getByLabelText("Recorded expiry"), "2027-03-12");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const details = savedDetails(fetchMock);
    expect(details).toEqual({
      category: "Registration",
      kind: COMPLIANCE_KIND,
      expiresOn: "2027-03-12",
      url: "https://example.org/payroll",
    });
  });
});

describe("OnCallEntryEditor — a required category is required", () => {
  it("refuses to save a blanked category rather than filing the row under the other taxonomy's folder", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OnCallEntryEditor open section="logistics" entry={AHPRA_REGISTRATION} onSaved={vi.fn()} onClose={vi.fn()} />,
    );

    await user.click(complianceTickBox());
    // "Registration" is not an Admin folder, so the select is emptied and the
    // owner has to choose again.
    expect(screen.getByLabelText(/^Category/)).toHaveValue("");

    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    expect(fetchMock).not.toHaveBeenCalled();
    const category = screen.getByLabelText(/^Category/);
    expect(category).toHaveAttribute("aria-invalid", "true");
    expect(errorTextFor(category)).toMatch(/required/i);
  });

  it("refuses the mirror direction too", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="logistics" entry={PAYROLL_OFFICE} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.click(complianceTickBox());
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorTextFor(screen.getByLabelText(/^Category/))).toMatch(/required/i);
  });

  it("refuses a required text field emptied on an edit, instead of silently keeping the stored one", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="contacts" entry={ED_REGISTRAR} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText(/^Role/));
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorTextFor(screen.getByLabelText(/^Role/))).toMatch(/required/i);
  });
});

describe("OnCallEntryEditor — creating a requirement from the Compliance page", () => {
  it("posts the compliance discriminator and forces the row private", async () => {
    const user = userEvent.setup();
    const created: OnCallEntry = { ...AHPRA_REGISTRATION, id: "88888888-8888-4888-8888-888888888888" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: created }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OnCallEntryEditor
        open
        section="logistics"
        entry={null}
        createAsCompliance
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(complianceTickBox()).toBeChecked();
    await user.type(screen.getByLabelText(/^Title/), "Ahpra registration");
    await user.selectOptions(screen.getByLabelText(/^Category/), "Registration");
    await user.type(screen.getByLabelText("Recorded expiry"), "2027-03-12");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.details).toEqual({ category: "Registration", kind: COMPLIANCE_KIND, expiresOn: "2027-03-12" });
    expect(body.isPersonal).toBe(true);
    expect(body.includeOnCard).toBe(false);
  });
});

/**
 * Codex P2 on PR #2900: an obsolete value on a regulatory record could not be
 * removed. The owner cleared the box, the save reported success, and the merge
 * overlay handed the stored value straight back.
 *
 * A recorded expiry is the sharp case — a date nobody can delete outlives the
 * registration it describes, and this page may not assert anything about the
 * holder's standing, so a stale date it refuses to drop is the one claim it
 * accidentally does make.
 */
describe("OnCallEntryEditor — clearing an optional compliance field removes it", () => {
  it("deletes a recorded expiry the owner has emptied", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: AHPRA_REGISTRATION }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OnCallEntryEditor open section="logistics" entry={AHPRA_REGISTRATION} onSaved={vi.fn()} onClose={vi.fn()} />,
    );

    await user.clear(screen.getByLabelText("Recorded expiry"));
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(savedDetails(fetchMock)).not.toHaveProperty("expiresOn");
    // The rest of the record is untouched: this clears one box, not the row.
    expect(savedDetails(fetchMock).issuingBody).toBe("Ahpra");
    expect(savedDetails(fetchMock).consequence).toBe("stops-work");
  });

  it("deletes an emptied issuing body", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: AHPRA_REGISTRATION }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OnCallEntryEditor open section="logistics" entry={AHPRA_REGISTRATION} onSaved={vi.fn()} onClose={vi.fn()} />,
    );

    await user.clear(screen.getByLabelText("Issued by"));
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(savedDetails(fetchMock)).not.toHaveProperty("issuingBody");
    expect(savedDetails(fetchMock).expiresOn).toBe("2027-03-12");
  });

  it("deletes an emptied lead time, which is a number and takes a different branch", async () => {
    const user = userEvent.setup();
    const entry: OnCallEntry = {
      ...AHPRA_REGISTRATION,
      details: { ...(AHPRA_REGISTRATION.details as Record<string, unknown>), leadTimeDays: 90 },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="logistics" entry={entry} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText("Days of notice you need"));
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(savedDetails(fetchMock)).not.toHaveProperty("leadTimeDays");
  });

  it("deletes an emptied evidence link, so a moved certificate is not left pointing nowhere", async () => {
    const user = userEvent.setup();
    const entry: OnCallEntry = {
      ...AHPRA_REGISTRATION,
      details: {
        ...(AHPRA_REGISTRATION.details as Record<string, unknown>),
        evidenceUrl: "https://example.org/old-certificate.pdf",
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="logistics" entry={entry} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText("Evidence link"));
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(savedDetails(fetchMock)).not.toHaveProperty("evidenceUrl");
  });

  /**
   * The guard on the fix, and the reason it is safe.
   *
   * An earlier P1 on this branch was the opposite failure: editing only a title
   * wiped every other stored field. The protection for that is the salvage and
   * overlay in `mergeOnCallEditorDetails`, which is about keys the form has NO
   * control for. Clearing is about keys it does. Those two sets are disjoint —
   * `handleSave` iterates the rendered specs — and this pins it, because the
   * obvious wrong fix is to make the merge itself drop absent keys.
   */
  it("still carries through a stored key the compliance form does not render", async () => {
    const user = userEvent.setup();
    const entry: OnCallEntry = {
      ...AHPRA_REGISTRATION,
      // `location` is an Admin field. The compliance form has no box for it, so
      // it is exactly the shape the salvage and overlay exist to protect.
      details: { ...(AHPRA_REGISTRATION.details as Record<string, unknown>), location: "Level 2, Block B" },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="logistics" entry={entry} onSaved={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Location")).toBeNull();

    // Clear one rendered box and save. Everything else must survive.
    await user.clear(screen.getByLabelText("Recorded expiry"));
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(savedDetails(fetchMock)).not.toHaveProperty("expiresOn");
    expect(savedDetails(fetchMock).location).toBe("Level 2, Block B");
    expect(savedDetails(fetchMock).category).toBe("Registration");
    expect(savedDetails(fetchMock).kind).toBe(COMPLIANCE_KIND);
  });
});

describe("OnCallEntryEditor — clearing optional compliance values", () => {
  // These fields are always on screen for a requirement. Blanking one and
  // saving used to restore the stored value via mergeOnCallEditorDetails,
  // so an obsolete expiry / issuer / evidence link could not be removed.
  // Codex P2 on PR #2900.
  it("removes expiry, lead time, issuer, evidence link and URL when the owner blanks them", async () => {
    const user = userEvent.setup();
    const rich: OnCallEntry = {
      ...AHPRA_REGISTRATION,
      details: {
        ...(AHPRA_REGISTRATION.details as Record<string, unknown>),
        leadTimeDays: 90,
        evidenceUrl: "https://example.org/certificate",
        url: "https://example.org/renew",
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: rich }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="logistics" entry={rich} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText("Recorded expiry"));
    await user.clear(screen.getByLabelText("Days of notice you need"));
    await user.clear(screen.getByLabelText("Issued by"));
    await user.clear(screen.getByLabelText("Evidence link"));
    await user.clear(screen.getByLabelText(/^URL$/));
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const details = savedDetails(fetchMock);
    expect(details).toEqual({
      category: "Registration",
      kind: COMPLIANCE_KIND,
      consequence: "stops-work",
    });
  });
});

describe("OnCallEntryEditor — clearing a previously stored value", () => {
  // Before saving, a taxonomy switch can still warn about the old stored value.
  // Saving the emptied control must then remove it rather than restore it.
  it("warns about stored data before save, then persists an emptied field", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: PAYROLL_OFFICE }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="logistics" entry={PAYROLL_OFFICE} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText("Location"));
    expect(screen.getByText(/are deleted/i)).toHaveTextContent(/Location/);

    // Saving without switching persists the intentional clearing.
    await user.click(screen.getByTestId("on-call-entry-editor-save"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(savedDetails(fetchMock).location).toBeUndefined();
  });
});

describe("On call optional field clearing", () => {
  it.each([
    {
      section: "contacts" as const,
      label: /^Direct phone/,
      details: { role: "Registrar", phone: "0400 111 222" },
      key: "phone",
      expected: undefined,
    },
    {
      section: "referrals" as const,
      label: /^Accepts/,
      details: { accepts: ["Adults"], exclusions: [] },
      key: "accepts",
      expected: [],
    },
    {
      section: "playbook" as const,
      label: /^Escalation steps/,
      details: {
        trigger: "Recorded trigger",
        escalationSteps: [{ order: 1, whoToCall: "Registrar", when: "Recorded condition" }],
      },
      key: "escalationSteps",
      expected: [],
    },
  ])("persists clearing $key while retaining unrelated details", async ({ section, label, details, key, expected }) => {
    const user = userEvent.setup();
    const entry = { ...ED_REGISTRAR, section, details };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OnCallEntryEditor open section={section} entry={entry} onSaved={vi.fn()} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText(label));
    await user.click(screen.getByTestId("on-call-entry-editor-save"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.details[key]).toEqual(expected);
    expect(body.linkedDocumentIds).toEqual(entry.linkedDocumentIds);
    expect(body.lastVerifiedAt).toBe(entry.lastVerifiedAt);
  });
});

describe("OnCallEntryEditor — Call first on the home", () => {
  it("puts a contact on the home without the owner typing a tag, and keeps its grouping tag first", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entry: ED_REGISTRAR }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnCallEntryEditor open section="contacts" entry={ED_REGISTRAR} onSaved={vi.fn()} onClose={vi.fn()} />);

    const box = screen.getByTestId("on-call-entry-editor-call-first");
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(screen.getByLabelText("Tags")).toHaveValue("Emergency Department, call-first");
    await user.click(screen.getByTestId("on-call-entry-editor-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.tags).toEqual(["Emergency Department", "call-first"]);
  });

  it("shows an existing call-first tag as ticked, and unticking removes only that tag", async () => {
    const user = userEvent.setup();
    const pinned: OnCallEntry = { ...ED_REGISTRAR, tags: ["Emergency Department", "Call-First", "ward"] };
    render(<OnCallEntryEditor open section="contacts" entry={pinned} onSaved={vi.fn()} onClose={vi.fn()} />);

    const box = screen.getByTestId("on-call-entry-editor-call-first");
    expect(box).toBeChecked();
    await user.click(box);
    expect(screen.getByLabelText("Tags")).toHaveValue("Emergency Department, ward");
  });

  it("is not offered for a Who's who role, which is not a number to ring", () => {
    render(
      <OnCallEntryEditor
        open
        section="contacts"
        entry={{ ...ED_REGISTRAR, details: { role: "ED registrar", phone: "0412 345 678", kind: ROLE_EXPLAINER_KIND } }}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("on-call-entry-editor-call-first")).not.toBeInTheDocument();
  });
});

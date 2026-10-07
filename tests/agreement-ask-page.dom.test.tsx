/** @vitest-environment jsdom */

// Ask the agreement page: first use, suggestions as you type, the quoted answer with clause
// chips and the union, the honest not-checked answer, the patient-detail catch, the clause
// sheet, copy and its failure, deep links by fixed id, offline, and the sign-off states.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuleGate } from "@/lib/admin/rule-sign-off";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/my-day/profile/agreement",
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), back: vi.fn() }),
}));

const env = vi.hoisted(() => ({ online: true, gate: { on: false, reason: "unsigned" } as RuleGate }));
vi.mock("@/lib/use-online-status", () => ({ useOnlineStatus: () => env.online }));
vi.mock("@/lib/work-profile/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-profile/model")>();
  return { ...actual, restRulesGate: () => env.gate };
});

const clipboard = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: clipboard.copy }));

const announcer = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("@/components/ui/live-announcer", () => ({ announce: announcer.announce }));

import { AgreementAskPage } from "@/components/agreement-ask/agreement-ask-page";
import { ToastProvider } from "@/components/ui/toast";
import { AgreementEntryLink } from "@/components/agreement-ask/agreement-entry-link";

function field(): HTMLInputElement {
  return screen.getByTestId("agreement-question") as HTMLInputElement;
}

function type(value: string) {
  fireEvent.change(field(), { target: { value } });
}

function askTyped(value: string) {
  type(value);
  fireEvent.click(screen.getByTestId("agreement-ask"));
}

beforeEach(() => {
  nav.search = "";
  env.online = true;
  env.gate = { on: false, reason: "unsigned" };
  clipboard.copy.mockResolvedValue(undefined);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("Ask the agreement page", () => {
  it("first use: intro, four suggested questions, every checked clause and the agreement source", () => {
    render(<AgreementAskPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Ask the agreement" })).toBeTruthy();
    expect(screen.getByTestId("agreement-intro").textContent).toContain("Clause 15 only, for now");
    expect(within(screen.getByTestId("agreement-try")).getAllByRole("button")).toHaveLength(4);
    expect(within(screen.getByTestId("agreement-clause-list")).getAllByRole("button")).toHaveLength(8);
    const source = screen.getByTestId("agreement-source");
    expect(source.textContent).toContain("2024 WAIRC 00992");
    expect(source.textContent).toContain("Not signed off yet");
    expect(within(source).getByRole("link").getAttribute("href")).toBe(FATIGUE_RULE_SET.source.url);
    expect(screen.queryByTestId("agreement-answer")).toBeNull();
  });

  it("asking with nothing typed nudges instead of answering", () => {
    render(<AgreementAskPage />);
    fireEvent.click(screen.getByTestId("agreement-ask"));
    expect(screen.queryByTestId("agreement-answer")).toBeNull();
    expect(announcer.announce).toHaveBeenCalledWith("Type a question first", { priority: "polite" });
    expect(screen.getByText("Type a question first")).toBeTruthy();
  });

  it("as you type: an Ask row, highlighted suggestions and matching clauses", () => {
    render(<AgreementAskPage />);
    type("nights in a row");
    const suggestions = screen.getByTestId("agreement-suggestions");
    expect(within(suggestions).getByTestId("agreement-ask-typed").textContent).toContain("nights in a row");
    expect(suggestions.querySelectorAll("mark").length).toBeGreaterThan(0);
    expect(within(suggestions).getByText("Clauses")).toBeTruthy();
    expect(screen.queryByTestId("agreement-try")).toBeNull();
  });

  it("answers with verbatim quotes, a clause chip on every line, the PDF and AMA (WA) last", async () => {
    render(<AgreementAskPage />);
    askTyped("How many nights in a row can I work?");
    const answer = screen.getByTestId("agreement-answer");
    const quotes = [...answer.querySelectorAll("q")].map((node) => node.textContent);
    expect(quotes).toEqual([
      FATIGUE_RULE_SET.rules.maxNightsInRow.quote,
      FATIGUE_RULE_SET.rules.maxNightsInRow.exception.quote,
    ]);
    expect(within(answer).getAllByTestId("agreement-clause-chip")).toHaveLength(2);
    expect(within(answer).getByTestId("agreement-not-signed-off").textContent).toContain("Not signed off yet");
    expect(within(answer).getByTestId("agreement-open-pdf").getAttribute("href")).toBe(FATIGUE_RULE_SET.source.url);
    const union = within(answer).getByTestId("agreement-union");
    expect(union.textContent).toContain("AMA (WA)");
    expect(union.textContent).not.toMatch(/\d{4}/);
    expect(answer.lastElementChild).toBe(union);
    expect(screen.getByTestId("agreement-asked").textContent).toContain("How many nights in a row can I work?");
    await act(async () => {});
    expect(document.activeElement?.id).toBe("agreement-answer-heading");
    expect(announcer.announce).toHaveBeenCalledWith("Quoted from clause 15(6)(f). Not signed off yet", {
      priority: "polite",
    });
  });

  it("names the signer while the sign-off gate is on", () => {
    env.gate = { on: true };
    render(<AgreementAskPage />);
    askTyped("break between shifts");
    expect(screen.queryByTestId("agreement-not-signed-off")).toBeNull();
    expect(screen.getByTestId("agreement-signed-off").textContent).toMatch(/^Signed off/);
  });

  it("an unchecked topic gets the honest answer, the agreement link and the union, with no figures", () => {
    render(<AgreementAskPage />);
    askTyped("Am I owed overtime for staying 40 minutes late?");
    const answer = screen.getByTestId("agreement-answer");
    expect(within(answer).getByRole("heading", { name: "Not in the clauses PsychSift has checked" })).toBeTruthy();
    expect(within(answer).getByTestId("agreement-unchecked-line").textContent).toContain(
      "PsychSift hasn’t checked the clauses on overtime.",
    );
    expect(within(answer).getByTestId("agreement-open-pdf").getAttribute("href")).toBe(FATIGUE_RULE_SET.source.url);
    expect(answer.querySelectorAll("q")).toHaveLength(0);
    expect(within(answer).getByTestId("agreement-union").textContent).toContain("AMA (WA)");
    // A topic chip turns the dead end into a quoted answer.
    fireEvent.click(within(answer).getByRole("button", { name: "Nights in a row" }));
    expect(screen.getByTestId("agreement-answer").querySelectorAll("q").length).toBe(2);
  });

  it("catches patient details as you type, never answers them, and clears in place", () => {
    render(<AgreementAskPage />);
    type("stayed late with UR 4471823 after nights");
    expect(screen.getByTestId("agreement-patient").textContent).toContain("a record number");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByTestId("agreement-suggestions")).toBeNull();
    // The Ask key is off while the detail is there, and the caught part is marked.
    expect(screen.getByTestId("agreement-ask").hasAttribute("disabled")).toBe(true);
    const marked = screen.getByTestId("agreement-patient-marked");
    expect([...marked.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual(["UR 4471823"]);
    expect(marked.textContent).toContain("stayed late with");
    // A submit by the keyboard is refused too.
    fireEvent.submit(screen.getByRole("search", { name: "Ask the agreement" }));
    expect(screen.queryByTestId("agreement-answer")).toBeNull();
    expect(announcer.announce).toHaveBeenCalledWith("Not asked. It looks like patient details.", {
      priority: "assertive",
    });
    fireEvent.click(screen.getByTestId("agreement-clear-patient"));
    expect(field().value).toBe("");
    expect(screen.queryByTestId("agreement-patient")).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it("searches the clause words as you type and opens a clause with the matching lines marked", () => {
    render(<AgreementAskPage />);
    type("break");
    const matches = screen.getByTestId("agreement-word-matches");
    expect(matches.textContent).toContain("In the agreement’s words");
    const rows = within(matches).getAllByRole("button");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.querySelector("mark")?.textContent?.toLowerCase()).toContain("break");
    fireEvent.click(rows[0]!);
    const sheet = screen.getByTestId("agreement-clause-sheet");
    expect(sheet.querySelectorAll("[data-used]").length).toBeGreaterThan(0);
    // Nothing typed is put in the address bar.
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("says who could help when the agreement part is not checked", () => {
    render(<AgreementAskPage />);
    askTyped("Is parking free on nights?");
    const help = screen.getByTestId("agreement-who-helps");
    expect(within(help).getByRole("link").getAttribute("href")).toBe("/admin/help#admin-help-contacts");
    expect(help.textContent).toContain("Medical Workforce");
    expect(screen.getByTestId("agreement-union").textContent).toContain("AMA (WA)");
    // No phone number anywhere in the answer.
    expect(screen.getByTestId("agreement-answer").textContent).not.toMatch(/\d{4}\s?\d{3}\s?\d{3}|\(0\d\)/);
  });

  it("confirms a copy with a toast when the app has one", async () => {
    render(
      <ToastProvider>
        <AgreementAskPage />
      </ToastProvider>,
    );
    askTyped("How many nights in a row?");
    await act(async () => {
      fireEvent.click(screen.getByTestId("agreement-copy"));
    });
    expect(screen.getByText("Answer copied with its clause numbers")).toBeTruthy();
    expect(announcer.announce).not.toHaveBeenCalledWith("Answer copied with its clause numbers", expect.anything());
  });

  it("asks the safer wording without the patient details", () => {
    render(<AgreementAskPage />);
    type("stayed late with UR 4471823 after nights");
    fireEvent.click(screen.getByTestId("agreement-ask-safer"));
    expect(field().value).not.toContain("4471823");
    expect(screen.getByTestId("agreement-answer").textContent).toContain("15(6)(g)");
    expect(screen.getByTestId("agreement-asked").textContent).not.toContain("4471823");
  });

  it("Escape clears the question", () => {
    render(<AgreementAskPage />);
    type("nights");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("");
  });

  it("a clause chip opens the clause sheet with the used lines marked, and copies the clause", async () => {
    render(<AgreementAskPage />);
    askTyped("What is the most hours in a week?");
    fireEvent.click(within(screen.getByTestId("agreement-answer")).getAllByTestId("agreement-clause-chip")[0]!);
    const sheet = screen.getByTestId("agreement-clause-sheet");
    expect(within(sheet).getByText("Clause 15(6)(b)")).toBeTruthy();
    expect(sheet.querySelectorAll("[data-used]")).toHaveLength(2);
    expect(sheet.textContent).toContain("2 Sep 2027");
    await act(async () => {
      fireEvent.click(within(sheet).getByTestId("agreement-copy-clause"));
    });
    expect(clipboard.copy.mock.calls[0]![0]).toContain(`"${FATIGUE_RULE_SET.rules.maxHours7d.quote}"`);
    expect(announcer.announce).toHaveBeenCalledWith("Clause 15(6)(b) copied", { priority: "polite" });
  });

  it("copies the answer with clause numbers, and says so when copying fails", async () => {
    render(<AgreementAskPage />);
    askTyped("break between shifts");
    await act(async () => {
      fireEvent.click(screen.getByTestId("agreement-copy"));
    });
    const text = clipboard.copy.mock.calls[0]![0] as string;
    expect(text).toContain("(clause 15(4)(a))");
    expect(text).toContain("AMA (WA), your union.");
    expect(screen.getByTestId("agreement-copy").textContent).toContain("Copied");
    clipboard.copy.mockRejectedValueOnce(new Error("denied"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("agreement-copy"));
    });
    expect(screen.getByText("Couldn’t copy. Select the text and copy it instead.")).toBeTruthy();
  });

  it("deep links open a topic or a clause by fixed id, and ignore typed text in the address", async () => {
    nav.search = "topic=rest-after-nights";
    const { unmount } = render(<AgreementAskPage />);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("agreement-topic-rest-after-nights")).toBeTruthy();
    unmount();

    nav.search = "clause=15(4)(a)";
    const second = render(<AgreementAskPage />);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(within(screen.getByTestId("agreement-clause-sheet")).getByText("Clause 15(4)(a)")).toBeTruthy();
    second.unmount();

    nav.search = "q=UR%204471823&topic=nonsense";
    render(<AgreementAskPage />);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("agreement-answer")).toBeNull();
    expect(field().value).toBe("");
  });

  it("asking a new question clears a deep link from the address", () => {
    nav.search = "topic=shift-length";
    render(<AgreementAskPage />);
    askTyped("nights in a row");
    expect(nav.replace).toHaveBeenCalledWith("/my-day/profile/agreement", { scroll: false });
  });

  it("offline: the quotes still work and the page says the PDF needs a connection", () => {
    env.online = false;
    render(<AgreementAskPage />);
    expect(screen.getByTestId("agreement-offline").textContent).toContain("needs a connection");
    askTyped("break between shifts");
    expect(screen.getByTestId("agreement-answer").querySelectorAll("q")).toHaveLength(1);
  });

  it("'/' focuses the question from elsewhere on the page", () => {
    render(<AgreementAskPage />);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(field());
  });

  it("the entry link points at the page", () => {
    render(<AgreementEntryLink />);
    expect(screen.getByTestId("agreement-entry-link").getAttribute("href")).toBe("/my-day/profile/agreement");
  });
});

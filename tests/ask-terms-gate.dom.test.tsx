/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskTermsStep } from "@/components/front-door/ask-terms-step";
import { useAskTermsGate } from "@/components/front-door/use-ask-terms-gate";
import {
  ASK_TERMS_STEP_ACCEPT_LABEL,
  ASK_TERMS_STEP_NOTE_ACCOUNT,
  ASK_TERMS_STEP_NOTE_DEVICE,
  ASK_TERMS_STEP_TITLE,
  TERMS_PROMPT_LATER_LABEL,
  TERMS_PROMPT_POINTS,
  TERMS_PROMPT_SAVE_ERROR,
  TERMS_VERSION,
} from "@/lib/front-door-content";
import { DEVICE_TERMS_KEY, TERMS_METADATA_KEY } from "@/lib/terms-acceptance";

// Synthetic question with no patient details.
const QUESTION = "What baseline tests does the example lithium guideline recommend?";

const updateUser = vi.fn(async () => ({ data: {}, error: null as unknown }));
let auth: {
  status: string;
  session: { user: { id: string; user_metadata: Record<string, unknown> } } | null;
  client: { auth: { updateUser: typeof updateUser } } | null;
};

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

function signedOut() {
  auth = { status: "signed_out", session: null, client: null };
}

function signedIn(metadata: Record<string, unknown> = {}) {
  auth = {
    status: "authenticated",
    session: { user: { id: "user-1", user_metadata: metadata } },
    client: { auth: { updateUser } },
  };
}

/** Stands in for the dashboard: an Answer Ask goes through the gate, Not now runs Documents. */
function Harness({
  sendAnswer,
  searchDocuments,
  onSaveFailed,
}: {
  sendAnswer: (query: string) => void;
  searchDocuments: (query: string) => void;
  onSaveFailed?: (message: string) => void;
}) {
  const gate = useAskTermsGate({ onNotNow: searchDocuments, onSaveFailed });
  return (
    <>
      <button type="button" onClick={() => gate.guard(QUESTION, () => sendAnswer(QUESTION))}>
        Ask
      </button>
      {gate.declinedQuery ? <p data-testid="declined">{gate.declinedQuery}</p> : null}
      <AskTermsStep
        open={gate.heldQuery !== null}
        saving={gate.saving}
        signedIn={gate.signedIn}
        onAccept={() => void gate.accept()}
        onNotNow={gate.notNow}
      />
    </>
  );
}

function setup() {
  const sendAnswer = vi.fn();
  const searchDocuments = vi.fn();
  const onSaveFailed = vi.fn();
  const view = render(
    <Harness sendAnswer={sendAnswer} searchDocuments={searchDocuments} onSaveFailed={onSaveFailed} />,
  );
  const ask = () => fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  return { sendAnswer, searchDocuments, onSaveFailed, ask, view };
}

/** The footer's Not now. The close cross carries the same name and does the same thing. */
function notNowButton() {
  const buttons = screen.getAllByRole("button", { name: TERMS_PROMPT_LATER_LABEL });
  const footer = buttons.find((button) => button.textContent?.trim() === TERMS_PROMPT_LATER_LABEL);
  if (!footer) throw new Error("No footer Not now button");
  return footer;
}

function step() {
  return screen.queryByRole("dialog", { name: ASK_TERMS_STEP_TITLE });
}

describe("Terms step at the first Ask", () => {
  beforeEach(() => {
    window.localStorage.clear();
    updateUser.mockClear();
    signedOut();
  });
  afterEach(() => cleanup());

  it("shows the step on the first Ask and does not send the question", () => {
    const { ask, sendAnswer, searchDocuments } = setup();
    ask();
    expect(step()).toBeTruthy();
    for (const point of TERMS_PROMPT_POINTS) expect(screen.getByText(point)).toBeTruthy();
    expect(screen.getByText(ASK_TERMS_STEP_NOTE_DEVICE)).toBeTruthy();
    const termsLink = screen.getByRole("link", { name: /Read the full Terms of Use/ });
    expect(termsLink.getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("button", { name: ASK_TERMS_STEP_ACCEPT_LABEL })).toBeTruthy();
    // The footer button and the close cross both say Not now, and both mean it.
    expect(screen.getAllByRole("button", { name: TERMS_PROMPT_LATER_LABEL })).toHaveLength(2);
    expect(sendAnswer).not.toHaveBeenCalled();
    expect(searchDocuments).not.toHaveBeenCalled();
  });

  it("records the acceptance on this device, then sends the held question unchanged", async () => {
    const { ask, sendAnswer } = setup();
    ask();
    fireEvent.click(screen.getByRole("button", { name: ASK_TERMS_STEP_ACCEPT_LABEL }));
    await waitFor(() => expect(sendAnswer).toHaveBeenCalledTimes(1));
    expect(sendAnswer).toHaveBeenCalledWith(QUESTION);
    expect(window.localStorage.getItem(DEVICE_TERMS_KEY)).toBe(TERMS_VERSION);
    expect(updateUser).not.toHaveBeenCalled();
    await waitFor(() => expect(step()).toBeNull());
  });

  it("on Not now runs the documents search for the same question and sends nothing to Answer", () => {
    const { ask, sendAnswer, searchDocuments } = setup();
    ask();
    fireEvent.click(notNowButton());
    expect(searchDocuments).toHaveBeenCalledTimes(1);
    expect(searchDocuments).toHaveBeenCalledWith(QUESTION);
    expect(sendAnswer).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DEVICE_TERMS_KEY)).toBeNull();
    expect(screen.getByTestId("declined").textContent).toBe(QUESTION);
  });

  it("asks again on the next Ask after Not now", async () => {
    const { ask, sendAnswer } = setup();
    ask();
    fireEvent.click(notNowButton());
    await waitFor(() => expect(step()).toBeNull());
    ask();
    expect(step()).toBeTruthy();
    expect(sendAnswer).not.toHaveBeenCalled();
  });

  it("skips the step when this device already accepted the current version", () => {
    window.localStorage.setItem(DEVICE_TERMS_KEY, TERMS_VERSION);
    const { ask, sendAnswer } = setup();
    ask();
    expect(step()).toBeNull();
    expect(sendAnswer).toHaveBeenCalledWith(QUESTION);
  });

  it("asks again when the Terms version has changed since the device accepted", () => {
    window.localStorage.setItem(DEVICE_TERMS_KEY, "2020-01-01-old");
    const { ask, sendAnswer } = setup();
    ask();
    expect(step()).toBeTruthy();
    expect(sendAnswer).not.toHaveBeenCalled();
  });

  it("does not ask again in the same page when storage is blocked after an accept", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const { ask, sendAnswer } = setup();
      ask();
      fireEvent.click(screen.getByRole("button", { name: ASK_TERMS_STEP_ACCEPT_LABEL }));
      await waitFor(() => expect(sendAnswer).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(step()).toBeNull());
      ask();
      expect(step()).toBeNull();
      expect(sendAnswer).toHaveBeenCalledTimes(2);
    } finally {
      setItem.mockRestore();
    }
  });

  it("shows the step to a signed-in user who has not accepted the current version", () => {
    signedIn();
    const { ask, sendAnswer } = setup();
    ask();
    expect(step()).toBeTruthy();
    expect(screen.getByText(ASK_TERMS_STEP_NOTE_ACCOUNT)).toBeTruthy();
    expect(sendAnswer).not.toHaveBeenCalled();
  });

  it("does not count a signed-out device acceptance for a signed-in user", () => {
    window.localStorage.setItem(DEVICE_TERMS_KEY, TERMS_VERSION);
    signedIn();
    const { ask, sendAnswer } = setup();
    ask();
    expect(step()).toBeTruthy();
    expect(sendAnswer).not.toHaveBeenCalled();
  });

  it("records a signed-in acceptance on the account, then sends", async () => {
    signedIn();
    const { ask, sendAnswer, onSaveFailed } = setup();
    ask();
    fireEvent.click(screen.getByRole("button", { name: ASK_TERMS_STEP_ACCEPT_LABEL }));
    await waitFor(() => expect(sendAnswer).toHaveBeenCalledWith(QUESTION));
    expect(updateUser).toHaveBeenCalledWith({
      data: { [TERMS_METADATA_KEY]: expect.objectContaining({ version: TERMS_VERSION }) },
    });
    expect(window.localStorage.getItem("psychsift:terms-accepted:user-1")).toBe(TERMS_VERSION);
    expect(window.localStorage.getItem(DEVICE_TERMS_KEY)).toBeNull();
    expect(onSaveFailed).not.toHaveBeenCalled();
  });

  it("still sends after a failed account save, keeps it on this device and says so", async () => {
    signedIn();
    updateUser.mockRejectedValueOnce(new Error("synthetic network failure"));
    const { ask, sendAnswer, onSaveFailed } = setup();
    ask();
    fireEvent.click(screen.getByRole("button", { name: ASK_TERMS_STEP_ACCEPT_LABEL }));
    await waitFor(() => expect(sendAnswer).toHaveBeenCalledWith(QUESTION));
    expect(onSaveFailed).toHaveBeenCalledWith(TERMS_PROMPT_SAVE_ERROR);
    expect(window.localStorage.getItem("psychsift:terms-accepted:user-1")).toBe(TERMS_VERSION);
  });

  it("skips the step for a signed-in user whose account holds the current version", () => {
    signedIn({ [TERMS_METADATA_KEY]: { version: TERMS_VERSION, acceptedAt: "2026-10-18T00:00:00Z" } });
    const { ask, sendAnswer } = setup();
    ask();
    expect(step()).toBeNull();
    expect(sendAnswer).toHaveBeenCalledWith(QUESTION);
  });

  it("asks a signed-in user again when the account holds an older version", () => {
    signedIn({ [TERMS_METADATA_KEY]: { version: "2020-01-01-old", acceptedAt: "2020-01-01T00:00:00Z" } });
    const { ask, sendAnswer } = setup();
    ask();
    expect(step()).toBeTruthy();
    expect(sendAnswer).not.toHaveBeenCalled();
  });
});

describe("Terms step wiring", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("gates the dashboard's Answer submit before any request starts", () => {
    const dashboard = read("src/components/ClinicalDashboard.tsx");
    // The execution hook's own ask is only reachable through the gated wrapper.
    expect(dashboard).toContain("ask: sendAsk,");
    expect(dashboard).toMatch(/const ask: typeof sendAsk = async[\s\S]*?askTermsGate\.guard\(searchText/);
    expect(dashboard).toContain("onAsk={ask}");
    // Not now runs the same question as a Documents search.
    expect(dashboard).toContain('crossModeSearch("documents", heldQuery)');
    // An Answer cross-search, a follow-up pick and a re-check all wait for the step too.
    expect(dashboard).toMatch(/if \(mode === "answer" && crossQuery\.trim\(\)\) \{\s*askTermsGate\.guard/);
    expect(dashboard).toContain("askTermsGate.guard(suggestion,");
    expect(dashboard).toMatch(/askTermsGate\.guard\(\s*queryToRerun,/);
  });

  it("starts browser journeys from the same device key the gate reads", () => {
    const config = read("playwright.config.ts");
    expect(config).toContain(`name: "${DEVICE_TERMS_KEY}", value: TERMS_VERSION`);
    expect(config).toContain("storageState: returningVisitor");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { clearAccountScopedBrowserStorage } from "../src/lib/account-scoped-browser-state";
import {
  answerHandoffParam,
  privateAnswerHref,
  readStashedAnswerQuestion,
  resolveAnswerHandoffParams,
  stashAnswerQuestion,
} from "../src/lib/answer-question-handoff";

// Synthetic, non-patient question text only.
const question = "lithium monitoring after dose change";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("answer question handoff (FE-01)", () => {
  afterEach(() => window.sessionStorage.clear());

  it("writes an id, never the question, into a submitted Answer href", () => {
    const href = privateAnswerHref(`/?mode=answer&q=${encodeURIComponent(question)}&run=1&queryMode=auto`);
    const url = new URL(href, window.location.origin);
    expect(href).not.toContain("lithium");
    expect(url.searchParams.has("q")).toBe(false);
    expect(url.searchParams.get("run")).toBe("1");
    expect(url.searchParams.get("mode")).toBe("answer");
    expect(url.searchParams.get("queryMode")).toBe("auto");
    expect(readStashedAnswerQuestion(url.searchParams.get(answerHandoffParam))).toBe(question);
  });

  it("covers the older `query` alias and a bare default-mode link", () => {
    for (const href of [
      `/?mode=answer&query=${encodeURIComponent(question)}&run=1`,
      `/?q=${encodeURIComponent(question)}&run=1`,
    ]) {
      const rewritten = privateAnswerHref(href);
      expect(rewritten).not.toContain("lithium");
      expect(new URL(rewritten, window.location.origin).searchParams.has(answerHandoffParam)).toBe(true);
    }
  });

  it("leaves drafts, other modes, other paths and other sites alone", () => {
    for (const href of [
      `/?mode=answer&q=${encodeURIComponent(question)}`,
      `/?mode=documents&q=${encodeURIComponent(question)}&run=1`,
      `/dsm/search?q=${encodeURIComponent(question)}&run=1`,
      `https://example.org/?mode=answer&q=${encodeURIComponent(question)}&run=1`,
      "/?mode=answer&focus=1",
    ]) {
      expect(privateAnswerHref(href)).toBe(href);
    }
  });

  it("keeps the same id for the same question, so rewriting after an answer does not churn", () => {
    const first = privateAnswerHref(`/?mode=answer&q=${encodeURIComponent(question)}&run=1`);
    const second = privateAnswerHref(`/?mode=answer&q=${encodeURIComponent(` ${question} `)}&run=1`);
    expect(second).toBe(first);
  });

  it("resolves an id back to q for the dashboard, and an unknown id to nothing", () => {
    const ref = stashAnswerQuestion(question);
    const resolved = resolveAnswerHandoffParams(new URLSearchParams(`mode=answer&${answerHandoffParam}=${ref}&run=1`));
    expect(resolved.get("q")).toBe(question);

    const unknown = resolveAnswerHandoffParams(
      new URLSearchParams(`mode=answer&${answerHandoffParam}=33333333-3333-4333-8333-333333333333&run=1`),
    );
    expect(unknown.has("q")).toBe(false);
  });

  it("does not override a q that is already in the URL", () => {
    const params = new URLSearchParams(`q=other&${answerHandoffParam}=${stashAnswerQuestion(question)}`);
    expect(resolveAnswerHandoffParams(params)).toBe(params);
  });

  it("rejects ids that are not random UUIDs", () => {
    expect(readStashedAnswerQuestion("../../etc")).toBeNull();
    expect(stashAnswerQuestion("synthetic never-stored question", memoryStorage(), () => "not-a-uuid")).toBeNull();
  });

  it("caps how many questions a tab keeps", () => {
    const storage = memoryStorage();
    let n = 0;
    const createRef = () => `${String(n++).padStart(8, "0")}-0000-4000-8000-000000000000`;
    for (let i = 0; i < 45; i += 1) stashAnswerQuestion(`synthetic question ${i}`, storage, createRef);
    const questionKeys = [...storage.values.keys()].filter((key) => !key.endsWith("index"));
    expect(questionKeys.length).toBe(30);
  });

  it("forgets every stored question at sign-out or an account switch", () => {
    const ref = stashAnswerQuestion("synthetic question before sign-out");
    expect(readStashedAnswerQuestion(ref)).toBe("synthetic question before sign-out");
    clearAccountScopedBrowserStorage();
    expect(readStashedAnswerQuestion(ref)).toBeNull();
    expect(Object.keys(window.sessionStorage).filter((key) => key.startsWith("clinical.answer-question."))).toEqual([]);
  });

  it("still keeps the question out of the address when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    const href = privateAnswerHref(
      `/?mode=answer&q=${encodeURIComponent("synthetic blocked-storage question")}&run=1`,
      broken,
    );
    expect(href).not.toContain("synthetic");
    const ref = new URL(href, window.location.origin).searchParams.get(answerHandoffParam);
    expect(readStashedAnswerQuestion(ref, broken)).toBe("synthetic blocked-storage question");
  });
});

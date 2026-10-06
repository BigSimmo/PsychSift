import { describe, expect, it } from "vitest";

import mhaTimeframes from "../data/mha-timeframes.json";
import signOffStore from "../src/lib/admin/today-rule-sign-offs.json";
import { ruleContentSha256, ruleGate, UNSIGNED, type TodayRuleSignOffStore } from "@/lib/admin/rule-sign-off";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import type { MhaTimeframesFile } from "@/lib/mha-timeline";
import { ACCOUNT_ID_STEPS, runSigning, signOffCode, statusLines } from "../scripts/sign-today-rules";

const committedStore = signOffStore as TodayRuleSignOffStore;
/** Explicit unsigned fixture: these tests must not depend on what the owner has since committed. */
const store: TodayRuleSignOffStore = {
  approvedSigners: [],
  fatigue: UNSIGNED,
  cpd: UNSIGNED,
  mhaTimerSwitch: { medicalDeviceRuling: null, signOff: UNSIGNED },
};
const timeframes = mhaTimeframes as MhaTimeframesFile;
const now = new Date("2026-10-04T02:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";

/** Answers questions in order; a question no answer matches fails the test, so the script's order is pinned. */
function scripted(answers: [RegExp, string][]) {
  const printed: string[] = [];
  let index = 0;
  return {
    printed,
    io: {
      print: (line: string) => printed.push(line),
      ask: async (question: string) => {
        const next = answers[index];
        if (!next || !next[0].test(question)) throw new Error(`Unexpected question ${index}: ${question}`);
        index += 1;
        return next[1];
      },
    },
  };
}

const addSigner: [RegExp, string][] = [
  [/account ID/i, USER_ID],
  [/Your name/, "Dr Jane Example"],
  [/Type ADD/, "ADD"],
];
const agreeAll: [RegExp, string][] = [
  [/word for word/, "y"],
  [/figure the engine uses/, "y"],
  [/apply to the doctors/, "y"],
];

describe("rules:sign", () => {
  it("the committed store has the expected shape, signed or not", () => {
    expect(Array.isArray(committedStore.approvedSigners)).toBe(true);
    for (const signOff of [committedStore.fatigue, committedStore.cpd, committedStore.mhaTimerSwitch.signOff]) {
      expect(Object.keys(signOff).sort()).toEqual(
        ["enabled", "signedAt", "signedBy", "signedByUserId", "signedContentSha256"].sort(),
      );
    }
  });

  it("an unsigned store keeps every rule set off", () => {
    expect(
      statusLines(store, timeframes, now.getTime())
        .slice(1)
        .every((line) => line.includes(": off")),
    ).toBe(true);
  });

  it("tells the owner where to find their account ID, and looks nothing up", async () => {
    const run = scripted([[/account ID/i, "not-a-uid"]]);
    expect(await runSigning(run.io, store, timeframes, now)).toBeNull();
    expect(run.printed).toEqual(expect.arrayContaining(ACCOUNT_ID_STEPS));
  });

  it("adds the signer and signs fatigue only after every question and the typed code", async () => {
    const run = scripted([
      ...addSigner,
      [/Review and sign: Roster fatigue/, "y"],
      ...agreeAll,
      [/Type the sign-off code/, signOffCode(FATIGUE_RULE_SET).toLowerCase()],
      [/Switch it on now/, "y"],
      [/Review and sign: CPD/, "n"],
      [/Review and sign: Mental Health Act/, "n"],
    ]);
    const next = await runSigning(run.io, store, timeframes, now);
    expect(next?.approvedSigners).toEqual([{ userId: USER_ID, name: "Dr Jane Example" }]);
    expect(next?.fatigue).toMatchObject({ enabled: true, signedBy: "Dr Jane Example", signedByUserId: USER_ID });
    expect(ruleGate(next!.fatigue, FATIGUE_RULE_SET, next!.approvedSigners, now.getTime() + 1000)).toEqual({
      on: true,
    });
    expect(next?.cpd).toEqual(store.cpd);
  });

  it("does not sign when any answer is no, or the code is wrong", async () => {
    const declined = scripted([
      ...addSigner,
      [/Review and sign: Roster fatigue/, "y"],
      [/word for word/, "y"],
      [/figure the engine uses/, "n"],
      [/Review and sign: CPD/, "y"],
      ...agreeAll,
      [/Type the sign-off code/, "WRONG123"],
      [/Review and sign: Mental Health Act/, "n"],
    ]);
    const next = await runSigning(declined.io, store, timeframes, now);
    // Only the signer was added; neither rule set was signed.
    expect(next?.fatigue).toEqual(store.fatigue);
    expect(next?.cpd).toEqual(store.cpd);
  });

  describe("re-review of a standing sign-off", () => {
    const signed: TodayRuleSignOffStore = {
      ...store,
      approvedSigners: [{ userId: USER_ID, name: "Dr Jane Example" }],
      fatigue: {
        enabled: true,
        signedBy: "Dr Jane Example",
        signedByUserId: USER_ID,
        signedAt: "2026-10-03T02:00:00.000Z",
        signedContentSha256: ruleContentSha256(FATIGUE_RULE_SET),
      },
    };
    const confirm: [RegExp, string][] = [[/Which signer|account ID/i, USER_ID]];
    const rest: [RegExp, string][] = [
      [/Review and sign: CPD/, "n"],
      [/Review and sign: Mental Health Act/, "n"],
    ];

    it("revokes the standing sign-off when the owner answers No", async () => {
      const run = scripted([
        ...confirm,
        [/Review and sign: Roster fatigue/, "y"],
        [/word for word/, "y"],
        [/figure the engine uses/, "n"],
        ...rest,
      ]);
      const next = await runSigning(run.io, signed, timeframes, now);
      expect(next?.fatigue).toEqual(UNSIGNED);
      expect(run.printed.join("\n")).toMatch(/REVOKED/);
    });

    it("does not revoke on a mistyped code", async () => {
      const run = scripted([
        ...confirm,
        [/Review and sign: Roster fatigue/, "y"],
        ...agreeAll,
        [/Type the sign-off code/, "WRONG123"],
        ...rest,
      ]);
      expect(await runSigning(run.io, signed, timeframes, now)).toBeNull();
    });

    it("does not revoke when the owner skips the review", async () => {
      const run = scripted([...confirm, [/Review and sign: Roster fatigue/, "n"], ...rest]);
      expect(await runSigning(run.io, signed, timeframes, now)).toBeNull();
    });
  });

  it("refuses a system or role name for the signer", async () => {
    const run = scripted([
      [/account ID/i, USER_ID],
      [/Your name/, "PsychSift"],
    ]);
    expect(await runSigning(run.io, store, timeframes, now)).toBeNull();
  });

  it("needs a dated, recorded medical-device ruling before the countdown switch can be signed", async () => {
    const run = scripted([
      ...addSigner,
      [/Review and sign: Roster fatigue/, "n"],
      [/Review and sign: CPD/, "n"],
      [/Review and sign: Mental Health Act/, "y"],
      [/Date you confirmed/, "soon"],
      [/Where that decision/, ""],
    ]);
    const next = await runSigning(run.io, store, timeframes, now);
    expect(next?.mhaTimerSwitch).toEqual(store.mhaTimerSwitch);
  });

  it("rejects a future or impossible medical-device ruling date at sign time", async () => {
    for (const date of ["9999-01-01", "2026-10-05", "2026-02-30"]) {
      const run = scripted([
        ...addSigner,
        [/Review and sign: Roster fatigue/, "n"],
        [/Review and sign: CPD/, "n"],
        [/Review and sign: Mental Health Act/, "y"],
        [/Date you confirmed/, date],
        [/Where that decision/, "invented record"],
      ]);
      const next = await runSigning(run.io, store, timeframes, now);
      expect(next?.mhaTimerSwitch).toEqual(store.mhaTimerSwitch);
    }
  });

  it("shows the countdown interpretation and each entry's quote and pin before the MHA questions", async () => {
    const run = scripted([
      ...addSigner,
      [/Review and sign: Roster fatigue/, "n"],
      [/Review and sign: CPD/, "n"],
      [/Review and sign: Mental Health Act/, "y"],
      [/Date you confirmed/, "soon"],
      [/Where that decision/, ""],
    ]);
    await runSigning(run.io, store, timeframes, now);
    const text = run.printed.join("\n");
    expect(text).toContain("Countdown interpretation you are signing: mha-timers v2");
    const first = timeframes.entries[0]!;
    expect(text).toContain(`quote: "${first.quote}"`);
    expect(text).toContain(`source text SHA-256 ${first.sourceTextSha256}`);
  });

  it("reports fatigue as off once the source review date has passed", () => {
    const signedStore: TodayRuleSignOffStore = {
      ...store,
      approvedSigners: [{ userId: USER_ID, name: "Dr Jane Example" }],
      fatigue: {
        enabled: true,
        signedBy: "Dr Jane Example",
        signedByUserId: USER_ID,
        signedAt: "2026-10-02T02:00:00.000Z",
        signedContentSha256: ruleContentSha256(FATIGUE_RULE_SET),
      },
    };
    expect(statusLines(signedStore, timeframes, now.getTime())[1]).toContain(": ON");
    const afterReview = Date.parse(`${FATIGUE_RULE_SET.source.reviewBy}T00:00:00.000Z`) + 2 * 86_400_000;
    expect(statusLines(signedStore, timeframes, afterReview)[1]).toContain(": off");
  });

  it("asks an existing signer to confirm their account ID", async () => {
    const signed: TodayRuleSignOffStore = { ...store, approvedSigners: [{ userId: USER_ID, name: "Dr Jane Example" }] };
    const run = scripted([[/Paste your account ID/, "22222222-2222-4222-8222-222222222222"]]);
    expect(await runSigning(run.io, signed, timeframes, now)).toBeNull();
  });
});

/**
 * Guided sign-off for the three Today rule engines: roster fatigue warnings, CPD category coaching
 * and the Mental Health Act countdown switch. This is how the clinical owner turns them on.
 *
 * No agent may ever record a sign-off. `--write` refuses anything but a real interactive terminal,
 * asks every question itself and needs the exact sign-off code typed for each rule set. There is no
 * yes, answers or provider mode, and it never looks anything up online: the owner copies their own
 * account ID from the Supabase dashboard (the steps are printed).
 *
 * Report-only by default: it says which rule sets are on or off and why, and touches nothing.
 *
 * Usage:
 *   npm run rules:sign
 *   npm run rules:sign -- --write
 *
 * It writes only `src/lib/admin/today-rule-sign-offs.json`. Commit that file afterwards.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  isNamedPerson,
  RULE_GATE_REASON_WORDS,
  ruleContentSha256,
  ruleGate,
  type ApprovedRuleSigner,
  type RuleGate,
  type RuleSignOff,
  type TodayRuleSignOffStore,
  UNSIGNED,
} from "@/lib/admin/rule-sign-off";
import { CPD_CATEGORY_RULE_SET } from "@/lib/cme/category-rules-source";
import { isReviewedTimeframe, type MhaTimeframesFile } from "@/lib/mha-timeline";
import {
  currentMhaTimerSwitchContent,
  isRecordedRuling,
  MHA_TIMER_INTERPRETATION,
  mhaTimerGate,
  type MhaTimerSwitchContent,
} from "@/lib/on-call/mha-timers";
import { fatigueWarnings } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";

import { createPrompt } from "./lib/confirm.mjs";

export const STORE_PATH = join("src", "lib", "admin", "today-rule-sign-offs.json");
const TIMEFRAMES_PATH = join("data", "mha-timeframes.json");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ACCOUNT_ID_STEPS = [
  "Where to find your account ID (it is not secret, but it is yours alone):",
  "  1. Sign in at https://supabase.com/dashboard/project/sjrfecxgysukkwxsowpy/auth/users",
  "  2. Find the row with the email address you sign in to PsychSift with.",
  "  3. Copy the value in the UID column (36 characters, like 1a2b3c4d-....).",
];

export const QUESTIONS = [
  "Every quote shown matches the source document word for word.",
  "Every figure the engine uses is the one its quote states.",
  "These rules apply to the doctors and practice this app will check them against.",
];

type Io = { ask: (question: string) => Promise<string>; print: (line: string) => void };

type RuleSetChoice = { key: "fatigue" | "cpd" | "mha"; title: string };

const RULE_SETS: readonly RuleSetChoice[] = [
  { key: "fatigue", title: "Roster fatigue warnings (WA AMA agreement 2024, clause 15)" },
  { key: "cpd", title: "CPD category coaching (Medical Board CPD registration standard)" },
  { key: "mha", title: "Mental Health Act countdown switch" },
];

function gateWords(gate: RuleGate | { on: false; reason: string }): string {
  if (gate.on) return "ON";
  const words = (RULE_GATE_REASON_WORDS as Record<string, string>)[gate.reason];
  return `off: ${words ?? gate.reason.replace(/-/g, " ")}`;
}

/** The sign-off code: the first eight characters of the content pin, in capitals. */
export function signOffCode(content: unknown): string {
  return ruleContentSha256(content).slice(0, 8).toUpperCase();
}

function mhaContent(
  timeframes: MhaTimeframesFile,
  ruling: MhaTimerSwitchContent["medicalDeviceRuling"],
): MhaTimerSwitchContent {
  return currentMhaTimerSwitchContent(timeframes.entries, ruling);
}

/** One line per rule set: on, or off and why. */
export function statusLines(store: TodayRuleSignOffStore, timeframes: MhaTimeframesFile, now: number): string[] {
  const signers = store.approvedSigners;
  const mhaSwitch = {
    content: mhaContent(timeframes, store.mhaTimerSwitch.medicalDeviceRuling),
    signOff: store.mhaTimerSwitch.signOff,
  };
  return [
    `Approved signers: ${signers.length === 0 ? "none yet" : signers.map((signer) => signer.name).join(", ")}`,
    `${RULE_SETS[0]!.title}: ${gateWords(fatigueWarnings([], store.fatigue, signers, now).gate)}`,
    `${RULE_SETS[1]!.title}: ${gateWords(ruleGate(store.cpd, CPD_CATEGORY_RULE_SET, signers, now))}`,
    `${RULE_SETS[2]!.title}: ${gateWords(mhaTimerGate(mhaSwitch, timeframes.entries, signers))}`,
  ];
}

async function yes(io: Io, question: string): Promise<boolean> {
  const answer = (await io.ask(`${question} (y/N) `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

function showFatigue(io: Io): void {
  const { source, rules } = FATIGUE_RULE_SET;
  io.print(`Source: ${source.title} (${source.citation}), checked ${source.checkedOn}`);
  io.print(`  ${source.url}`);
  io.print(`  PDF SHA-256 ${source.pdfSha256}; review by ${source.reviewBy}`);
  for (const [id, rule] of Object.entries(rules)) {
    const quotes: string[] = [];
    if ("quote" in rule) quotes.push(rule.quote);
    if ("leadIn" in rule) quotes.push(rule.leadIn, ...rule.bands.map((band) => band.quote), rule.caveat);
    if ("exception" in rule) quotes.push(`Exception: ${rule.exception.quote}`);
    io.print(`  - ${id}, clause ${rule.clause}`);
    for (const quote of quotes) io.print(`      "${quote}"`);
  }
}

function showCpd(io: Io): void {
  const { source, rules } = CPD_CATEGORY_RULE_SET;
  io.print(`Source: ${source.title}, effective ${source.effectiveFrom}, checked ${source.checkedOn}`);
  io.print(`  ${source.url}`);
  io.print(`  PDF SHA-256 ${source.pdfSha256}`);
  for (const [id, rule] of Object.entries(rules)) io.print(`  - ${id}: "${rule.quote}"`);
}

function showMha(io: Io, timeframes: MhaTimeframesFile): void {
  io.print("The switch covers these timeframes. Each counts down only once its own sign-off is by a");
  io.print("named clinician; the rest stay quote-only whatever the switch says.");
  io.print(`Countdown interpretation you are signing: ${MHA_TIMER_INTERPRETATION}`);
  for (const entry of timeframes.entries) {
    const countable = isReviewedTimeframe(entry) && isNamedPerson(entry.reviewedBy) && entry.computeAllowed !== false;
    io.print(
      `  - Form ${entry.formCodes.join("/")}, s ${entry.section}, ${entry.duration.value} ${entry.duration.unit}: ` +
        `signed by ${entry.reviewedBy ?? "nobody"}${countable ? "" : " (will stay quote-only)"}`,
    );
    io.print(`      trigger: ${entry.trigger}; counted from: ${entry.anchor}`);
    if (entry.condition) io.print(`      condition: ${entry.condition}`);
    if (entry.leadIn) io.print(`      lead-in: "${entry.leadIn}"`);
    io.print(`      quote: "${entry.quote}"`);
    if (entry.caveat) io.print(`      caveat (s ${entry.caveat.section}): "${entry.caveat.quote}"`);
    io.print(
      `      status ${entry.status}; reviewed at ${entry.reviewedAt ?? "never"}; ` +
        `content pin ${entry.reviewedContentSha256 ?? "none"}; source text SHA-256 ${entry.sourceTextSha256}`,
    );
  }
}

async function chooseSigner(
  io: Io,
  store: TodayRuleSignOffStore,
): Promise<{ signer: ApprovedRuleSigner; added: boolean } | null> {
  if (store.approvedSigners.length > 0) {
    for (const [index, signer] of store.approvedSigners.entries()) io.print(`  ${index + 1}. ${signer.name}`);
    const pick = store.approvedSigners.length === 1 ? "1" : (await io.ask("Which signer are you? (number) ")).trim();
    const signer = store.approvedSigners[Number(pick) - 1];
    if (!signer) return null;
    const id = (await io.ask(`Paste your account ID to confirm you are ${signer.name}: `)).trim();
    return id.toLowerCase() === signer.userId.toLowerCase() ? { signer, added: false } : null;
  }
  io.print("No approved signer yet. You will add yourself first.");
  for (const line of ACCOUNT_ID_STEPS) io.print(line);
  const userId = (await io.ask("Your account ID (UID): ")).trim();
  if (!UUID.test(userId)) {
    io.print("That is not a UID. Nothing was changed.");
    return null;
  }
  io.print('Your name as it should appear on each sign-off: a given name and surname, e.g. "Dr Jane Citizen".');
  const name = (await io.ask("Your name: ")).trim().replace(/\s+/g, " ");
  if (!isNamedPerson(name)) {
    io.print("That name will not pass the engines' named-clinician check (it needs a given name and a surname,");
    io.print("and no system or role words). Nothing was changed.");
    return null;
  }
  const typed = (await io.ask(`Type ADD to make ${name} (${userId}) the approved signer: `)).trim();
  if (typed !== "ADD") {
    io.print("Not added. Nothing was changed.");
    return null;
  }
  return { signer: { userId: userId.toLowerCase(), name }, added: true };
}

const REVOKED = Symbol("revoked");

async function signOne(
  io: Io,
  title: string,
  content: unknown,
  signer: ApprovedRuleSigner,
  now: Date,
  existing?: RuleSignOff,
): Promise<RuleSignOff | typeof REVOKED | null> {
  io.print("");
  for (const question of QUESTIONS) {
    if (!(await yes(io, question))) {
      // Owner decision (2026-10-03): an explicit No at a re-review revokes a standing sign-off.
      // A cancelled review or a mistyped code (below) never does.
      if (existing?.signedAt) {
        io.print(`${title}: you answered No, so the existing sign-off is REVOKED and the rule set is off.`);
        return REVOKED;
      }
      io.print(`${title}: not signed.`);
      return null;
    }
  }
  const code = signOffCode(content);
  const typed = (await io.ask(`Type the sign-off code ${code} to sign: `)).trim().toUpperCase();
  if (typed !== code) {
    io.print(`${title}: the code did not match, so it was not signed.`);
    return null;
  }
  const enabled = await yes(io, "Switch it on now? You can sign now and switch on later.");
  return {
    enabled,
    signedBy: signer.name,
    signedByUserId: signer.userId,
    signedAt: now.toISOString(),
    signedContentSha256: ruleContentSha256(content),
  };
}

/**
 * The interactive core, given an `ask`/`print` pair, the current store and the time. Returns the
 * new store, or null when nothing was signed. Never writes; the caller does, once.
 */
export async function runSigning(
  io: Io,
  store: TodayRuleSignOffStore,
  timeframes: MhaTimeframesFile,
  now: Date,
): Promise<TodayRuleSignOffStore | null> {
  io.print("Today rule engines: guided sign-off.");
  for (const line of statusLines(store, timeframes, now.getTime())) io.print(`  ${line}`);
  io.print("");

  const chosen = await chooseSigner(io, store);
  if (!chosen) return null;
  let next: TodayRuleSignOffStore = chosen.added
    ? { ...store, approvedSigners: [...store.approvedSigners, chosen.signer] }
    : store;
  let changed = chosen.added;

  for (const set of RULE_SETS) {
    io.print("");
    if (!(await yes(io, `Review and sign: ${set.title}?`))) continue;
    if (set.key === "fatigue") {
      showFatigue(io);
      const signOff = await signOne(io, set.title, FATIGUE_RULE_SET, chosen.signer, now, store.fatigue);
      if (signOff) {
        next = { ...next, fatigue: signOff === REVOKED ? { ...UNSIGNED } : signOff };
        changed = true;
      }
    } else if (set.key === "cpd") {
      showCpd(io);
      const signOff = await signOne(io, set.title, CPD_CATEGORY_RULE_SET, chosen.signer, now, store.cpd);
      if (signOff) {
        next = { ...next, cpd: signOff === REVOKED ? { ...UNSIGNED } : signOff };
        changed = true;
      }
    } else {
      showMha(io, timeframes);
      io.print("A per-patient countdown needs your medical-device ruling re-checked first.");
      const confirmedOn = (await io.ask("Date you confirmed or revised that ruling (YYYY-MM-DD): ")).trim();
      const record = (await io.ask("Where that decision is written down (a file or link): ")).trim();
      const ruling = { confirmedOn, record };
      if (!ISO_DATE.test(confirmedOn) || !isRecordedRuling(ruling, now.toISOString())) {
        io.print(`${set.title}: needs a real date, no later than today, and a record, so it was not signed.`);
        continue;
      }
      const signOff = await signOne(
        io,
        set.title,
        mhaContent(timeframes, ruling),
        chosen.signer,
        now,
        store.mhaTimerSwitch.signOff,
      );
      if (signOff === REVOKED) {
        next = { ...next, mhaTimerSwitch: { ...next.mhaTimerSwitch, signOff: { ...UNSIGNED } } };
        changed = true;
      } else if (signOff) {
        next = { ...next, mhaTimerSwitch: { medicalDeviceRuling: ruling, signOff } };
        changed = true;
      }
    }
  }

  io.print("");
  for (const line of statusLines(next, timeframes, now.getTime())) io.print(`  ${line}`);
  return changed ? next : null;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const storeFile = join(root, STORE_PATH);
  const rawStore = readFileSync(storeFile, "utf8");
  const store = JSON.parse(rawStore) as TodayRuleSignOffStore;
  const timeframes = JSON.parse(readFileSync(join(root, TIMEFRAMES_PATH), "utf8")) as MhaTimeframesFile;
  const write = process.argv.includes("--write");

  if (!write) {
    console.log("Today rule engines (report only; nothing is changed):");
    for (const line of statusLines(store, timeframes, Date.now())) console.log(`  ${line}`);
    console.log("To sign: npm run rules:sign -- --write");
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "--write requires an interactive terminal; piped, scripted and agent-supplied sign-offs are refused.",
    );
  }
  const prompt = createPrompt();
  try {
    const next = await runSigning(
      { ask: prompt.ask, print: (line) => console.log(line) },
      store,
      timeframes,
      new Date(),
    );
    if (!next) {
      console.log("Nothing was signed; the file is unchanged.");
      return;
    }
    // Another checkout or process may have changed the file while the questions were open: refuse
    // rather than overwrite it with the snapshot read at startup.
    if (readFileSync(storeFile, "utf8") !== rawStore) {
      console.error(`${STORE_PATH} changed while you were signing, so nothing was saved. Run the command again.`);
      process.exitCode = 1;
      return;
    }
    const temporary = `${storeFile}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(temporary, storeFile);
    console.log(`Saved ${STORE_PATH}. Commit it, or tell Claude it is signed so it can be committed for you.`);
  } finally {
    prompt.close();
  }
}

if (process.argv[1] && /sign-today-rules\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

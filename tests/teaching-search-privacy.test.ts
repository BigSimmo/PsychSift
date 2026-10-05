import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

/*
 * Text in the main search bar, and voice, leave the app (contracts §8). No
 * Teaching file may reach for the shared composer, the microphone or the
 * search and speech APIs; a filter box filters loaded rows only.
 *
 * Teaching keeps nothing members-only on the device (global constraint 6), with
 * one named exception the master plan's reconciliation settled (R4): the
 * viewer's own "My level" choice on What's on is not members-only data, and is
 * stored on the device under exactly one key, `teaching.whatsOn.level`, so the
 * pick survives a reload without a server round trip. `sessionStorage`,
 * `indexedDB` and `caches` stay forbidden outright, and `localStorage` under
 * any OTHER key stays forbidden too -- only that one exact key is read.
 */
const ROOTS = [
  "src/components/teaching",
  "src/app/(search-app)/teaching",
  "src/app/(display)/teaching",
  "src/lib/teaching",
];
const FORBIDDEN_IMPORTS = [
  "@/components/clinical-dashboard/global-search-shell",
  "@/components/clinical-dashboard/master-search-header",
  "@/components/clinical-dashboard/use-clinical-ask-speech",
  "@/components/clinical-dashboard/dashboard-desktop-result-composer-slot",
  "@/components/desktop-composer-portal-slot",
];
const FORBIDDEN_TEXT: Array<[RegExp, string]> = [
  [/\/api\/search\b/, "the search API"],
  [/\/api\/speech\b/, "the speech API"],
  [/SpeechRecognition|getUserMedia|mediaDevices/, "the microphone"],
  [/\bsessionStorage\b|\bindexedDB\b|\bcaches\.open\b/, "device storage"],
  [/Notification\.requestPermission|pushManager/, "push notifications"],
];

/** R4's one allowed device key: What's on's remembered "My level" pick. */
const WHATS_ON_LEVEL_KEY = "teaching.whatsOn.level";

/** Strips only an access to the one allowed key, so any other `localStorage` use still trips the guard below. */
function withoutAllowedStorageAccess(source: string): string {
  const accessor = new RegExp(
    `localStorage\\.(?:get|set|remove)Item\\(\\s*(["'\`])${WHATS_ON_LEVEL_KEY.replace(/\./g, "\\.")}\\1[^)]*\\)`,
    "g",
  );
  return source.replace(accessor, "");
}

/**
 * The term tracker and exam prep store (2026-10-05): the doctor's own term dates, EPA counts and study
 * log, kept on the device under the two account-scoped keys the auth provider clears at sign-out. This
 * one file may touch localStorage, and only through those two named keys: it must import both from
 * `account-scoped-browser-state` and spell no storage key of its own.
 */
const TERM_TRACKER_STORE = "src/lib/teaching/term-tracker-store.ts";

function withoutApprovedTermTrackerStorage(path: string, source: string): string {
  if (!path.split(sep).join("/").endsWith(TERM_TRACKER_STORE)) return source;
  expect(source).toMatch(/TEACHING_TERM_TRACKER_STORAGE_KEY/);
  expect(source).toMatch(/TEACHING_EXAM_PREP_STORAGE_KEY/);
  expect(source).toContain('"@/lib/account-scoped-browser-state"');
  expect(source, "the store spells no storage key of its own").not.toMatch(/Item\(\s*["'`]/);
  return source.replace(/\blocalStorage\b/g, "");
}

function files(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path);
    }
  };
  for (const root of ROOTS) if (existsSync(join(process.cwd(), root))) walk(join(process.cwd(), root));
  return found;
}

describe("Teaching search privacy", () => {
  const all = files();

  it("scans a real set of files", () => {
    expect(all.length).toBeGreaterThan(5);
  });

  it.each(all)("%s reaches for no composer, microphone, search API, unapproved device storage or push", (path) => {
    const source = readFileSync(path, "utf8");
    const sanitized = withoutApprovedTermTrackerStorage(path, withoutAllowedStorageAccess(source));
    for (const specifier of FORBIDDEN_IMPORTS)
      expect(source, `${path} imports ${specifier}`).not.toContain(`"${specifier}"`);
    for (const [pattern, what] of FORBIDDEN_TEXT) expect(sanitized, `${path} reaches ${what}`).not.toMatch(pattern);
    expect(sanitized, `${path} reaches localStorage outside the one allowed key (${WHATS_ON_LEVEL_KEY})`).not.toMatch(
      /\blocalStorage\b/,
    );
  });

  it.each(all)("%s never invites patient details into a filter box", (path) => {
    for (const [, placeholder] of readFileSync(path, "utf8").matchAll(/placeholder=["{`]+([^"`}]*)/g)) {
      expect(placeholder, `${path}: "${placeholder}"`).not.toMatch(/patient|diagnos|MRN|date of birth|ask anything/i);
    }
  });

  it("allows only the exact What's on level key on localStorage, and still catches every other key", () => {
    const allowed = `localStorage.setItem("${WHATS_ON_LEVEL_KEY}", level);`;
    expect(withoutAllowedStorageAccess(allowed)).not.toMatch(/localStorage/);
    const otherKey = `localStorage.setItem("teaching.something.else", level);`;
    expect(withoutAllowedStorageAccess(otherKey)).toMatch(/localStorage/);
    const bareRead = `const raw = window.localStorage;`;
    expect(withoutAllowedStorageAccess(bareRead)).toMatch(/localStorage/);
  });
});

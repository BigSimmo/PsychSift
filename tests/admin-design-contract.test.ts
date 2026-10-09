import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ADMIN_ROOTS = ["src/components/admin", "src/lib/admin", "src/app/(search-app)/admin"];

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * Every file that draws an Admin page. Renewals renders On Call's compliance section,
 * so Task 6 appends "src/components/on-call/on-call-compliance-section.tsx" here once
 * its band tones are grey. Nothing else may be appended without the owner's say.
 */
const ADMIN_DESIGN_FILES: readonly string[] = [...ADMIN_ROOTS.flatMap(filesUnder)];

/**
 * Work-mode redesign, owner request 6 Oct 2026: status colour is allowed
 * again, through ONE shared status tag only. Red means the recorded date has
 * passed, amber means it is time to start renewing, and both live in this one
 * stylesheet, drawn by `admin-status-tag.tsx` (`data-admin-status`). Every
 * other Admin file, stylesheets included, stays grey.
 */
const ADMIN_STATUS_STYLESHEET = "src/components/admin/admin-status.module.css";

function stylesheetsUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) return stylesheetsUnder(path);
    return /\.css$/.test(name) ? [path] : [];
  });
}
const ADMIN_STYLESHEETS: readonly string[] = ADMIN_ROOTS.flatMap(stylesheetsUnder);

/** Red and amber in any spelling Admin could reach for. */
// Work-mode redesign (6 Oct 2026): the kit's `tone="red"` and `tone="amber"` count too, so
// status colour cannot reach an Admin page except through the one status tag.
const RED =
  /--danger|--stop\b|\b(?:text|bg|border|fill|stroke)-red-|tone(?:=|:\s*)["'](?:danger|red)["']|variant(?:=|:\s*)["']danger["']/;
const AMBER =
  /--warning|\b(?:text|bg|border)-amber-|tone(?:=|:\s*)["'](?:warning|amber)["']|variant(?:=|:\s*)["']amber["']/;
const RED_ALLOWED = /data-admin-red(?:=|:\s*)(?:\{[^}]*)?["']emergency-number["']/;
/** Spec review 5: nothing on the device. */
const DEVICE_STORAGE = /\b(?:localStorage|sessionStorage|indexedDB|createBrowserStore)\b/;
/** Spec review 18: no shared composer and no microphone on any Admin page. */
const COMPOSER_OR_MIC =
  /desktop-composer-portal-slot|master-search-header|global-search-shell|use-clinical-ask-speech|speech\/transcribe|\bMic(?:Off)?\b/;
/** Brown belongs to the pill and the rail, which set it themselves. */
const IDENTITY = /data-mode-identity|--type-form|--mode-identity/;
/** One shared helper for times (spec rule 11). */
const OTHER_TIME_FORMAT = /hour12\s*:\s*true|hourCycle\s*:\s*["']h1[12]["']|toLocaleTimeString/;
/** Standard §7: shared tokens only (`duration-[var(--duration-quick)]` is fine), no loops, bounce or scale. */
const LOUD_MOTION = /\banimate-(?:pulse|bounce|ping)\b|\bduration-(?:\d|\[\d)|\bscale-\d/;

function offendingLines(pattern: RegExp): string[] {
  return ADMIN_DESIGN_FILES.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
  );
}

describe("Admin's design contract (shared standard, spec Admin design rules and review)", () => {
  it("has Admin files to read", () => {
    expect(ADMIN_DESIGN_FILES.length).toBeGreaterThanOrEqual(12);
  });

  it("uses red only on the emergency number, marked where it is drawn", () => {
    const unmarked = ADMIN_DESIGN_FILES.flatMap((file) => {
      const lines = readFileSync(file, "utf8").split("\n");
      return lines.flatMap((line, index) => {
        if (!RED.test(line)) return [];
        // The marker sits on the same element: within three lines either side.
        const element = lines.slice(Math.max(0, index - 3), index + 4).join("\n");
        return RED_ALLOWED.test(element) ? [] : [`${file}:${index + 1}: ${line.trim()}`];
      });
    });
    expect(unmarked).toEqual([]);
  });

  it("uses no amber: urgency and status are grey (spec rule 2)", () => {
    expect(offendingLines(AMBER)).toEqual([]);
  });

  it("colours a status only in the one status-tag stylesheet: red for a passed date, amber for start renewing", () => {
    // Work-mode redesign, owner request 6 Oct 2026 (amends spec rule 2 narrowly).
    const css = readFileSync(ADMIN_STATUS_STYLESHEET, "utf8");
    expect(css).toMatch(/\[data-admin-status="date-passed"\][^{]*\{[^}]*--danger-text/);
    expect(css).toMatch(/\[data-admin-status="start-renewing"\][^{]*\{[^}]*--warning-text/);
    const elsewhere = ADMIN_STYLESHEETS.filter((file) => file !== ADMIN_STATUS_STYLESHEET).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (RED.test(line) || AMBER.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
    );
    expect(elsewhere).toEqual([]);
    const users = ADMIN_DESIGN_FILES.filter((file) => readFileSync(file, "utf8").includes("admin-status.module.css"));
    expect(users).toEqual(["src/components/admin/admin-status-tag.tsx"]);
  });

  it("never paints brown outside the pill and the rail", () => {
    expect(offendingLines(IDENTITY)).toEqual([]);
  });

  it("formats clock times only through src/lib/clock-time.ts", () => {
    expect(offendingLines(OTHER_TIME_FORMAT)).toEqual([]);
  });

  it("uses only the shared motion tokens", () => {
    expect(offendingLines(LOUD_MOTION)).toEqual([]);
  });

  it("keeps nothing on the device except pinned row ids and the credentials wallet, each in its one module", () => {
    // Owner decision, 2026-10-01: pinned numbers live on this device, as row ids
    // only (`src/lib/admin/pins.ts`, pinned by tests/admin-pins.test.ts).
    // Owner decision, 2026-10-03: the doctor's own registration numbers (the credentials
    // wallet) may also live on this device, in `src/lib/admin/credentials-storage.ts` only,
    // cleared on sign-out via `src/lib/account-scoped-browser-state.ts`.
    const ALLOWED_MODULE = /^src\/lib\/admin\/(?:pins|pin-storage-keys|credentials-storage)\.ts:/;
    expect(offendingLines(DEVICE_STORAGE).filter((line) => !ALLOWED_MODULE.test(line))).toEqual([]);
  });

  it("never mounts the shared composer or a microphone", () => {
    expect(offendingLines(COMPOSER_OR_MIC)).toEqual([]);
  });
});

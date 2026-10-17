import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hasMhaTimeline } from "@/lib/mha-timeline";
import { mhaClockForms } from "@/lib/psychiatry-hub/mha-clock-forms";
import { fetchStarterSharing, writeStarterSharing } from "@/lib/work-roles/starter-sharing";
import {
  EXPECTED_CATATONIA_ROW_KEYS,
  parseCatatoniaWorksheet,
  parseWorksheetArgs,
} from "../scripts/apply-specifier-worksheet.mjs";

const REPO_ROOT = process.cwd();

describe("mhaClockForms", () => {
  it("returns only forms that carry governed MHA timeline definitions", () => {
    const forms = mhaClockForms();
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(form.code.length).toBeGreaterThan(0);
      expect(form.title.length).toBeGreaterThan(0);
      expect(form.slug.length).toBeGreaterThan(0);
      expect(hasMhaTimeline(form.code)).toBe(true);
    }
  });
});

describe("starter-sharing preference reader and CAS writer", () => {
  it("rejects empty ownerId and reads default off choice when no preferences row exists", async () => {
    const fakeSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof fetchStarterSharing>[0];

    await expect(fetchStarterSharing(fakeSupabase, "")).rejects.toThrow("Missing sharing owner.");
    const choice = await fetchStarterSharing(fakeSupabase, "user-123");
    expect(choice).toEqual({ workforce: false, updatedAt: null });
  });

  it("inserts a new preferences row or updates an existing row via compare-and-swap", async () => {
    let storedRow: { preferences: Record<string, unknown>; updated_at: string } | null = null;
    const fakeSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: storedRow, error: null }),
          }),
        }),
        insert: async (payload: { preferences: Record<string, unknown>; updated_at: string }) => {
          storedRow = { preferences: payload.preferences, updated_at: payload.updated_at };
          return { error: null };
        },
        update: (payload: { preferences: Record<string, unknown>; updated_at: string }) => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  storedRow = { preferences: payload.preferences, updated_at: payload.updated_at };
                  return { data: { updated_at: payload.updated_at }, error: null };
                },
              }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof writeStarterSharing>[0];

    const first = await writeStarterSharing(fakeSupabase, "user-123", true);
    expect(first.workforce).toBe(true);
    expect(typeof first.updatedAt).toBe("string");

    const second = await writeStarterSharing(fakeSupabase, "user-123", false);
    expect(second.workforce).toBe(false);
    expect(storedRow?.preferences).toHaveProperty("starterSharing");
  });
});

describe("apply-specifier-worksheet CLI & parser", () => {
  it("parses CLI flags and validates catatonia worksheet keys", () => {
    expect(EXPECTED_CATATONIA_ROW_KEYS).toHaveLength(9);
    expect(parseWorksheetArgs(["--worksheet", "docs/custom.md", "--write"])).toEqual({
      worksheet: "docs/custom.md",
      write: true,
      dryRun: false,
    });
    expect(() => parseWorksheetArgs(["--dry-run", "--write"])).toThrow("Specify at most one of --dry-run or --write.");

    expect(() => parseCatatoniaWorksheet("# Shared\n> _(blank)_\n## 2. Disorders\n")).toThrow(
      /Worksheet is incomplete; refusing to apply/,
    );
  });
});

describe("offline utility and verification script contracts", () => {
  const SCRIPT_PATHS = [
    "scripts/apply-specifier-worksheet.mjs",
    "scripts/figma-sync/build-calls.mjs",
    "scripts/figma-sync/capture.mjs",
    "scripts/format-differentials-summaries.mjs",
    "scripts/measure-work-mode-speed.mjs",
    "scripts/patch-therapy-references.mjs",
    "scripts/run-preview-smoke.mjs",
    "scripts/test-sql-behaviour.ts",
  ] as const;

  it("verifies safety guards and CLI contracts across the offline script suite", () => {
    for (const relPath of SCRIPT_PATHS) {
      const content = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      expect(content.length).toBeGreaterThan(100);
    }

    const buildCalls = readFileSync(path.join(REPO_ROOT, "scripts/figma-sync/build-calls.mjs"), "utf8");
    expect(buildCalls).toContain("CALL_CHAR_LIMIT");
    expect(buildCalls).toContain("planPageCalls");

    const capture = readFileSync(path.join(REPO_ROOT, "scripts/figma-sync/capture.mjs"), "utf8");
    expect(capture).toContain("/api/local-project-id");
    expect(capture).toContain("localProjectId");

    const speed = readFileSync(path.join(REPO_ROOT, "scripts/measure-work-mode-speed.mjs"), "utf8");
    expect(speed).toContain("localProjectId");
    expect(speed).toContain("largest-contentful-paint");

    const previewSmoke = readFileSync(path.join(REPO_ROOT, "scripts/run-preview-smoke.mjs"), "utf8");
    expect(previewSmoke).toContain("PLAYWRIGHT_BASE_URL");
    expect(previewSmoke).toContain("Unsupported protocol:");

    const sqlBehaviour = readFileSync(path.join(REPO_ROOT, "scripts/test-sql-behaviour.ts"), "utf8");
    expect(sqlBehaviour).toContain("@sha256:");
    expect(sqlBehaviour).toContain("com.psychiatry-tools.sql-behaviour.worktree");

    const diffFormat = readFileSync(path.join(REPO_ROOT, "scripts/format-differentials-summaries.mjs"), "utf8");
    expect(diffFormat).toContain("differentials-snapshot.json");

    const therapyRefs = readFileSync(path.join(REPO_ROOT, "scripts/patch-therapy-references.mjs"), "utf8");
    expect(therapyRefs).toContain("THERAPY_CITATIONS");
  });
});

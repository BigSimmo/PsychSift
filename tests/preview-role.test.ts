import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PREVIEW_ROLES,
  PREVIEW_ROLE_SCREENS,
  PREVIEW_ROLE_STORAGE_KEY,
  previewToolsEnabled,
  readPreviewRole,
  writePreviewRole,
} from "@/lib/preview-role/preview-role";

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("preview role", () => {
  it("defaults to junior when nothing or something unknown is stored", () => {
    expect(readPreviewRole(memoryStore())).toBe("junior");
    expect(readPreviewRole(memoryStore({ [PREVIEW_ROLE_STORAGE_KEY]: "owner" }))).toBe("junior");
    expect(readPreviewRole(null)).toBe("junior");
  });

  it("round-trips each role through storage", () => {
    for (const role of PREVIEW_ROLES) {
      const store = memoryStore();
      expect(writePreviewRole(store, role)).toBe(true);
      expect(readPreviewRole(store)).toBe(role);
    }
  });

  it("falls back to junior when storage throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPreviewRole(blocked)).toBe("junior");
    expect(writePreviewRole(blocked, "admin")).toBe(false);
  });

  it("is inert in a production build unless mockups were switched on", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_MOCKUPS_ENABLED", "");
    const store = memoryStore({ [PREVIEW_ROLE_STORAGE_KEY]: "admin" });
    expect(previewToolsEnabled()).toBe(false);
    expect(readPreviewRole(store)).toBe("junior");
    expect(writePreviewRole(store, "supervisor")).toBe(false);
    expect(store.data.get(PREVIEW_ROLE_STORAGE_KEY)).toBe("admin");

    vi.stubEnv("NEXT_PUBLIC_MOCKUPS_ENABLED", "true");
    expect(readPreviewRole(store)).toBe("admin");
  });

  it("only links supervisor and admin screens that carry sample data or a server check", () => {
    for (const screen of PREVIEW_ROLE_SCREENS.supervisor.filter((s) => s.ready)) {
      expect(screen.href).toContain("as=supervisor");
    }
    const hrefs = Object.values(PREVIEW_ROLE_SCREENS).flatMap((list) => list.map((s) => s.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

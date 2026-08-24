import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Supabase server client", () => {
  it("binds a validated bearer to every request made by the user-context client", async () => {
    const createdClient = { kind: "bearer-server-client" };
    const createClient = vi.fn(() => createdClient);
    vi.doMock("server-only", () => ({}));
    vi.doMock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.doMock("next/headers", () => ({ cookies: vi.fn() }));
    vi.doMock("@/lib/env", () => ({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      },
    }));
    const { createSupabaseBearerServerClient } = await import("../src/lib/supabase/server");

    expect(createSupabaseBearerServerClient("validated-administrator-jwt")).toBe(createdClient);
    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "sb_publishable_test",
      expect.objectContaining({
        global: { headers: { Authorization: "Bearer validated-administrator-jwt" } },
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      }),
    );
  });

  it("stays disabled when public Supabase configuration is incomplete", async () => {
    const createServerClient = vi.fn();
    const cookies = vi.fn();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@supabase/ssr", () => ({ createServerClient }));
    vi.doMock("next/headers", () => ({ cookies }));
    vi.doMock("@/lib/env", () => ({
      env: { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" },
    }));
    const { createSupabaseServerClient, publicSupabaseConfig } = await import("../src/lib/supabase/server");

    expect(publicSupabaseConfig()).toBeNull();
    await expect(createSupabaseServerClient()).resolves.toBeNull();
    expect(cookies).not.toHaveBeenCalled();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("connects the Next.js cookie store to the SSR client", async () => {
    const cookieRows = [{ name: "sb-session", value: "session-value" }];
    const cookieStore = {
      getAll: vi.fn(() => cookieRows),
      set: vi.fn(),
    };
    let cookieAdapter:
      | {
          getAll(): typeof cookieRows;
          setAll(
            rows: Array<{ name: string; value: string; options: Record<string, unknown> }>,
            headers: Record<string, string>,
          ): void;
        }
      | undefined;
    const createdClient = { kind: "server-client" };
    const createServerClient = vi.fn(
      (_url: string, _key: string, options: { cookies: NonNullable<typeof cookieAdapter> }) => {
        cookieAdapter = options.cookies;
        return createdClient;
      },
    );
    vi.doMock("server-only", () => ({}));
    vi.doMock("@supabase/ssr", () => ({ createServerClient }));
    vi.doMock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));
    vi.doMock("@/lib/env", () => ({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      },
    }));
    const { createSupabaseServerClient, publicSupabaseConfig } = await import("../src/lib/supabase/server");

    expect(publicSupabaseConfig()).toEqual({
      url: "https://project.supabase.co",
      key: "sb_publishable_test",
    });
    await expect(createSupabaseServerClient()).resolves.toBe(createdClient);
    expect(createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "sb_publishable_test",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
    expect(cookieAdapter?.getAll()).toEqual(cookieRows);

    const options = { httpOnly: true };
    cookieAdapter?.setAll([{ name: "sb-refresh", value: "new-value", options }], {
      "Cache-Control": "private, no-store",
    });
    expect(cookieStore.set).toHaveBeenCalledWith("sb-refresh", "new-value", options);
  });

  it("delegates cookie and response-header mutations to a route response owner", async () => {
    const cookieStore = {
      getAll: vi.fn(() => []),
      set: vi.fn(),
    };
    let setAll:
      | ((
          rows: Array<{ name: string; value: string; options: Record<string, unknown> }>,
          headers: Record<string, string>,
        ) => void)
      | undefined;
    const setAllCookies = vi.fn();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: vi.fn(
        (_url: string, _key: string, options: { cookies: { setAll: NonNullable<typeof setAll> } }) => {
          setAll = options.cookies.setAll;
          return { kind: "server-client" };
        },
      ),
    }));
    vi.doMock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));
    vi.doMock("@/lib/env", () => ({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      },
    }));
    const { createSupabaseServerClient } = await import("../src/lib/supabase/server");

    await createSupabaseServerClient({ setAllCookies });

    const rows = [{ name: "sb-refresh", value: "new-value", options: { httpOnly: true } }];
    const headers = { "Cache-Control": "private, no-store", Pragma: "no-cache" };
    setAll?.(rows, headers);

    expect(setAllCookies).toHaveBeenCalledWith(rows, headers);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("tolerates cookie writes from read-only Server Component contexts", async () => {
    const cookieStore = {
      getAll: vi.fn(() => []),
      set: vi.fn(() => {
        throw new Error("Cookies can only be modified in a Server Action or Route Handler");
      }),
    };
    let setAll:
      | ((
          rows: Array<{ name: string; value: string; options: Record<string, unknown> }>,
          headers: Record<string, string>,
        ) => void)
      | undefined;
    vi.doMock("server-only", () => ({}));
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: vi.fn(
        (_url: string, _key: string, options: { cookies: { setAll: NonNullable<typeof setAll> } }) => {
          setAll = options.cookies.setAll;
          return { kind: "server-client" };
        },
      ),
    }));
    vi.doMock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));
    vi.doMock("@/lib/env", () => ({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      },
    }));
    const { createSupabaseServerClient } = await import("../src/lib/supabase/server");

    await createSupabaseServerClient();

    expect(() =>
      setAll?.([{ name: "sb-refresh", value: "new-value", options: {} }], {
        "Cache-Control": "private, no-store",
      }),
    ).not.toThrow();
    expect(cookieStore.set).toHaveBeenCalledOnce();
  });
});

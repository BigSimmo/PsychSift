/** @vitest-environment jsdom */

// Account transitions must not hand one clinician's patient context to the next
// person at a shared workstation. The three transitions the auth provider owns —
// sign-out, session expiry, and a change of signed-in user in the same tab —
// already clear recent queries, the answer thread and the signed-URL cache. This
// file pins the stores those paths were missing: the sessionStorage patient
// physiology profile (2026-09-02 audit, M4), the favourites pins / last-opened
// keys (L2) and the legacy plan-draft key left by the retired Caring Contacts
// prototype (L6), which a browser that used it may still hold.

import { readFileSync } from "node:fs";
import path from "node:path";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => {
  const listeners = new Set<(event: string, session: unknown) => void>();
  const session = {
    access_token: "user-a-token",
    refresh_token: "refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "user-a" },
  };
  return {
    listeners,
    session,
    signOut: vi.fn(async () => {
      for (const listener of listeners) listener("SIGNED_OUT", null);
      return { error: null };
    }),
    getUser: vi.fn(async () => ({ data: { user: session.user }, error: null })),
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    }),
  };
});

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: authApi.getUser,
      getSession: authApi.getSession,
      signOut: authApi.signOut,
      onAuthStateChange: authApi.onAuthStateChange,
      signInWithOtp: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  }),
}));

import {
  DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY,
  DATABASE_FAVOURITES_PINNED_STORAGE_KEY,
  loadFavouriteLastOpened,
  loadFavouritePinnedIds,
  recordFavouriteOpened,
  resetFavouritesStorageForTesting,
  subscribeFavouritesStorage,
  toggleFavouritePinnedId,
} from "@/components/favourites/favourites-storage";
import {
  ACCOUNT_TRANSITION_EVENT,
  PLAN_DRAFT_STORAGE_KEY,
  PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY,
  clearAccountScopedBrowserStorage,
  subscribeAccountTransition,
} from "@/lib/account-scoped-browser-state";
import {
  EMPTY_PATIENT_PROFILE,
  PATIENT_PROFILE_STORAGE_KEY,
  getPatientProfileSnapshot,
  subscribePatientProfile,
  writePatientProfile,
} from "@/lib/patient-profile-storage";
import { AuthProvider, useAuthSession } from "@/lib/supabase/client";

const USER_B_SESSION = { ...authApi.session, access_token: "user-b-token", user: { id: "user-b" } };

function AuthActions() {
  const { status, signOut, markSessionExpired } = useAuthSession();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      <button type="button" onClick={() => markSessionExpired()}>
        Expire session
      </button>
    </div>
  );
}

async function mountAuthenticated() {
  render(
    <AuthProvider>
      <AuthActions />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
}

async function emitAuthStateChange(event: string, session: unknown) {
  await act(async () => {
    for (const listener of authApi.listeners) listener(event, session);
  });
}

const transitions: Array<{ name: string; run: () => Promise<void>; expectedStatus: string }> = [
  {
    name: "sign-out",
    run: async () => {
      await act(async () => {
        screen.getByRole("button", { name: "Sign out" }).click();
      });
    },
    expectedStatus: "signed_out",
  },
  {
    name: "session expiry",
    run: async () => {
      await act(async () => {
        screen.getByRole("button", { name: "Expire session" }).click();
      });
    },
    expectedStatus: "expired",
  },
  {
    name: "a different user signing in to the same tab",
    run: async () => {
      await emitAuthStateChange("SIGNED_IN", USER_B_SESSION);
    },
    expectedStatus: "authenticated",
  },
];

// Patient A's physiology: exactly what the medication surfaces would evaluate
// clinician B's prescribing alerts against if it survived the transition.
const PATIENT_A_PROFILE = {
  ...EMPTY_PATIENT_PROFILE,
  ageYears: 82,
  egfr: 22,
  qtc: 495,
  pregnant: false,
  allergies: ["penicillin" as const],
  medications: ["lithium", "sertraline"],
};

describe("account transitions clear the patient physiology profile (M4)", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    authApi.listeners.clear();
    authApi.signOut.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sjrfecxgysukkwxsowpy.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_account_transition_key_123456");
    vi.stubEnv("SUPABASE_PROJECT_REF", "sjrfecxgysukkwxsowpy");
    vi.stubEnv("SUPABASE_PROJECT_NAME", "PsychSift Production");
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.unstubAllEnvs();
  });

  it("falls back to a local sign-out when the global sign-out throws, so a reload stays signed out", async () => {
    await mountAuthenticated();
    authApi.signOut.mockRejectedValueOnce(new Error("lock timeout"));
    await act(async () => {
      screen.getByRole("button", { name: "Sign out" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed_out"));
    expect(authApi.signOut).toHaveBeenCalledTimes(2);
    expect(authApi.signOut).toHaveBeenLastCalledWith({ scope: "local" });
  });

  for (const transition of transitions) {
    it(`removes the stored profile and notifies subscribers on ${transition.name}`, async () => {
      await mountAuthenticated();
      writePatientProfile(PATIENT_A_PROFILE);
      expect(getPatientProfileSnapshot()).toMatchObject({
        ageYears: 82,
        egfr: 22,
        medications: ["lithium", "sertraline"],
      });

      const onChange = vi.fn();
      const unsubscribe = subscribePatientProfile(onChange);
      try {
        await transition.run();
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent(transition.expectedStatus));

        expect(window.sessionStorage.getItem(PATIENT_PROFILE_STORAGE_KEY)).toBeNull();
        // Subscribers cache the parsed snapshot by raw string; the clear must go
        // through the store's own change event so mounted medication surfaces
        // re-read an empty profile instead of keeping patient A's alerts.
        expect(onChange).toHaveBeenCalled();
        expect(getPatientProfileSnapshot()).toEqual(EMPTY_PATIENT_PROFILE);
      } finally {
        unsubscribe();
      }
    });
  }
});

describe("account transitions clear favourites pins and last-opened keys (L2)", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    resetFavouritesStorageForTesting();
    authApi.listeners.clear();
    authApi.signOut.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sjrfecxgysukkwxsowpy.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_account_transition_key_123456");
    vi.stubEnv("SUPABASE_PROJECT_REF", "sjrfecxgysukkwxsowpy");
    vi.stubEnv("SUPABASE_PROJECT_NAME", "PsychSift Production");
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    resetFavouritesStorageForTesting();
    vi.unstubAllEnvs();
  });

  for (const transition of transitions) {
    it(`removes the unscoped localStorage keys and their caches on ${transition.name}`, async () => {
      await mountAuthenticated();
      // Which guideline/registry items clinician A opened, and when, plus A's pins.
      recordFavouriteOpened("lithium-monitoring-guideline", 1_700_000_000_000);
      toggleFavouritePinnedId("clozapine-initiation");
      expect(window.localStorage.getItem(DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY)).not.toBeNull();
      expect(window.localStorage.getItem(DATABASE_FAVOURITES_PINNED_STORAGE_KEY)).not.toBeNull();

      await transition.run();
      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent(transition.expectedStatus));

      expect(window.localStorage.getItem(DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem(DATABASE_FAVOURITES_PINNED_STORAGE_KEY)).toBeNull();
      expect(loadFavouriteLastOpened()).toEqual({});
      expect(loadFavouritePinnedIds().has("clozapine-initiation")).toBe(false);
    });
  }
});

describe("account transitions clear the legacy Caring Contacts plan-draft key (L6)", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    authApi.listeners.clear();
    authApi.signOut.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sjrfecxgysukkwxsowpy.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_account_transition_key_123456");
    vi.stubEnv("SUPABASE_PROJECT_REF", "sjrfecxgysukkwxsowpy");
    vi.stubEnv("SUPABASE_PROJECT_NAME", "PsychSift Production");
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.unstubAllEnvs();
  });

  for (const transition of transitions) {
    it(`removes the stored draft on ${transition.name}`, async () => {
      await mountAuthenticated();
      // Raw write, as a page load from before the prototype's retirement would
      // have left it. Nothing writes this key any more; it must still be cleared.
      window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ referralId: "SYN-REFERRAL-001" }));
      expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBeNull();

      await transition.run();
      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent(transition.expectedStatus));

      // Synchronous with the transition: the auth provider removes the key itself.
      expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
    });
  }
});

// The auth provider lives in src/lib, which must never import a component
// module (tests/lib-layering.test.ts). So the raw keys are removed by a lib
// seam that names them directly, and the component stores learn about it
// through one window event. Two things follow, and both are pinned here:
// the keys are gone whether or not the owning component module has been
// loaded in this page (after a full navigation the owning module may not be
// loaded, but its storage key still is), and the removal happens
// BEFORE any subscriber runs, so a store can never re-read the old value.
describe("the lib-side account-transition seam", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetFavouritesStorageForTesting();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetFavouritesStorageForTesting();
  });

  it("removes every account-scoped key itself, before the transition event reaches any subscriber", () => {
    // Raw writes, as a previous page load would have left them — no component
    // store is asked to write, so none is needed to clear.
    window.localStorage.setItem(DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY, JSON.stringify({ x: 1 }));
    window.localStorage.setItem(DATABASE_FAVOURITES_PINNED_STORAGE_KEY, JSON.stringify(["x"]));
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ referralId: "SYN-REFERRAL-001" }));

    const seenAtEvent: Array<string | null> = [];
    const unsubscribe = subscribeAccountTransition(() => {
      seenAtEvent.push(
        window.localStorage.getItem(DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY),
        window.localStorage.getItem(DATABASE_FAVOURITES_PINNED_STORAGE_KEY),
        window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY),
      );
    });
    try {
      clearAccountScopedBrowserStorage();
    } finally {
      unsubscribe();
    }

    expect(seenAtEvent).toEqual([null, null, null]);
  });

  it("dispatches exactly one window event per clear, and unsubscribing stops delivery", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAccountTransition(listener);
    clearAccountScopedBrowserStorage();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBeInstanceOf(Event);
    expect((listener.mock.calls[0]?.[0] as Event).type).toBe(ACCOUNT_TRANSITION_EVENT);

    unsubscribe();
    clearAccountScopedBrowserStorage();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("makes the component store drop its memoised caches and notify, without lib importing it", () => {
    // Fill the component cache through its own API, then clear through the
    // lib seam only — the component module must react to the event, because the
    // auth provider can no longer call it directly.
    recordFavouriteOpened("lithium-monitoring-guideline", 1_700_000_000_000);
    toggleFavouritePinnedId("clozapine-initiation");

    const favouritesChanged = vi.fn();
    const unsubscribeFavourites = subscribeFavouritesStorage(favouritesChanged);
    try {
      clearAccountScopedBrowserStorage();
    } finally {
      unsubscribeFavourites();
    }

    expect(favouritesChanged).toHaveBeenCalledTimes(1);
    expect(loadFavouriteLastOpened()).toEqual({});
    expect(loadFavouritePinnedIds().has("clozapine-initiation")).toBe(false);
  });

  it("is the only route the auth provider takes: src/lib never imports a component store", () => {
    // The layering gate proves this repository-wide; this pins the one file the
    // audit fixes touched so a future 'quick' direct import fails here, beside
    // the behaviour it would break, rather than only in tests/lib-layering.
    const source = readFileSync(path.resolve("src/lib/supabase/client.tsx"), "utf8");
    expect(/(?:from\s+|import\s*\()\s*["']@\/components\//.test(source)).toBe(false);
    const seam = readFileSync(path.resolve("src/lib/account-scoped-browser-state.ts"), "utf8");
    expect(/(?:from\s+|import\s*\()\s*["']@\/components\//.test(seam)).toBe(false);
    for (const key of [
      DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY,
      DATABASE_FAVOURITES_PINNED_STORAGE_KEY,
      PLAN_DRAFT_STORAGE_KEY,
    ]) {
      expect(seam, `the lib seam must name ${key} literally, so it clears without the component loaded`).toContain(
        `"${key}"`,
      );
    }
  });
});

// A page reload is not an account transition. @supabase/auth-js emits SIGNED_IN
// for a valid *stored* session while it recovers it during boot, and flushes
// that queued event to every subscriber as soon as `initialize()` settles —
// which is before `initializeSession`'s `getUser()` round-trip returns, so the
// ref holding the last published user id is still null. Reading that as
// "null -> user-a", i.e. an account switch, wipes exactly the stores whose
// contract is to survive a refresh: the patient profile, the favourites keys
// and the legacy plan-draft key. Whether it happened at all depended on when
// React registered the listener, so the loss was intermittent. These cases pin
// the boot replay as harmless and a real switch straight after it as still
// clearing everything.
describe("the boot-time SIGNED_IN replay is not an account transition (M4, L2, L6)", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetFavouritesStorageForTesting();
    authApi.listeners.clear();
    authApi.signOut.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sjrfecxgysukkwxsowpy.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_account_transition_key_123456");
    vi.stubEnv("SUPABASE_PROJECT_REF", "sjrfecxgysukkwxsowpy");
    vi.stubEnv("SUPABASE_PROJECT_NAME", "PsychSift Production");
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetFavouritesStorageForTesting();
    vi.unstubAllEnvs();
  });

  /** What the tab held before the reload: clinician A's own work, all three stores. */
  function seedEveryRefreshSurvivingStore() {
    writePatientProfile(PATIENT_A_PROFILE);
    recordFavouriteOpened("lithium-monitoring-guideline", 1_700_000_000_000);
    toggleFavouritePinnedId("clozapine-initiation");
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify({ referralId: "SYN-REFERRAL-001" }));
    expect(window.sessionStorage.getItem(PATIENT_PROFILE_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(DATABASE_FAVOURITES_PINNED_STORAGE_KEY)).not.toBeNull();
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBeNull();
  }

  function expectEveryRefreshSurvivingStoreIntact() {
    expect(getPatientProfileSnapshot()).toMatchObject({ ageYears: 82, egfr: 22 });
    expect(loadFavouriteLastOpened()).toHaveProperty("lithium-monitoring-guideline");
    expect(loadFavouritePinnedIds().has("clozapine-initiation")).toBe(true);
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBeNull();
  }

  function expectEveryRefreshSurvivingStoreCleared() {
    expect(window.sessionStorage.getItem(PATIENT_PROFILE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DATABASE_FAVOURITES_PINNED_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
  }

  /**
   * Boot the provider the way auth-js does on a reload of a signed-in tab: the
   * stored-session SIGNED_IN reaches the subscriber the moment it subscribes,
   * while `getUser()` is still in flight. Returns the release for that fetch.
   */
  function mountWithBootReplay(): { releaseVerification: () => void } {
    let releaseVerification = () => undefined as void;
    const verified = new Promise<void>((resolve) => {
      releaseVerification = () => resolve();
    });
    authApi.getUser.mockImplementationOnce(async () => {
      await verified;
      return { data: { user: authApi.session.user }, error: null };
    });
    authApi.onAuthStateChange.mockImplementationOnce((cb: (event: string, session: unknown) => void) => {
      authApi.listeners.add(cb);
      cb("SIGNED_IN", authApi.session);
      return { data: { subscription: { unsubscribe: () => authApi.listeners.delete(cb) } } };
    });

    render(
      <AuthProvider>
        <AuthActions />
      </AuthProvider>,
    );
    return { releaseVerification };
  }

  it("keeps the patient profile, favourites keys and plan draft across a reload of a signed-in tab", async () => {
    seedEveryRefreshSurvivingStore();

    const { releaseVerification } = mountWithBootReplay();

    // The replay has already published the stored session, and verification has
    // not returned yet — this is the exact window the clear used to fire in.
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expectEveryRefreshSurvivingStoreIntact();

    await act(async () => {
      releaseVerification();
    });

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expectEveryRefreshSurvivingStoreIntact();
  });

  it("still clears everything when a different user signs in after that replay", async () => {
    seedEveryRefreshSurvivingStore();

    const { releaseVerification } = mountWithBootReplay();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    await act(async () => {
      releaseVerification();
    });

    await emitAuthStateChange("SIGNED_IN", USER_B_SESSION);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    expectEveryRefreshSurvivingStoreCleared();
    expect(getPatientProfileSnapshot()).toEqual(EMPTY_PATIENT_PROFILE);
    expect(loadFavouriteLastOpened()).toEqual({});
    expect(loadFavouritePinnedIds().has("clozapine-initiation")).toBe(false);
  });

  // The gate is "has the initial state been decided yet", not "did verification
  // succeed". A boot that could not be verified publishes nothing, so the ref
  // holding the last published user id stays null — and the next SIGNED_IN must
  // still clear, exactly as it did before the gate existed. Without this the
  // gate would open a leak path on the error branch.
  it("forgets MHA clocks when the auth server rejects the stored session on boot", async () => {
    window.localStorage.setItem(
      PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY,
      JSON.stringify({ v: 1, clocks: [{ id: "abcdefgh-1", formCode: "2", madeAt: 1 }] }),
    );
    authApi.getUser.mockImplementationOnce(
      async () =>
        ({
          data: { user: null },
          error: { status: 401, message: "invalid JWT" },
        }) as unknown as Awaited<ReturnType<typeof authApi.getUser>>,
    );

    render(
      <AuthProvider>
        <AuthActions />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed_out"));

    expect(window.localStorage.getItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY)).toBeNull();
  });

  it("still clears when the boot could not be verified and someone then signs in", async () => {
    seedEveryRefreshSurvivingStore();

    // Indeterminate (not a definitive rejection, not a retryable fetch failure):
    // `shouldFailInitialAuthVerification` takes the early-return error branch.
    authApi.getUser.mockImplementationOnce(
      async () =>
        ({
          data: { user: null },
          error: { status: 500, message: "internal server error" },
        }) as unknown as Awaited<ReturnType<typeof authApi.getUser>>,
    );

    render(
      <AuthProvider>
        <AuthActions />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expectEveryRefreshSurvivingStoreIntact();

    await emitAuthStateChange("SIGNED_IN", USER_B_SESSION);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    expectEveryRefreshSurvivingStoreCleared();
  });
});

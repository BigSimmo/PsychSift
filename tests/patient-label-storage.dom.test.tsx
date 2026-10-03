/** @vitest-environment jsdom */

// Patient labels (bed numbers, initials) live only on the device and expire at
// the end of the shift as well as at sign-out. These tests pin three things:
// the wipe removes every patient label and nothing else; it fails closed when
// the expiry stamp is missing, damaged or contradicted by the clock; and the
// auth provider runs it at every account transition and on every page.

import { readFileSync, readdirSync } from "node:fs";
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
  CME_NEW_ENTRY_DRAFT_KEY,
  DATABASE_FAVOURITES_PINNED_STORAGE_KEY,
  DOCTOR_CREDENTIALS_STORAGE_KEY,
} from "@/lib/account-scoped-browser-state";
import { ON_CALL_DEVICE_STATE_KEYS } from "@/lib/on-call/device-state-keys";
import {
  PATIENT_LABEL_EXPIRY_STORAGE_KEY,
  PATIENT_LABEL_FALLBACK_LIFETIME_MS,
  PATIENT_LABEL_KEY_PREFIX,
  PATIENT_LABEL_MAX_LIFETIME_MS,
  PATIENT_LABEL_WATCH_INTERVAL_MS,
  clearExpiredPatientLabels,
  clearPatientLabels,
  patientLabelStorageKey,
  patientLabelsExpireAt,
  readPatientLabels,
  removePatientLabels,
  subscribePatientLabelsCleared,
  watchPatientLabelExpiry,
  writePatientLabels,
} from "@/lib/patient-label-storage";
import { PATIENT_PROFILE_STORAGE_KEY } from "@/lib/patient-profile-storage";
import { AuthProvider, useAuthSession } from "@/lib/supabase/client";

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 3, 0, 0, 0); // 08:00 Perth

// Keys other stores own, some deliberately close to the prefix. The wipe must
// leave every one of them alone.
const UNRELATED_LOCAL_KEYS = [
  DATABASE_FAVOURITES_PINNED_STORAGE_KEY,
  DOCTOR_CREDENTIALS_STORAGE_KEY,
  ...ON_CALL_DEVICE_STATE_KEYS,
  "psychsift:patient-labels", // no trailing colon
  "psychsift:patient-label:timers", // singular
  "psychsift:admin:doctor-credentials-extra",
  "x-psychsift:patient-labels:timers", // prefix not at the start
];
const UNRELATED_SESSION_KEYS = [CME_NEW_ENTRY_DRAFT_KEY, PATIENT_PROFILE_STORAGE_KEY, "psychsift:patient-labels"];

function seedUnrelated() {
  for (const key of UNRELATED_LOCAL_KEYS) window.localStorage.setItem(key, "keep");
  for (const key of UNRELATED_SESSION_KEYS) window.sessionStorage.setItem(key, "keep");
}

function expectUnrelatedIntact() {
  for (const key of UNRELATED_LOCAL_KEYS) expect(window.localStorage.getItem(key), key).toBe("keep");
  for (const key of UNRELATED_SESSION_KEYS) expect(window.sessionStorage.getItem(key), key).toBe("keep");
}

function labelKeyCount() {
  let count = 0;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < storage.length; i++) {
      if (storage.key(i)?.startsWith(PATIENT_LABEL_KEY_PREFIX)) count++;
    }
  }
  return count;
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("patient label keys", () => {
  it("are namespaced, and reject names that could escape the namespace", () => {
    expect(patientLabelStorageKey("mha-timers")).toBe("psychsift:patient-labels:mha-timers");
    for (const bad of ["", "../x", "Timers", "a:b", "__shift-expiry", "-x", "a".repeat(65)]) {
      expect(() => patientLabelStorageKey(bad), bad).toThrow();
    }
  });

  it("are not used by any other store the app already clears", () => {
    for (const key of [
      DATABASE_FAVOURITES_PINNED_STORAGE_KEY,
      DOCTOR_CREDENTIALS_STORAGE_KEY,
      CME_NEW_ENTRY_DRAFT_KEY,
      PATIENT_PROFILE_STORAGE_KEY,
      ...ON_CALL_DEVICE_STATE_KEYS,
    ]) {
      expect(key.startsWith(PATIENT_LABEL_KEY_PREFIX), key).toBe(false);
    }
  });

  it("are written only by this module: no other source file spells the prefix", () => {
    // A store that built the key by hand would bypass the expiry stamp.
    const root = path.join(__dirname, "..", "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith(path.join("lib", "patient-label-storage.ts"))) {
          if (readFileSync(full, "utf8").includes("psychsift:patient-labels")) offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("writing and reading labels", () => {
  it("round-trips in either storage area and stamps a fallback expiry on first write", () => {
    expect(writePatientLabels("timers", '["Bed 4"]', { now: T0 })).toBe(true);
    expect(writePatientLabels("call-notes", '["JS"]', { area: "session", now: T0 + HOUR })).toBe(true);
    expect(readPatientLabels("timers", { now: T0 + HOUR })).toBe('["Bed 4"]');
    expect(readPatientLabels("call-notes", { area: "session", now: T0 + HOUR })).toBe('["JS"]');
    // The stamp starts at the FIRST label of the shift, not the latest.
    expect(patientLabelsExpireAt(T0 + HOUR)).toBe(T0 + PATIENT_LABEL_FALLBACK_LIFETIME_MS);
  });

  it("uses the rostered shift end when given one", () => {
    writePatientLabels("timers", "x", { now: T0, shiftEndsAt: new Date(T0 + 10 * HOUR) });
    expect(patientLabelsExpireAt(T0)).toBe(T0 + 10 * HOUR);
  });

  it("lets a later roster end bring the wipe forward but never push it back", () => {
    writePatientLabels("timers", "x", { now: T0 });
    writePatientLabels("timers", "y", { now: T0 + HOUR, shiftEndsAt: T0 + 20 * HOUR });
    expect(patientLabelsExpireAt(T0 + HOUR)).toBe(T0 + PATIENT_LABEL_FALLBACK_LIFETIME_MS);
    writePatientLabels("timers", "z", { now: T0 + 2 * HOUR, shiftEndsAt: new Date(T0 + 9 * HOUR).toISOString() });
    expect(patientLabelsExpireAt(T0 + 2 * HOUR)).toBe(T0 + 9 * HOUR);
  });

  it("ignores a roster end too far away or unreadable", () => {
    for (const shiftEndsAt of [T0 + PATIENT_LABEL_MAX_LIFETIME_MS + HOUR, "not a date"]) {
      window.localStorage.clear();
      writePatientLabels("timers", "x", { now: T0, shiftEndsAt });
      expect(patientLabelsExpireAt(T0)).toBe(T0 + PATIENT_LABEL_FALLBACK_LIFETIME_MS);
    }
  });

  it("refuses a write once the rostered shift it names has ended, rather than starting a fresh stamp", () => {
    for (const shiftEndsAt of [T0, T0 - HOUR]) {
      window.localStorage.clear();
      expect(writePatientLabels("timers", "Bed 4", { now: T0, shiftEndsAt })).toBe(false);
      expect(labelKeyCount()).toBe(0);
    }
  });

  it("returns nothing for an expired label even before any watcher has run", () => {
    writePatientLabels("timers", "Bed 4", { now: T0 });
    expect(readPatientLabels("timers", { now: T0 + PATIENT_LABEL_FALLBACK_LIFETIME_MS })).toBeNull();
    expect(labelKeyCount()).toBe(0);
  });

  it("starts a fresh shift after the last one expired, without carrying old labels over", () => {
    writePatientLabels("timers", "old", { now: T0 });
    writePatientLabels("call-notes", "new", { now: T0 + 13 * HOUR });
    expect(readPatientLabels("timers", { now: T0 + 13 * HOUR })).toBeNull();
    expect(readPatientLabels("call-notes", { now: T0 + 13 * HOUR })).toBe("new");
    expect(patientLabelsExpireAt(T0 + 13 * HOUR)).toBe(T0 + 13 * HOUR + PATIENT_LABEL_FALLBACK_LIFETIME_MS);
  });

  it("stores nothing when the expiry stamp cannot be written", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(writePatientLabels("timers", "Bed 4", { now: T0 })).toBe(false);
    } finally {
      setItem.mockRestore();
    }
    expect(labelKeyCount()).toBe(0);
  });

  it("removes a single store on request", () => {
    writePatientLabels("timers", "x", { now: T0 });
    writePatientLabels("call-notes", "y", { now: T0 });
    removePatientLabels("timers");
    expect(readPatientLabels("timers", { now: T0 })).toBeNull();
    expect(readPatientLabels("call-notes", { now: T0 })).toBe("y");
  });
});

describe("the wipe removes patient labels and nothing else", () => {
  it("clears every label in both storage areas, keeps every other key, and tells subscribers", () => {
    seedUnrelated();
    writePatientLabels("timers", "Bed 4", { now: T0 });
    writePatientLabels("handover-draft", "JS bed 12", { area: "session", now: T0 });
    const onCleared = vi.fn();
    const unsubscribe = subscribePatientLabelsCleared(onCleared);
    try {
      clearPatientLabels("manual");
    } finally {
      unsubscribe();
    }
    expect(labelKeyCount()).toBe(0);
    expectUnrelatedIntact();
    expect(onCleared).toHaveBeenCalledTimes(1);
    expect((onCleared.mock.calls[0]![0] as CustomEvent).detail).toEqual({ reason: "manual" });
  });

  it("does nothing before the shift ends, then wipes at the end", () => {
    seedUnrelated();
    writePatientLabels("timers", "Bed 4", { now: T0, shiftEndsAt: T0 + 8 * HOUR });
    expect(clearExpiredPatientLabels(T0 + 8 * HOUR - 1)).toBe(false);
    expect(labelKeyCount()).toBe(2); // the label and its stamp
    expect(clearExpiredPatientLabels(T0 + 8 * HOUR)).toBe(true);
    expect(labelKeyCount()).toBe(0);
    expectUnrelatedIntact();
  });

  it("has nothing to do when no labels are stored", () => {
    seedUnrelated();
    const onCleared = vi.fn();
    const unsubscribe = subscribePatientLabelsCleared(onCleared);
    try {
      expect(clearExpiredPatientLabels(T0)).toBe(false);
    } finally {
      unsubscribe();
    }
    expect(onCleared).not.toHaveBeenCalled();
    expectUnrelatedIntact();
  });
});

describe("the wipe fails closed", () => {
  const cases: Array<{ name: string; stamp: string | null; now?: number }> = [
    { name: "labels with no stamp (another tab already wiped)", stamp: null },
    { name: "an unreadable stamp", stamp: "{not json" },
    { name: "a stamp of the wrong shape", stamp: JSON.stringify({ v: 2, startedAt: T0, expiresAt: T0 + HOUR }) },
    {
      name: "a stamp claiming more than the maximum lifetime",
      stamp: JSON.stringify({ v: 1, startedAt: T0, expiresAt: T0 + PATIENT_LABEL_MAX_LIFETIME_MS + 1 }),
    },
    {
      name: "a clock that has gone backwards",
      stamp: JSON.stringify({ v: 1, startedAt: T0, expiresAt: T0 + HOUR }),
      now: T0 - HOUR,
    },
  ];
  for (const testCase of cases) {
    it(`wipes on ${testCase.name}`, () => {
      seedUnrelated();
      window.sessionStorage.setItem(patientLabelStorageKey("call-notes"), "JS");
      if (testCase.stamp !== null) window.localStorage.setItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY, testCase.stamp);
      expect(readPatientLabels("call-notes", { area: "session", now: testCase.now ?? T0 })).toBeNull();
      expect(labelKeyCount()).toBe(0);
      expectUnrelatedIntact();
    });
  }
});

describe("the watcher", () => {
  it("wipes at the end of the shift on its interval, and on focus and visibility", () => {
    vi.useFakeTimers({ now: T0 });
    writePatientLabels("timers", "Bed 4", { shiftEndsAt: T0 + 2 * HOUR });
    const stop = watchPatientLabelExpiry();
    try {
      vi.advanceTimersByTime(2 * HOUR - PATIENT_LABEL_WATCH_INTERVAL_MS);
      expect(labelKeyCount()).toBe(2);
      vi.advanceTimersByTime(PATIENT_LABEL_WATCH_INTERVAL_MS);
      expect(labelKeyCount()).toBe(0);

      // A laptop asleep through the end of the shift: the wipe runs on wake.
      writePatientLabels("timers", "Bed 7", { shiftEndsAt: Date.now() + HOUR });
      vi.setSystemTime(Date.now() + 2 * HOUR);
      window.dispatchEvent(new Event("focus"));
      expect(labelKeyCount()).toBe(0);
    } finally {
      stop();
    }
  });

  it("wipes this tab's session labels when another tab removes the stamp", () => {
    writePatientLabels("call-notes", "JS", { area: "session", now: Date.now() });
    const stop = watchPatientLabelExpiry();
    try {
      window.localStorage.removeItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: PATIENT_LABEL_EXPIRY_STORAGE_KEY }));
      expect(labelKeyCount()).toBe(0);
    } finally {
      stop();
    }
  });

  it("wipes on mount when the page opens after the shift ended", () => {
    writePatientLabels("timers", "Bed 4", { now: Date.now() - 13 * HOUR });
    const stop = watchPatientLabelExpiry();
    stop();
    expect(labelKeyCount()).toBe(0);
  });
});

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

describe("the auth provider", () => {
  beforeEach(() => {
    authApi.listeners.clear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sjrfecxgysukkwxsowpy.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_account_transition_key_123456");
    vi.stubEnv("SUPABASE_PROJECT_REF", "sjrfecxgysukkwxsowpy");
    vi.stubEnv("SUPABASE_PROJECT_NAME", "PsychSift Production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function mountAuthenticated() {
    render(
      <AuthProvider>
        <AuthActions />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
  }

  const transitions: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: "sign-out",
      run: async () => {
        await act(async () => screen.getByRole("button", { name: "Sign out" }).click());
      },
    },
    {
      name: "session expiry",
      run: async () => {
        await act(async () => screen.getByRole("button", { name: "Expire session" }).click());
      },
    },
    {
      name: "a different user signing in to the same tab",
      run: async () => {
        await act(async () => {
          for (const listener of authApi.listeners) {
            listener("SIGNED_IN", { ...authApi.session, user: { id: "user-b" } });
          }
        });
      },
    },
  ];

  for (const transition of transitions) {
    it(`clears patient labels on ${transition.name}`, async () => {
      await mountAuthenticated();
      writePatientLabels("timers", "Bed 4");
      writePatientLabels("call-notes", "JS", { area: "session" });
      const onCleared = vi.fn();
      const unsubscribe = subscribePatientLabelsCleared(onCleared);
      try {
        await transition.run();
        await waitFor(() => expect(labelKeyCount()).toBe(0));
      } finally {
        unsubscribe();
      }
      expect(
        onCleared.mock.calls.some(([event]) => (event as CustomEvent).detail.reason === "account-transition"),
      ).toBe(true);
    });
  }

  it("clears patient labels when boot rejects a stored session, and keeps them for a plain guest boot", async () => {
    const reject = () => {
      authApi.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: Object.assign(new Error("invalid JWT"), { status: 401, name: "AuthApiError" }),
      } as never);
    };
    writePatientLabels("timers", "Bed 4");
    reject();
    render(
      <AuthProvider>
        <AuthActions />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).not.toHaveTextContent("loading"));
    expect(screen.getByTestId("status")).not.toHaveTextContent("authenticated");
    expect(labelKeyCount()).toBe(0);

    cleanup();
    writePatientLabels("timers", "Bed 4");
    authApi.getUser.mockResolvedValueOnce({ data: { user: null }, error: null } as never);
    authApi.getSession.mockResolvedValueOnce({ data: { session: null }, error: null } as never);
    render(
      <AuthProvider>
        <AuthActions />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed_out"));
    expect(readPatientLabels("timers")).toBe("Bed 4");
  });

  it("runs the end-of-shift watcher on mount, signed in or not", async () => {
    writePatientLabels("timers", "Bed 4", { now: Date.now() - 13 * HOUR });
    await mountAuthenticated();
    expect(labelKeyCount()).toBe(0);
  });

  it("imports the label store, which stays import-free so every page's bundle is unaffected", () => {
    const source = readFileSync(path.join(__dirname, "..", "src", "lib", "patient-label-storage.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    const provider = readFileSync(path.join(__dirname, "..", "src", "lib", "supabase", "client.tsx"), "utf8");
    expect(provider).toContain('clearPatientLabels("account-transition")');
    expect(provider).toContain("watchPatientLabelExpiry()");
  });
});

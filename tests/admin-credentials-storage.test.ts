import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CREDENTIALS_STORAGE_KEY,
  DEFAULT_CREDENTIALS,
  loadDoctorCredentials,
  saveDoctorCredentials,
} from "@/lib/admin/credentials-storage";

const CREDS = { ...DEFAULT_CREDENTIALS, ahpraNumber: "MED0000000000" };

function stubWindow(localStorage: unknown) {
  vi.stubGlobal("window", { localStorage });
}

function blockedGetterWindow() {
  const win = {};
  Object.defineProperty(win, "localStorage", {
    get() {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  vi.stubGlobal("window", win);
}

afterEach(() => vi.unstubAllGlobals());

describe("doctor credentials storage", () => {
  it("round-trips through storage", () => {
    const data = new Map<string, string>();
    stubWindow({ getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    expect(saveDoctorCredentials(CREDS)).toBe(true);
    expect(data.has(CREDENTIALS_STORAGE_KEY)).toBe(true);
    expect(loadDoctorCredentials().ahpraNumber).toBe("MED0000000000");
  });

  it("ignores a removed radiation licence value and ships no hard-coded sites", () => {
    stubWindow({
      getItem: () => JSON.stringify({ ahpraNumber: "MED1", radiationLicense: "RL-9", providerNumbers: [] }),
      setItem: () => undefined,
    });
    const loaded = loadDoctorCredentials();
    expect(loaded.ahpraNumber).toBe("MED1");
    expect("radiationLicense" in loaded).toBe(false);
    expect(DEFAULT_CREDENTIALS.providerNumbers).toEqual([]);
  });

  it("drops untouched legacy default site rows on load but keeps rows with a number", () => {
    stubWindow({
      getItem: () =>
        JSON.stringify({
          providerNumbers: [
            { id: "p1", site: "Royal Perth Hospital", number: "" },
            { id: "p2", site: "Sir Charles Gairdner", number: "123456AB" },
            { id: "x1", site: "My clinic", number: "" },
          ],
        }),
      setItem: () => undefined,
    });
    expect(loadDoctorCredentials().providerNumbers.map((row) => row.id)).toEqual(["p2", "x1"]);
  });

  it("falls back when the localStorage getter throws", () => {
    blockedGetterWindow();
    expect(loadDoctorCredentials()).toEqual(DEFAULT_CREDENTIALS);
    expect(saveDoctorCredentials(CREDS)).toBe(false);
  });

  it("falls back when getItem or setItem throws", () => {
    stubWindow({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(loadDoctorCredentials()).toEqual(DEFAULT_CREDENTIALS);
    expect(saveDoctorCredentials(CREDS)).toBe(false);
  });

  it("falls back on malformed JSON, missing storage, and no window", () => {
    stubWindow({ getItem: () => "{not json", setItem: () => undefined });
    expect(loadDoctorCredentials()).toEqual(DEFAULT_CREDENTIALS);
    stubWindow(undefined);
    expect(loadDoctorCredentials()).toEqual(DEFAULT_CREDENTIALS);
    expect(saveDoctorCredentials(CREDS)).toBe(false);
    vi.unstubAllGlobals();
    expect(loadDoctorCredentials()).toEqual(DEFAULT_CREDENTIALS);
    expect(saveDoctorCredentials(CREDS)).toBe(false);
  });
});

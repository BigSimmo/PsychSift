"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAccountRequestScope } from "@/components/use-account-request-scope";

import type { CodeMeaning } from "@/lib/roster/import/grid";

/**
 * Roster's remembered settings: which row of a printed roster is you, what
 * each workplace's codes mean, and whether shifts go on the calendar link.
 *
 * They live on the server only (`/api/roster/settings`, stored under
 * `user_preferences.preferences.roster`) and are held here in React state, never
 * in `AppPreferences` or any device storage: `useAppPreferences` copies its
 * whole object into localStorage, and a roster row name is a person's name.
 *
 * The shape is written out here rather than imported from the server module,
 * so these screens never pull server code into the client bundle.
 */
export type RosterSettings = {
  readonly calendarShifts: boolean;
  readonly alerts: { readonly changes: boolean; readonly requests: boolean };
  readonly rowName: string | null;
  /** Workplace ("" for none) to code to meaning. */
  readonly codes: Readonly<Record<string, Readonly<Record<string, CodeMeaning>>>>;
};

export type RosterSettingsStatus = "loading" | "ready" | "signed-out" | "error";

/**
 * A change to send. `codes` names only the workplaces it changes, and the
 * server merges it into what is stored: null removes a workplace's codes.
 */
export type RosterSettingsPatch = Partial<Omit<RosterSettings, "codes">> & {
  readonly codes?: Readonly<Record<string, Readonly<Record<string, CodeMeaning>> | null>>;
};

/** The same per-workplace merge the server does, so the screen shows the change at once. */
export function applyRosterSettingsPatch(settings: RosterSettings, patch: RosterSettingsPatch): RosterSettings {
  const { codes: codesPatch, ...rest } = patch;
  const codes: Record<string, Readonly<Record<string, CodeMeaning>>> = { ...settings.codes };
  for (const [workplace, meaning] of Object.entries(codesPatch ?? {})) {
    if (meaning === null) delete codes[workplace];
    else codes[workplace] = meaning;
  }
  return { ...settings, ...rest, codes };
}

export type RosterSettingsState = {
  readonly status: RosterSettingsStatus;
  readonly settings: RosterSettings;
  /** Change some settings. Shows the change at once; resolves to an error sentence, or null. */
  readonly update: (patch: RosterSettingsPatch) => Promise<string | null>;
};

export const EMPTY_ROSTER_SETTINGS: RosterSettings = {
  calendarShifts: false,
  alerts: { changes: true, requests: true },
  rowName: null,
  codes: {},
};

const SETTINGS_URL = "/api/roster/settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The settings in a response, whether it is `{ settings }` or the settings object itself. */
export function readRosterSettings(payload: unknown): RosterSettings | null {
  const source = isRecord(payload) && isRecord(payload.settings) ? payload.settings : payload;
  if (!isRecord(source)) return null;
  if (!("calendarShifts" in source) && !("rowName" in source) && !("codes" in source)) return null;
  return {
    calendarShifts: source.calendarShifts === true,
    alerts: isRecord(source.alerts)
      ? {
          changes: typeof source.alerts.changes === "boolean" ? source.alerts.changes : true,
          requests: typeof source.alerts.requests === "boolean" ? source.alerts.requests : true,
        }
      : { changes: true, requests: true },
    rowName: typeof source.rowName === "string" && source.rowName ? source.rowName : null,
    codes: isRecord(source.codes) ? (source.codes as RosterSettings["codes"]) : {},
  };
}

export function useRosterSettings(): RosterSettingsState {
  const { scope, isCurrent } = useAccountRequestScope();
  const [owner, setOwner] = useState(scope);
  const [status, setStatus] = useState<RosterSettingsStatus>("loading");
  const [settings, setSettings] = useState<RosterSettings>(EMPTY_ROSTER_SETTINGS);
  const current = useRef(settings);
  // Same-account writes remain serial; a new account starts an independent queue.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const accept = useCallback((next: RosterSettings) => {
    current.current = next;
    setSettings(next);
  }, []);

  if (owner !== scope) {
    setOwner(scope);
    setSettings(EMPTY_ROSTER_SETTINGS);
    setStatus("loading");
  }
  useLayoutEffect(() => {
    current.current = EMPTY_ROSTER_SETTINGS;
    queue.current = Promise.resolve();
  }, [scope]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(SETTINGS_URL, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted || !isCurrent()) return;
        if (response.status === 401) {
          setStatus("signed-out");
          return;
        }
        if (!response.ok) throw new Error(`status ${response.status}`);
        const saved = readRosterSettings(await response.json().catch(() => null));
        if (controller.signal.aborted || !isCurrent()) return;
        accept(saved ?? EMPTY_ROSTER_SETTINGS);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !isCurrent()) return;
        if ((error as { name?: string })?.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [accept, isCurrent]);

  const write = useCallback(
    async (patch: RosterSettingsPatch) => {
      if (!isCurrent()) return null;
      const before = current.current;
      accept(applyRosterSettingsPatch(before, patch));
      try {
        const response = await fetch(SETTINGS_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!isCurrent()) return null;
        if (!response.ok) {
          accept(before);
          return response.status === 401 ? "Sign in to change Roster settings." : "That setting could not be saved.";
        }
        const saved = readRosterSettings(await response.json().catch(() => null));
        if (!isCurrent()) return null;
        if (saved) accept(saved);
        return null;
      } catch {
        if (!isCurrent()) return null;
        accept(before);
        return "That setting could not be saved. Check your connection and try again.";
      }
    },
    [accept, isCurrent],
  );

  const update = useCallback(
    (patch: RosterSettingsPatch) => {
      if (!isCurrent()) return Promise.resolve(null);
      const next = queue.current.then(() => write(patch));
      queue.current = next.catch(() => undefined);
      return next;
    },
    [write, isCurrent],
  );

  return { status, settings, update };
}

"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  readAppPreferences,
  subscribeAppPreferences,
  useAppPreferences,
} from "@/components/clinical-dashboard/use-app-preferences";
import {
  DEFAULT_WORK_TIME_ZONE,
  WORK_TIME_ZONES,
  deviceTimeZone,
  isWorkTimeZone,
  type WorkTimeZoneOption,
} from "@/lib/work-time/zones";

/**
 * The work time zone for any screen: read from the cached account preferences,
 * so it costs no request and works offline. Use `zonedDateOf`, `zonedTimeOf`
 * and the rest of `@/lib/work-time/format` with `zone`; never the device clock.
 */
export type WorkTimeZone = {
  readonly zone: string;
  readonly zones: readonly WorkTimeZoneOption[];
  /** The phone's own zone, or null before hydration and where the browser will not say. */
  readonly deviceZone: string | null;
  /**
   * True when the phone is on a different wall clock from the work zone now
   * (Sydney versus Perth, not Melbourne versus Sydney), so screens can name the
   * zone beside times. False until hydrated, so server and client agree.
   */
  readonly differsFromDevice: boolean;
};

function zoneSnapshot(): string {
  const zone = readAppPreferences().timeZone;
  return isWorkTimeZone(zone) ? zone : DEFAULT_WORK_TIME_ZONE;
}

const serverZone = () => DEFAULT_WORK_TIME_ZONE;
const noopSubscribe = () => () => undefined;
const deviceSnapshot = () => deviceTimeZone() ?? "";
const serverDevice = () => "";

/** True when two zones show different wall-clock times at this moment. */
export function zonesDifferNow(a: string, b: string, now: number = Date.now()): boolean {
  if (a === b) return false;
  try {
    const format = (zone: string) =>
      new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
        now,
      );
    return format(a) !== format(b);
  } catch {
    return false;
  }
}

export function useWorkTimeZone(): WorkTimeZone {
  const zone = useSyncExternalStore(subscribeAppPreferences, zoneSnapshot, serverZone);
  const device = useSyncExternalStore(noopSubscribe, deviceSnapshot, serverDevice);
  return useMemo(
    () => ({
      zone,
      zones: WORK_TIME_ZONES,
      deviceZone: device || null,
      differsFromDevice: device ? zonesDifferNow(zone, device) : false,
    }),
    [zone, device],
  );
}

/**
 * The same plus `setZone`, which saves to the account. It opens the account
 * preferences sync, so use it only where the zone is changed (Settings, the
 * setup walkthrough), never on every screen.
 */
export function useWorkTimeZoneControl(): WorkTimeZone & {
  readonly setZone: (zone: string) => void;
  readonly syncState: ReturnType<typeof useAppPreferences>["syncState"];
} {
  const base = useWorkTimeZone();
  const { setPreference, syncState } = useAppPreferences();
  return useMemo(
    () => ({
      ...base,
      syncState,
      setZone: (zone: string) => {
        if (isWorkTimeZone(zone)) setPreference("timeZone", zone);
      },
    }),
    [base, setPreference, syncState],
  );
}

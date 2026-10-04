"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  onCallDeviceStateChangedEvent,
  onCallHandbookSeenStorageKey,
  onCallHospitalChoiceStorageKey,
  rememberOnCallEditorFlag,
} from "@/lib/on-call/device-state-keys";
import { readOnCallEmergencyPinned, rememberOnCallEmergencyPinned } from "@/lib/on-call/emergency-pin-memory";
import { pinnedEmergencyEntries, publishedHandbookItems, type HandbookItem } from "@/lib/on-call/handbook-items";
import {
  HANDBOOK_REPORT_REASONS,
  hasReportedOnThisDevice,
  rememberReportOnThisDevice,
  type HandbookReportReason,
} from "@/lib/on-call/handbook-reports";
import { demoServiceDetail, demoServiceSummary, sampleServiceDetail } from "@/lib/on-call/service-demo";
import type { ServiceDetail, ServiceSummary } from "@/lib/on-call/service-model";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * The only hospital handbook read a rebuilt On Call page may use.
 *
 * It owns everything that makes the hospital's numbers trustworthy on a shared
 * ward phone: which hospital the reader chose (and saying so, review F3), that
 * only PUBLISHED content is shown (correction C6), that a previous account's
 * hospital vanishes the moment the session changes, that the reader is told
 * when a number they saw before was withdrawn, and that a fault is reported
 * with one of two fixed reasons, once per device.
 *
 * Rules:
 *  - a 401 while the session looks live is `expired`, not signed out;
 *  - an empty service list is `no-service`;
 *  - requests are cancelled by `AbortController`, and an answer is ignored when
 *    the auth epoch, service or site has moved on (the `ServicePage` pattern);
 *  - one read is held for 60 s per `${authEpoch}:${serviceId}:${siteId}`, since
 *    every service call shares one per-user rate-limit bucket (C14). The memo is
 *    dropped on the sign-out wipe and whenever the auth epoch changes;
 *  - the "seen" map stores entry ids and times only, never titles or numbers.
 */

export type HospitalHandbookStatus = "loading" | "signed-out" | "expired" | "no-service" | "ready" | "unavailable";
export type HandbookReportResult = "sent" | "already-reported" | "failed" | "demo";
/** An entry this device saw that the hospital has since withdrawn: an id and when it went, nothing else. */
export type OnCallRemovedEntry = { readonly id: string; readonly goneAt: string };

export const ON_CALL_WITHDRAWN_MESSAGE = "This number was removed. Check with switchboard.";

/** One choosable hospital: a service's site, named in text only (owner Q6). */
export type HospitalHandbookOption = {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly siteId: string | null;
  readonly siteName: string | null;
};

export type HospitalHandbookState = {
  readonly status: HospitalHandbookStatus;
  readonly demo: boolean;
  readonly services: readonly ServiceSummary[];
  readonly serviceId: string | null;
  readonly siteId: string | null;
  /** Text only (owner Q6). */
  readonly serviceName: string | null;
  /** The hospital line: the first line on Now, the subtitle on Call and Find (review F3). */
  readonly siteName: string | null;
  /** Every hospital the reader can change to, for the "Change" control. */
  readonly hospitals: readonly HospitalHandbookOption[];
  /** `service:site`, the key the device memories use for this hospital. */
  readonly hospitalKey: string | null;
  /** Published only. */
  readonly items: readonly HandbookItem[];
  /** Seen before on this device, gone now; kept 24 h. Ids and times only (review B2). */
  readonly removed: readonly OnCallRemovedEntry[];
  /** Whether this hospital pinned an emergency row last time (a yes/no, never the number); null if never loaded. */
  readonly emergencyPinExpected: boolean | null;
  /** "device" only once lane D lands. */
  readonly source: "network" | "device";
  readonly savedAt: string | null;
  readonly hours?: import("@/lib/on-call/now-rows").OnCallHospitalHours | null;
  readonly error: string | null;
  /** Persisted in `onCallHospitalChoiceStorageKey`. */
  choose(serviceId: string, siteId: string | null): void;
  /** The "Change" action on the hospital line; the same as `choose`. */
  changeHospital(serviceId: string, siteId: string | null): void;
  retry(): void;
  report(entryId: string, reason: HandbookReportReason): Promise<HandbookReportResult>;
  hasReported(entryId: string, reason: HandbookReportReason): boolean;
  /**
   * Legacy compatibility callback. Now renders its roster mismatch prompt in
   * HospitalShiftUpdates without persisting a workplace or auto-switching.
   */
  onRosteredSiteMismatch(rosteredSiteName: string): void;
};

const MEMO_MS = 60_000;
const REMOVED_KEEP_MS = 24 * 60 * 60 * 1000;

type Memo<T> = { readonly at: number; readonly value: T };
const servicesMemo = new Map<number, Memo<ServiceSummary[]>>();
const detailMemo = new Map<string, Memo<ServiceDetail>>();
let memoListening = false;
let memoEpoch: number | null = null;

function dropMemo(): void {
  servicesMemo.clear();
  detailMemo.clear();
}

function listenForWipe(): void {
  if (memoListening || typeof window === "undefined") return;
  window.addEventListener(onCallDeviceStateChangedEvent, dropMemo);
  memoListening = true;
}

function fresh<T>(memo: Memo<T> | undefined): T | null {
  return memo && Date.now() - memo.at < MEMO_MS ? memo.value : null;
}

type StoredChoice = { serviceId: string; siteId: string | null };

function readStoredChoice(): StoredChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(onCallHospitalChoiceStorageKey) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const { serviceId, siteId } = parsed as Record<string, unknown>;
    if (typeof serviceId !== "string" || (siteId !== null && typeof siteId !== "string")) return null;
    return { serviceId, siteId };
  } catch {
    return null;
  }
}

function writeStoredChoice(choice: StoredChoice): void {
  try {
    window.localStorage.setItem(onCallHospitalChoiceStorageKey, JSON.stringify(choice));
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}

/**
 * Per hospital: when each published entry was last seen, and when each one
 * went. Entry ids and ISO times ONLY, never a title, a name or a number (review
 * B2): the handbook is members-only, and this map outlives the page on a
 * shared phone until the sign-out wipe.
 */
type SeenHospital = { readonly seen: Record<string, string>; readonly gone: Record<string, string> };
type SeenMap = Record<string, SeenHospital>;

function isTimeMap(value: unknown): value is Record<string, string> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(
      (time) => typeof time === "string" && Number.isFinite(Date.parse(time)),
    )
  );
}

/** Anything not in the id-and-time shape (an older format, another writer) reads as nothing seen. */
function readSeen(): SeenMap {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(onCallHandbookSeenStorageKey) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: SeenMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const hospital = value as { seen?: unknown; gone?: unknown } | null;
      if (hospital && isTimeMap(hospital.seen) && isTimeMap(hospital.gone)) {
        map[key] = { seen: hospital.seen, gone: hospital.gone };
      }
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Compare this read with what the device saw last time, record the ids seen
 * now, and return what was withdrawn in the last 24 hours (ids and times).
 * The row that names a withdrawn entry is drawn from the live handbook or not
 * at all; nothing here can name it.
 */
function reconcileSeen(hospitalKey: string, items: readonly HandbookItem[], now: Date) {
  const seen = readSeen();
  const previous = seen[hospitalKey] ?? { seen: {}, gone: {} };
  const stamp = now.toISOString();
  const present = new Set(items.map((item) => item.id));
  const next: { seen: Record<string, string>; gone: Record<string, string> } = { seen: {}, gone: {} };
  for (const item of items) next.seen[item.id] = stamp;
  const removed: OnCallRemovedEntry[] = [];
  const candidates: [string, string][] = [
    ...Object.keys(previous.seen).map((id): [string, string] => [id, stamp]),
    ...Object.entries(previous.gone),
  ];
  for (const [id, goneAt] of candidates) {
    if (present.has(id) || id in next.gone) continue;
    if (now.getTime() - Date.parse(goneAt) >= REMOVED_KEEP_MS) continue;
    next.gone[id] = goneAt;
    removed.push({ id, goneAt });
  }
  try {
    window.localStorage.setItem(onCallHandbookSeenStorageKey, JSON.stringify({ ...seen, [hospitalKey]: next }));
  } catch {
    // Blocked storage: a withdrawal cannot be named next time, but this read stands.
  }
  return removed;
}

function isServiceList(value: unknown): value is { services: ServiceSummary[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { services?: unknown }).services));
}

function isServiceDetail(value: unknown): value is ServiceDetail {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries));
}

type ReadFailure = "expired" | "unavailable";
type ServicesState =
  | { readonly epoch: number; readonly status: "ready"; readonly items: ServiceSummary[] }
  | { readonly epoch: number; readonly status: ReadFailure; readonly error: string };
type DetailState =
  | {
      readonly key: string;
      readonly status: "ready";
      readonly detail: ServiceDetail;
      readonly removed: OnCallRemovedEntry[];
    }
  | { readonly key: string; readonly status: ReadFailure; readonly error: string };

const UNAVAILABLE = "Your hospital's numbers could not be loaded. Try again.";

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function hospitalOptions(services: readonly ServiceSummary[]): HospitalHandbookOption[] {
  return services.flatMap((service): HospitalHandbookOption[] =>
    service.sites.length === 0
      ? [{ serviceId: service.id, serviceName: service.name, siteId: null, siteName: null }]
      : service.sites.map((site) => ({
          serviceId: service.id,
          serviceName: service.name,
          siteId: site.id,
          siteName: site.name,
        })),
  );
}

const noop = () => {};

export function useHospitalHandbook(): HospitalHandbookState {
  const auth = useAuthSession();
  // A signed-out visitor sees the invented sample hospital (the same synthetic
  // one the local demo build serves), held in memory only: nothing is fetched,
  // remembered or reported.
  const envDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const demo = envDemo || auth.status === "signed_out" || auth.status === "expired";
  // The sample's numbers are text only; the local demo build keeps its own.
  const sampleDetail = envDemo ? demoServiceDetail : sampleServiceDetail;
  const epoch = auth.authEpoch;
  const live = !demo && auth.status === "authenticated";
  const [servicesState, setServicesState] = useState<ServicesState | null>(null);
  const [choice, setChoice] = useState<(StoredChoice & { epoch: number }) | null>(null);
  const [detailState, setDetailState] = useState<DetailState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [, setReportTick] = useState(0);

  useEffect(listenForWipe, []);

  // A new account never sees the last one's memo, even inside the 60 s. The
  // keys carry the epoch too; dropping the old entries also frees them.
  useEffect(() => {
    if (memoEpoch !== null && memoEpoch !== epoch) dropMemo();
    memoEpoch = epoch;
  }, [epoch]);

  useEffect(() => {
    if (!live) return;
    const cached = fresh(servicesMemo.get(epoch));
    if (cached) {
      queueMicrotask(() => setServicesState({ epoch, status: "ready", items: cached }));
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/on-call/services", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) {
          setServicesState({ epoch, status: "expired", error: "Your session ended." });
          return;
        }
        const payload: unknown = response.ok ? await response.json() : null;
        if (!isServiceList(payload)) {
          setServicesState({ epoch, status: "unavailable", error: UNAVAILABLE });
          return;
        }
        servicesMemo.set(epoch, { at: Date.now(), value: payload.services });
        rememberOnCallEditorFlag(
          payload.services.some((service) => service.role === "editor" || service.role === "admin"),
        );
        setServicesState({ epoch, status: "ready", items: payload.services });
      } catch (cause) {
        if (isAbort(cause) || controller.signal.aborted) return;
        setServicesState({ epoch, status: "unavailable", error: UNAVAILABLE });
      }
    })();
    return () => controller.abort();
  }, [epoch, live, reloadToken]);

  const services = useMemo<ServiceSummary[]>(() => {
    if (demo) return [demoServiceSummary];
    return servicesState?.epoch === epoch && servicesState.status === "ready" ? servicesState.items : [];
  }, [demo, epoch, servicesState]);

  const selection = useMemo(() => {
    if (services.length === 0) return null;
    const wanted = choice?.epoch === epoch ? choice : demo ? null : readStoredChoice();
    const service = services.find((item) => item.id === wanted?.serviceId) ?? services[0];
    const site =
      service.sites.find((item) => item.id === (wanted?.serviceId === service.id ? wanted.siteId : null)) ??
      service.sites[0] ??
      null;
    return { service, site };
  }, [choice, demo, epoch, services]);

  const serviceId = selection?.service.id ?? null;
  const siteId = selection?.site?.id ?? null;
  const hospitalKey = serviceId ? `${serviceId}:${siteId ?? ""}` : null;
  const detailKey = serviceId ? `${epoch}:${serviceId}:${siteId ?? ""}` : null;

  useEffect(() => {
    if (!live || !serviceId || !detailKey || !hospitalKey) return;
    const settle = (value: ServiceDetail) => {
      const items = publishedHandbookItems(value).filter((item) => item.siteId === null || item.siteId === siteId);
      const removed = reconcileSeen(hospitalKey, items, new Date());
      rememberOnCallEmergencyPinned(hospitalKey, pinnedEmergencyEntries(items, siteId).length > 0);
      setDetailState({ key: detailKey, status: "ready", detail: value, removed });
    };
    const cached = fresh(detailMemo.get(detailKey));
    if (cached) {
      queueMicrotask(() => settle(cached));
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const query = siteId ? `?${new URLSearchParams({ siteId }).toString()}` : "";
        const response = await fetch(`/api/on-call/services/${serviceId}${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          setDetailState({ key: detailKey, status: "expired", error: "Your session ended." });
          return;
        }
        const payload: unknown = response.ok ? await response.json() : null;
        if (controller.signal.aborted) return;
        if (!isServiceDetail(payload)) {
          setDetailState({ key: detailKey, status: "unavailable", error: UNAVAILABLE });
          return;
        }
        detailMemo.set(detailKey, { at: Date.now(), value: payload });
        settle(payload);
      } catch (cause) {
        if (isAbort(cause) || controller.signal.aborted) return;
        setDetailState({ key: detailKey, status: "unavailable", error: UNAVAILABLE });
      }
    })();
    return () => controller.abort();
  }, [detailKey, hospitalKey, live, reloadToken, serviceId, siteId]);

  const choose = useCallback(
    (nextServiceId: string, nextSiteId: string | null) => {
      const next = { serviceId: nextServiceId, siteId: nextSiteId };
      if (!demo) writeStoredChoice(next);
      setChoice({ ...next, epoch });
    },
    [demo, epoch],
  );

  const retry = useCallback(() => {
    if (detailKey) detailMemo.delete(detailKey);
    servicesMemo.delete(epoch);
    setServicesState((current) => (current?.status === "ready" ? current : null));
    setDetailState(null);
    setReloadToken((token) => token + 1);
  }, [detailKey, epoch]);

  const report = useCallback(
    async (entryId: string, reason: HandbookReportReason): Promise<HandbookReportResult> => {
      if (demo) return "demo";
      if (hasReportedOnThisDevice(entryId, reason)) return "already-reported";
      if (!serviceId) return "failed";
      try {
        const response = await fetch(`/api/on-call/services/${serviceId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "report.create", entryId, reason: HANDBOOK_REPORT_REASONS[reason] }),
        });
        if (!response.ok) return "failed";
        rememberReportOnThisDevice(entryId, reason);
        setReportTick((tick) => tick + 1);
        return "sent";
      } catch {
        return "failed";
      }
    },
    [demo, serviceId],
  );

  const hasReported = useCallback(
    (entryId: string, reason: HandbookReportReason) => hasReportedOnThisDevice(entryId, reason),
    [],
  );

  const currentDetail = detailState?.key === detailKey ? detailState : null;
  const currentServices = servicesState?.epoch === epoch ? servicesState : null;

  let status: HospitalHandbookStatus;
  let error: string | null = null;
  if (demo) status = "ready";
  else if (auth.status === "loading") status = "loading";
  else if (auth.status === "expired") status = "expired";
  else if (auth.status === "error") status = "unavailable";
  else if (auth.status !== "authenticated") status = "signed-out";
  else if (!currentServices) status = "loading";
  else if (currentServices.status !== "ready") {
    status = currentServices.status;
    error = currentServices.error;
  } else if (services.length === 0) status = "no-service";
  else if (!currentDetail) status = "loading";
  else if (currentDetail.status !== "ready") {
    status = currentDetail.status;
    error = currentDetail.error;
  } else status = "ready";

  const readyDetail = status === "ready" && currentDetail?.status === "ready" ? currentDetail : null;
  const items = useMemo(
    () =>
      (demo
        ? publishedHandbookItems(sampleDetail)
        : readyDetail
          ? publishedHandbookItems(readyDetail.detail)
          : []
      ).filter((item) => item.siteId === null || item.siteId === siteId),
    [demo, readyDetail, sampleDetail, siteId],
  );
  const hospitals = useMemo(() => hospitalOptions(services), [services]);
  const visible = status === "ready" || status === "loading";

  return {
    status,
    demo,
    services: visible ? services : [],
    serviceId: visible ? serviceId : null,
    siteId: visible ? siteId : null,
    serviceName: visible ? (selection?.service.name ?? null) : null,
    siteName: visible ? (selection?.site?.name ?? null) : null,
    hospitals: visible ? hospitals : [],
    hospitalKey: visible ? hospitalKey : null,
    items,
    removed: readyDetail?.removed ?? [],
    emergencyPinExpected: hospitalKey && !demo ? readOnCallEmergencyPinned(hospitalKey) : demo ? true : null,
    source: "network",
    savedAt: null,
    hours: (() => {
      const site = (demo ? sampleDetail : readyDetail?.detail)?.sites.find((site) => site.id === siteId);
      return site?.afterHoursStart && site.afterHoursEnd
        ? { afterHoursFrom: site.afterHoursStart, afterHoursUntil: site.afterHoursEnd }
        : null;
    })(),
    error,
    choose,
    changeHospital: choose,
    retry,
    report,
    hasReported,
    onRosteredSiteMismatch: noop,
  };
}

"use client";

import {
  BookOpen,
  Building2,
  ClipboardCheck,
  FileSpreadsheet,
  ListTodo,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { preloadablePanel } from "@/components/on-call/preloadable-panel";
import { ServiceHandbook } from "@/components/on-call/service-handbook";
import { focusOnCallEntryFromHash } from "@/components/on-call/on-call-page-anchors";
import { cardSurface, focusRing } from "@/components/card-recipes";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { TextField } from "@/components/ui/text-field";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { InlineNotice, cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import {
  DEMO_SERVICE_ID,
  DEMO_SITE_ID,
  demoServiceDetail,
  demoServiceSummary,
  sampleServiceDetail,
} from "@/lib/on-call/service-demo";
import {
  type ServiceAction,
  type ServiceDetail,
  type ServiceEntry,
  type ServiceSummary,
} from "@/lib/on-call/service-model";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * Only the Handbook shows by default. Every other panel, and the in-place entry
 * editor, is fetched once the service detail is in (and only the ones this
 * member can open), so it is ready before the tap without weighing on first load.
 */
const serviceEntryEditor = preloadablePanel(() =>
  import("@/components/on-call/service-entry-editor").then((module) => module.ServiceEntryEditor),
);
const serviceImportPanel = preloadablePanel(() =>
  import("@/components/on-call/service-import-panel").then((module) => module.ServiceImportPanel),
);
const serviceCheckingPanel = preloadablePanel(() =>
  import("@/components/on-call/service-checking-panel").then((module) => module.ServiceCheckingPanel),
);
const serviceOrientationPanel = preloadablePanel(() =>
  import("@/components/on-call/service-orientation-panel").then((module) => module.ServiceOrientationPanel),
);
const serviceGovernancePanel = preloadablePanel(() =>
  import("@/components/on-call/service-governance-panel").then((module) => module.ServiceGovernancePanel),
);
const serviceAdminPanel = preloadablePanel(() =>
  import("@/components/on-call/service-admin-panel").then((module) => module.ServiceAdminPanel),
);
const ServiceEntryEditor = serviceEntryEditor.Panel;
const ServiceImportPanel = serviceImportPanel.Panel;
const ServiceCheckingPanel = serviceCheckingPanel.Panel;
const ServiceOrientationPanel = serviceOrientationPanel.Panel;
const ServiceGovernancePanel = serviceGovernancePanel.Panel;
const ServiceAdminPanel = serviceAdminPanel.Panel;

/** The sign-in dialog loads on first open and then stays mounted, so its close still returns focus. */
const AccountSetupDialog = dynamic(
  () => import("@/components/clinical-dashboard/account-setup-dialog").then((module) => module.AccountSetupDialog),
  { ssr: false },
);

type WorkspaceTab = "handbook" | "import" | "checking" | "orientation" | "review" | "admin" | "services";
type LoadState = "loading" | "ready" | "signed-out" | "unavailable";
type OwnedServices = { readonly authEpoch: number; readonly items: ServiceSummary[] };
type OwnedDetail = { readonly contextKey: string; readonly value: ServiceDetail };

const workspaceTabs = [
  { id: "handbook", label: "Handbook", icon: BookOpen },
  { id: "import", label: "Import", icon: FileSpreadsheet },
  { id: "checking", label: "Needs checking", icon: ListTodo },
  { id: "orientation", label: "Orientation", icon: ClipboardCheck },
  { id: "review", label: "Review", icon: ShieldCheck },
  { id: "admin", label: "Members", icon: Users },
  { id: "services", label: "Services", icon: Settings },
] as const satisfies readonly { id: WorkspaceTab; label: string; icon: typeof BookOpen }[];

function isServiceList(value: unknown): value is { services: ServiceSummary[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { services?: unknown }).services));
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw await parseApiErrorResponse(response);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("The service response was incomplete.");
  return payload as Record<string, unknown>;
}

function roleLabel(detail: ServiceDetail): string {
  const role = detail.membership.role[0].toUpperCase() + detail.membership.role.slice(1);
  return detail.membership.clinicalReviewer ? `${role} · independent reviewer` : role;
}

export function ServicePage({
  initialServiceId = null,
  initialSiteId = null,
  initialRotation = "",
}: {
  readonly initialServiceId?: string | null;
  readonly initialSiteId?: string | null;
  readonly initialRotation?: string;
}) {
  const auth = useAuthSession();
  // Signed out, the page shows the invented sample service, read-only, the same
  // synthetic one the local demo build serves.
  const envDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const demoMode = envDemo || auth.status === "signed_out" || auth.status === "expired";
  const [state, setState] = useState<LoadState>("loading");
  const [ownedServices, setOwnedServices] = useState<OwnedServices | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(initialServiceId);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(initialSiteId);
  const [rotationDraft, setRotationDraft] = useState(initialRotation);
  const [rotation, setRotation] = useState(initialRotation);
  const [ownedDetail, setOwnedDetail] = useState<OwnedDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("handbook");
  const [editingEntry, setEditingEntry] = useState<ServiceEntry | null | undefined>(undefined);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMounted, setAccountMounted] = useState(false);
  if (accountOpen && !accountMounted) setAccountMounted(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceName, setServiceName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [serviceBusy, setServiceBusy] = useState<"create" | "join" | null>(null);
  const activeAuthEpoch = useRef(auth.authEpoch);
  const detailRequestSequence = useRef(0);
  const editorSession = useRef(0);
  const contextKey = `${auth.authEpoch}:${selectedServiceId ?? ""}:${selectedSiteId ?? ""}:${rotation}`;
  const activeContextKey = useRef(contextKey);
  activeAuthEpoch.current = auth.authEpoch;
  activeContextKey.current = contextKey;

  const services = useMemo(
    () => (demoMode ? [demoServiceSummary] : ownedServices?.authEpoch === auth.authEpoch ? ownedServices.items : []),
    [auth.authEpoch, demoMode, ownedServices],
  );
  const detail = demoMode
    ? envDemo
      ? demoServiceDetail
      : sampleServiceDetail
    : ownedDetail?.contextKey === contextKey
      ? ownedDetail.value
      : null;
  const effectiveState: LoadState = demoMode
    ? "ready"
    : auth.status === "loading"
      ? "loading"
      : auth.status === "error"
        ? "unavailable"
        : auth.status !== "authenticated"
          ? "signed-out"
          : ownedServices?.authEpoch === auth.authEpoch
            ? state
            : "loading";

  const loadServices = useCallback(async (ownerEpoch: number, signal?: AbortSignal) => {
    const response = await fetch("/api/on-call/services", { cache: "no-store", signal });
    if (response.status === 401) {
      if (activeAuthEpoch.current === ownerEpoch) {
        setOwnedServices({ authEpoch: ownerEpoch, items: [] });
        setOwnedDetail(null);
        setState("signed-out");
      }
      return [];
    }
    if (!response.ok) throw await parseApiErrorResponse(response);
    const payload: unknown = await response.json();
    if (!isServiceList(payload)) throw new Error("The service list was incomplete.");
    if (activeAuthEpoch.current === ownerEpoch) {
      setOwnedServices({ authEpoch: ownerEpoch, items: payload.services });
      setState("ready");
    }
    return payload.services;
  }, []);

  const loadDetail = useCallback(
    async (
      serviceId: string,
      siteId: string | null,
      selectedRotation: string,
      requestedContextKey: string,
      signal?: AbortSignal,
    ) => {
      const requestSequence = ++detailRequestSequence.current;
      setDetailLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (siteId) query.set("siteId", siteId);
        if (selectedRotation.trim()) query.set("rotation", selectedRotation.trim());
        const response = await fetch(`/api/on-call/services/${serviceId}${query.size ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal,
        });
        const payload = await responseJson(response);
        if (activeContextKey.current === requestedContextKey && detailRequestSequence.current === requestSequence) {
          setOwnedDetail({ contextKey: requestedContextKey, value: payload as unknown as ServiceDetail });
        }
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (activeContextKey.current === requestedContextKey && detailRequestSequence.current === requestSequence) {
          setOwnedDetail(null);
          const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
          setError(
            isOffline
              ? "You are offline. Connect to view service handbooks and details."
              : cause instanceof Error
                ? cause.message
                : "This service is temporarily unavailable.",
          );
        }
      } finally {
        if (activeContextKey.current === requestedContextKey && detailRequestSequence.current === requestSequence) {
          setDetailLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (demoMode) {
      queueMicrotask(() => {
        setSelectedServiceId(DEMO_SERVICE_ID);
        setSelectedSiteId(DEMO_SITE_ID);
        setState("ready");
      });
      return;
    }
    editorSession.current += 1;
    queueMicrotask(() => {
      setOwnedDetail(null);
      setOwnedServices(null);
      setEditingEntry(undefined);
      setServiceName("");
      setSiteName("");
      setJoinCode("");
      setRotationDraft(initialRotation);
      setRotation(initialRotation);
      setTab("handbook");
    });
    if (auth.status === "loading") {
      queueMicrotask(() => setState("loading"));
      return;
    }
    if (auth.status !== "authenticated") {
      queueMicrotask(() => setState(auth.status === "error" ? "unavailable" : "signed-out"));
      return;
    }
    queueMicrotask(() => setState("loading"));
    const ownerEpoch = auth.authEpoch;
    const controller = new AbortController();
    void loadServices(ownerEpoch, controller.signal).catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (activeAuthEpoch.current !== ownerEpoch) return;
      const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
      setError(
        isOffline
          ? "You are offline. Connect to view service handbooks and details."
          : cause instanceof Error
            ? cause.message
            : "Your services are temporarily unavailable.",
      );
      setState("unavailable");
    });
    return () => controller.abort();
  }, [auth.authEpoch, auth.status, demoMode, initialRotation, loadServices]);

  useEffect(() => {
    if (demoMode) return;
    if (effectiveState !== "ready" || services.length === 0) {
      if (services.length === 0) {
        queueMicrotask(() => {
          setSelectedServiceId(null);
          setSelectedSiteId(null);
          setOwnedDetail(null);
        });
      }
      return;
    }
    const service = services.find((item) => item.id === selectedServiceId) ?? services[0];
    if (service.id !== selectedServiceId) {
      queueMicrotask(() => setSelectedServiceId(service.id));
      return;
    }
    const site = service.sites.find((item) => item.id === selectedSiteId) ?? service.sites[0] ?? null;
    if ((site?.id ?? null) !== selectedSiteId) {
      queueMicrotask(() => setSelectedSiteId(site?.id ?? null));
      return;
    }
    const requestedContextKey = `${auth.authEpoch}:${service.id}:${site?.id ?? ""}:${rotation}`;
    const controller = new AbortController();
    queueMicrotask(() => {
      setOwnedDetail(null);
      closeEditor();
      void loadDetail(service.id, site?.id ?? null, rotation, requestedContextKey, controller.signal);
    });
    return () => controller.abort();
  }, [auth.authEpoch, demoMode, effectiveState, loadDetail, rotation, selectedServiceId, selectedSiteId, services]);

  useEffect(() => {
    if (!detail || tab !== "handbook") return;
    focusOnCallEntryFromHash();
    window.addEventListener("hashchange", focusOnCallEntryFromHash);
    return () => window.removeEventListener("hashchange", focusOnCallEntryFromHash);
  }, [detail, tab]);

  const selectedSummary = services.find((service) => service.id === selectedServiceId) ?? null;
  const selectedSite = selectedSummary?.sites.find((site) => site.id === selectedSiteId) ?? null;
  const canEdit = detail?.membership.role === "editor" || detail?.membership.role === "admin";
  const canReview = Boolean(
    detail &&
    (detail.membership.role === "editor" || detail.membership.role === "admin" || detail.membership.clinicalReviewer),
  );
  const hasDetail = detail !== null;
  useEffect(() => {
    if (!hasDetail) return;
    const preloads: Array<() => Promise<unknown>> = [serviceOrientationPanel.preload];
    if (canEdit) {
      preloads.push(
        serviceEntryEditor.preload,
        serviceImportPanel.preload,
        serviceCheckingPanel.preload,
        serviceAdminPanel.preload,
      );
    }
    if (canReview) preloads.push(serviceGovernancePanel.preload);
    // A failed prefetch is not an error: the tap that needs the panel loads it again.
    for (const preload of preloads) void preload().catch(() => undefined);
  }, [hasDetail, canEdit, canReview]);

  const visibleTabs = useMemo(
    () =>
      workspaceTabs.filter((item) => {
        // Editor tools; members never see them (plan Task 4).
        if (item.id === "import" || item.id === "checking") return canEdit;
        if (item.id === "review") return canReview;
        if (item.id === "admin") return canEdit;
        return true;
      }),
    [canEdit, canReview],
  );

  function canLeaveEditor(): boolean {
    return editingEntry === undefined || window.confirm("Discard unsaved handbook changes?");
  }

  function openEditor(entry: ServiceEntry | null): void {
    editorSession.current += 1;
    setEditingEntry(entry);
  }

  function closeEditor(): void {
    editorSession.current += 1;
    setEditingEntry(undefined);
  }

  const renderedEditorSession = editorSession.current;

  /** One detail reload for the import panel, at the end of each run (correction C14). */
  async function reloadDetail(): Promise<void> {
    if (demoMode || !selectedServiceId) return;
    await loadDetail(selectedServiceId, selectedSiteId, rotation, contextKey);
  }

  async function action(actionPayload: ServiceAction): Promise<Record<string, unknown>> {
    if (demoMode)
      throw new Error("Synthetic demo mode is read-only. Sign in outside demo mode to change a service handbook.");
    if (!selectedServiceId) throw new Error("Choose a service first.");
    const actionContextKey = contextKey;
    const actionAuthEpoch = auth.authEpoch;
    const actionServiceId = selectedServiceId;
    const actionSiteId = selectedSiteId;
    const actionRotation = rotation;
    try {
      const response = await fetch(`/api/on-call/services/${actionServiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actionPayload),
      });
      const payload = await responseJson(response);
      if (activeContextKey.current !== actionContextKey || activeAuthEpoch.current !== actionAuthEpoch) {
        throw new Error("The service context changed before this action completed. Reopen the entry to continue.");
      }
      await loadDetail(actionServiceId, actionSiteId, actionRotation, actionContextKey);
      if (activeContextKey.current !== actionContextKey || activeAuthEpoch.current !== actionAuthEpoch) {
        throw new Error("The service context changed while this action refreshed. Reopen the entry to continue.");
      }
      if (actionPayload.action === "site.create" || actionPayload.action === "site.update") {
        await loadServices(actionAuthEpoch);
      }
      return payload;
    } catch (cause) {
      if (
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        (cause instanceof TypeError && cause.message.includes("fetch"))
      ) {
        throw new Error("You are offline. Connect to update the service handbook.");
      }
      throw cause;
    }
  }

  async function createService() {
    if (!serviceName.trim() || !siteName.trim() || serviceBusy) return;
    setServiceBusy("create");
    setError(null);
    try {
      if (demoMode) throw new Error("Synthetic demo mode is read-only.");
      const response = await fetch("/api/on-call/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: serviceName.trim(), siteName: siteName.trim() }),
      });
      const payload = await responseJson(response);
      const serviceId = typeof payload.serviceId === "string" ? payload.serviceId : null;
      const createdSiteId = typeof payload.siteId === "string" ? payload.siteId : null;
      const ownerEpoch = auth.authEpoch;
      await loadServices(ownerEpoch);
      if (activeAuthEpoch.current !== ownerEpoch) return;
      setSelectedServiceId(serviceId);
      setSelectedSiteId(createdSiteId);
      setServiceName("");
      setSiteName("");
      setTab("handbook");
    } catch (cause) {
      if (
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        (cause instanceof TypeError && cause.message.includes("fetch"))
      ) {
        setError("You are offline. Connect to create a service.");
      } else {
        setError(cause instanceof Error ? cause.message : "The service could not be created.");
      }
    } finally {
      setServiceBusy(null);
    }
  }

  async function joinService() {
    if (!joinCode.trim() || serviceBusy) return;
    setServiceBusy("join");
    setError(null);
    try {
      if (demoMode) throw new Error("Synthetic demo mode is read-only.");
      const response = await fetch("/api/on-call/services/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode.trim() }),
      });
      const payload = await responseJson(response);
      const serviceId = typeof payload.serviceId === "string" ? payload.serviceId : null;
      const ownerEpoch = auth.authEpoch;
      await loadServices(ownerEpoch);
      if (activeAuthEpoch.current !== ownerEpoch) return;
      setSelectedServiceId(serviceId);
      setSelectedSiteId(null);
      setJoinCode("");
      setTab("handbook");
    } catch (cause) {
      if (
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        (cause instanceof TypeError && cause.message.includes("fetch"))
      ) {
        setError("You are offline. Connect to join a service.");
      } else {
        setError(cause instanceof Error ? cause.message : "The invitation could not be redeemed.");
      }
    } finally {
      setServiceBusy(null);
    }
  }

  if (effectiveState === "loading") {
    return (
      <InformationPageShell testId="service-page-loading" width="narrow">
        <h1 className="sr-only">Service handbook</h1>
        <p className={cn(textMuted, "text-sm")}>Loading your service handbook…</p>
        <OnCallCrisisLines />
      </InformationPageShell>
    );
  }

  if (effectiveState === "signed-out") {
    return (
      <InformationPageShell testId="service-page-signed-out" width="narrow">
        <h1 className="sr-only">Service handbook</h1>
        <OnCallEmptyState
          icon={Building2}
          title="Sign in to open a service handbook"
          body="Memberships, local service information and orientation completion are private to your account."
          actions={
            <Button variant="primary" onClick={() => setAccountOpen(true)}>
              Sign in
            </Button>
          }
        />
        {accountMounted ? <AccountSetupDialog open={accountOpen} onClose={() => setAccountOpen(false)} /> : null}
        <OnCallCrisisLines />
      </InformationPageShell>
    );
  }

  if (effectiveState === "unavailable") {
    return (
      <InformationPageShell testId="service-page-unavailable" width="narrow">
        <h1 className="sr-only">Service handbook</h1>
        <OnCallEmptyState
          icon={Building2}
          title="Your service handbooks are temporarily unavailable"
          body="No local or cached copy is being shown. Retry when the connection is restored."
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                setState("loading");
                void loadServices(auth.authEpoch).catch((cause: unknown) => {
                  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
                  setError(
                    isOffline
                      ? "You are offline. Connect to view service handbooks and details."
                      : cause instanceof Error
                        ? cause.message
                        : "Your services are temporarily unavailable.",
                  );
                  setState("unavailable");
                });
              }}
            >
              Retry
            </Button>
          }
        />
        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
        <OnCallCrisisLines />
      </InformationPageShell>
    );
  }

  return (
    <InformationPageShell testId="service-page">
      <header className="grid gap-2">
        {/* The band above already names the area and the page, so the title is for screen readers only. */}
        <h1 className="sr-only">Service handbook</h1>
        <p className={cn(textMuted, "max-w-3xl text-sm leading-6")}>
          Practical service information, orientation and corrections maintained by the people who use it.
        </p>
      </header>

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      {demoMode ? (
        <InlineNotice tone="neutral">
          Example only. The service, site, members, contacts and orientation items below are fictional. Actions do not
          write or call a provider.
        </InlineNotice>
      ) : null}

      {services.length === 0 ? (
        <OnCallEmptyState
          icon={Building2}
          title="Create a service or join one"
          body="A service keeps its sites, handbook entries, membership and review history together."
          testId="service-empty"
        />
      ) : null}

      {services.length > 0 ? (
        <section
          aria-labelledby="service-selection-heading"
          className={cn(cardSurface, "grid gap-3 p-4")}
          data-testid="service-selection"
        >
          <h2 id="service-selection-heading" className="sr-only">
            Current service and site
          </h2>
          {detail ? (
            <p
              className="break-words text-sm font-semibold text-[color:var(--text)]"
              data-testid="service-context-banner"
            >
              {detail.service.name} · {selectedSite?.name ?? "No site selected"} · {roleLabel(detail)}
              {rotation ? ` · ${rotation}` : ""}
            </p>
          ) : null}
          <details className="group grid gap-3">
            <summary className={cn(focusRing, "flex min-h-tap cursor-pointer items-center text-sm font-semibold")}>
              Change service or site
            </summary>
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <FormField label="Service" id="service-select">
                {(field) => (
                  <select
                    id={field.id}
                    aria-describedby={field.describedBy}
                    value={selectedServiceId ?? ""}
                    onChange={(event) => {
                      if (!canLeaveEditor()) return;
                      setSelectedServiceId(event.target.value || null);
                      setSelectedSiteId(null);
                      setOwnedDetail(null);
                    }}
                    className={fieldControlPlain}
                  >
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField label="Site" id="service-site-select">
                {(field) => (
                  <select
                    id={field.id}
                    aria-describedby={field.describedBy}
                    value={selectedSiteId ?? ""}
                    onChange={(event) => {
                      if (!canLeaveEditor()) return;
                      setSelectedSiteId(event.target.value || null);
                      setOwnedDetail(null);
                    }}
                    className={fieldControlPlain}
                  >
                    {(selectedSummary?.sites ?? []).map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            </div>
          </details>
          {tab === "orientation" ? (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <TextField
                label="Rotation"
                id="service-rotation"
                value={rotationDraft}
                onChange={(event) => setRotationDraft(event.target.value)}
                hint="For example: Term 1 2027"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  if (canLeaveEditor()) setRotation(rotationDraft.trim());
                }}
                disabled={rotationDraft.trim() === rotation}
              >
                Open rotation
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {detailLoading ? <p className={cn(textMuted, "text-sm")}>Loading the selected service…</p> : null}

      {detail ? (
        <Fragment key={contextKey}>
          <nav
            aria-label="Service handbook sections"
            className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
            data-testid="service-tabs"
          >
            {visibleTabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => {
                    if (!canLeaveEditor()) return;
                    closeEditor();
                    setTab(item.id);
                  }}
                  className={cn(
                    "inline-flex min-h-tap min-w-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold",
                    focusRing,
                    tab === item.id
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
                  )}
                >
                  <Icon aria-hidden="true" className="size-icon-sm shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {editingEntry !== undefined ? (
            <ServiceEntryEditor
              entry={editingEntry}
              sites={detail.sites}
              defaultSiteId={selectedSiteId}
              entries={detail.entries}
              onCancel={() => {
                if (canLeaveEditor()) closeEditor();
              }}
              onSave={async (entryAction) => {
                await action(entryAction);
                if (editorSession.current === renderedEditorSession) closeEditor();
              }}
            />
          ) : tab === "handbook" ? (
            <ServiceHandbook
              detail={detail}
              selectedSiteId={selectedSiteId}
              canEdit={canEdit}
              onAdd={() => openEditor(null)}
              onEdit={openEditor}
              onAction={action}
            />
          ) : tab === "import" && canEdit ? (
            <ServiceImportPanel
              serviceId={detail.service.id}
              siteId={selectedSiteId}
              siteName={selectedSite?.name ?? null}
              authEpoch={auth.authEpoch}
              detail={detail}
              demo={demoMode}
              reload={reloadDetail}
            />
          ) : tab === "checking" && canEdit ? (
            <ServiceCheckingPanel
              detail={detail}
              siteId={selectedSiteId}
              onEdit={(entry) => {
                openEditor(entry);
                setTab("handbook");
              }}
            />
          ) : tab === "orientation" ? (
            <ServiceOrientationPanel
              detail={detail}
              selectedSiteId={selectedSiteId}
              rotation={rotation}
              canEdit={canEdit}
              onEdit={openEditor}
              onAction={async (orientationAction) => {
                await action(orientationAction);
              }}
            />
          ) : tab === "review" && canReview ? (
            <ServiceGovernancePanel
              detail={detail}
              actorId={auth.session?.user.id ?? null}
              canEdit={canEdit}
              onEdit={openEditor}
              onAction={action}
            />
          ) : tab === "admin" && canEdit ? (
            <ServiceAdminPanel detail={detail} onAction={action} />
          ) : (
            <section
              aria-labelledby="service-membership-actions-heading"
              className="grid gap-5"
              data-testid="service-membership-actions"
            >
              <div>
                <h2
                  id="service-membership-actions-heading"
                  className="text-lg font-semibold text-[color:var(--text-heading)]"
                >
                  Create or join another service
                </h2>
                <p className={cn(textMuted, "mt-1 text-sm leading-6")}>Creating a service makes you its first admin.</p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <section aria-labelledby="create-service-heading" className={cn(cardSurface, "grid gap-3 p-4")}>
                  <h3 id="create-service-heading" className="text-sm font-semibold text-[color:var(--text-heading)]">
                    Create service
                  </h3>
                  <TextField
                    label="Service name"
                    id="service-create-name"
                    value={serviceName}
                    onChange={(event) => setServiceName(event.target.value)}
                  />
                  <TextField
                    label="First site"
                    id="service-create-site"
                    value={siteName}
                    onChange={(event) => setSiteName(event.target.value)}
                  />
                  <Button
                    variant="primary"
                    busy={serviceBusy === "create"}
                    busyLabel="Creating…"
                    disabled={!serviceName.trim() || !siteName.trim() || serviceBusy !== null}
                    onClick={() => void createService()}
                  >
                    Create service
                  </Button>
                </section>
                <section aria-labelledby="join-service-heading" className={cn(cardSurface, "grid gap-3 p-4")}>
                  <h3 id="join-service-heading" className="text-sm font-semibold text-[color:var(--text-heading)]">
                    Join with invitation
                  </h3>
                  <TextField
                    label="Invitation code"
                    id="service-join-code"
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                    autoComplete="off"
                  />
                  <Button
                    variant="secondary"
                    busy={serviceBusy === "join"}
                    busyLabel="Joining…"
                    disabled={!joinCode.trim() || serviceBusy !== null}
                    onClick={() => void joinService()}
                  >
                    Join service
                  </Button>
                </section>
              </div>
            </section>
          )}
        </Fragment>
      ) : services.length === 0 ? (
        <section aria-labelledby="first-service-heading" className="grid gap-4" data-testid="service-first-run">
          <h2 id="first-service-heading" className="text-lg font-semibold text-[color:var(--text-heading)]">
            Start your first service
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className={cn(cardSurface, "grid gap-3 p-4")}>
              <TextField
                label="Service name"
                id="service-first-name"
                value={serviceName}
                onChange={(event) => setServiceName(event.target.value)}
              />
              <TextField
                label="First site"
                id="service-first-site"
                value={siteName}
                onChange={(event) => setSiteName(event.target.value)}
              />
              <Button
                variant="primary"
                busy={serviceBusy === "create"}
                busyLabel="Creating…"
                disabled={!serviceName.trim() || !siteName.trim() || serviceBusy !== null}
                onClick={() => void createService()}
              >
                Create service
              </Button>
            </section>
            <section className={cn(cardSurface, "grid gap-3 p-4")}>
              <TextField
                label="Invitation code"
                id="service-first-join-code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                autoComplete="off"
              />
              <Button
                variant="secondary"
                busy={serviceBusy === "join"}
                busyLabel="Joining…"
                disabled={!joinCode.trim() || serviceBusy !== null}
                onClick={() => void joinService()}
              >
                Join service
              </Button>
            </section>
          </div>
        </section>
      ) : null}
    </InformationPageShell>
  );
}

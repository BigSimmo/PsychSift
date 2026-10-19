"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  clinicalQualitySnapshotSchema,
  clinicalQualityTriageResponseSchema,
  triageOwnerRoleSchema,
  triageResolutionCodeSchema,
  triageStatusSchema,
  type ClinicalQualitySnapshot,
} from "@/lib/clinical-quality-dashboard";

type LoadState =
  | { kind: "loading" }
  | { kind: "permission"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshot: ClinicalQualitySnapshot; acceptedAt: number };

const sectionClass = "grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4";
const cardClass = "grid gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3";

function formatCount(value: number | null) {
  return value === null ? "Unknown" : String(value);
}

function Evidence({ evidence }: { evidence: ClinicalQualitySnapshot["qualityQueue"]["evidence"] }) {
  return (
    <p className="text-xs leading-5 text-[color:var(--text-muted)]">
      Evidence: <strong>{evidence.state}</strong> ·{" "}
      {evidence.asOf ? `as of ${new Date(evidence.asOf).toLocaleString()}` : "as of unknown"} · {evidence.source}
      {evidence.note ? ` — ${evidence.note}` : ""}
    </p>
  );
}

export function ClinicalTrustCockpit() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/clinical-quality", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setState({
          kind: "permission",
          message:
            response.status === 401
              ? "Sign in as an administrator to view clinical trust evidence."
              : "Administrator access is required for clinical trust evidence.",
        });
        return;
      }
      if (!response.ok) {
        setState({
          kind: "error",
          message: "Clinical trust evidence is unavailable. No missing value is being treated as healthy.",
        });
        return;
      }
      const parsed = clinicalQualitySnapshotSchema.safeParse(await response.json());
      if (!parsed.success) {
        setState({ kind: "error", message: "Clinical trust evidence returned an invalid shape and was rejected." });
        return;
      }
      setState({ kind: "ready", snapshot: parsed.data, acceptedAt: Date.now() });
    } catch {
      setState({ kind: "error", message: "Clinical trust evidence could not be loaded." });
    }
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [load]);

  async function saveTriage(
    event: FormEvent<HTMLFormElement>,
    signalType: ClinicalQualitySnapshot["qualityQueue"]["items"][number]["signalType"],
    signalId: string,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const signalKey = `${signalType}:${signalId}`;
    setSavingId(signalKey);
    setSaveMessage("");
    try {
      const response = await fetch("/api/clinical-quality", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signalType,
          signalId,
          status: form.get("status"),
          ownerRole: form.get("ownerRole"),
          ownerUserId: String(form.get("ownerUserId") ?? "").trim() || null,
          resolutionCode: String(form.get("resolutionCode") ?? "").trim() || null,
          retestReference: form.get("retestReference"),
        }),
      });
      if (!response.ok) {
        setSaveMessage("Triage metadata was not saved. Review required fields and try again.");
        return;
      }
      const parsed = clinicalQualityTriageResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setSaveMessage("Triage metadata returned an invalid acknowledgement and was not accepted.");
        return;
      }
      setSaveMessage("Triage metadata saved. Content status was not changed automatically.");
      await load();
    } catch {
      setSaveMessage("Triage metadata could not be saved.");
    } finally {
      setSavingId(null);
    }
  }

  if (state.kind === "loading") return <p role="status">Loading clinical trust evidence…</p>;
  if (state.kind === "permission")
    return (
      <p role="alert" className={cardClass}>
        {state.message}
      </p>
    );
  if (state.kind === "error") {
    return (
      <div role="alert" className={cardClass}>
        <p>{state.message}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-12 w-fit rounded-lg border border-[color:var(--border)] px-3 font-bold"
        >
          Retry
        </button>
      </div>
    );
  }

  const { snapshot } = state;
  const maturityAsOf = snapshot.contentMaturity.evidence.asOf;
  const maturityStale = !maturityAsOf || state.acceptedAt - Date.parse(maturityAsOf) > 30 * 24 * 60 * 60 * 1000;
  return (
    <div className="grid gap-6" data-testid="clinical-trust-cockpit">
      <p role="status" className={cardClass}>
        Snapshot {snapshot.state}. Response generated {new Date(snapshot.generatedAt).toLocaleString()}.{" "}
        {maturityStale
          ? "The repository catalogue evidence is stale."
          : "Repository catalogue evidence is within its 30-day review window."}
      </p>

      <section aria-labelledby="clinical-trust-quality-heading" className={sectionClass}>
        <h2 id="clinical-trust-quality-heading" className="text-lg font-extrabold text-[color:var(--text-heading)]">
          Quality queue
        </h2>
        <Evidence evidence={snapshot.qualityQueue.evidence} />
        {snapshot.qualityQueue.evidence.state === "unknown" ? (
          <p>Quality queue state is unknown.</p>
        ) : snapshot.qualityQueue.items.length === 0 ? (
          <p>No quality signals are visible in this snapshot.</p>
        ) : (
          <ul className="grid gap-3">
            {snapshot.qualityQueue.items.map((item) => (
              <li key={`${item.signalType}:${item.signalId}`} className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {item.signalType.replaceAll("_", " ")} · {item.category.replaceAll("_", " ")}
                  </strong>
                  <span className="text-xs font-bold uppercase">{item.priority}</span>
                </div>
                <p className="break-all font-mono text-xs text-[color:var(--text-muted)]">
                  Signal {item.signalId}
                  {item.interactionId ? ` · interaction ${item.interactionId}` : ""}
                </p>
                {item.recordType && item.recordType !== "answer" ? (
                  <p className="text-xs text-[color:var(--text-muted)]" data-testid="quality-queue-record">
                    Reported on the {item.recordType} record {item.recordId ?? "unknown"}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="whitespace-pre-wrap text-sm" data-testid="quality-queue-note">
                    Reader note: {item.note}
                  </p>
                ) : null}
                <p className="text-xs text-[color:var(--text-muted)]">
                  {item.documentIds.length} linked source identifiers · observed{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </p>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(event) => void saveTriage(event, item.signalType, item.signalId)}
                >
                  <label className="grid gap-1 text-sm">
                    Status
                    <select
                      name="status"
                      defaultValue={item.triage.status}
                      className="min-h-12 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                    >
                      {item.triage.status === "unknown" ? (
                        <option value="unknown" disabled>
                          unknown — choose a status
                        </option>
                      ) : null}
                      {triageStatusSchema.options.map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Owner role
                    <select
                      name="ownerRole"
                      defaultValue={item.triage.ownerRole}
                      className="min-h-12 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                    >
                      {triageOwnerRoleSchema.options.map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Owner user ID
                    <input
                      name="ownerUserId"
                      defaultValue={item.triage.ownerUserId ?? ""}
                      maxLength={36}
                      className="min-h-12 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Resolution
                    <select
                      name="resolutionCode"
                      defaultValue={item.triage.resolutionCode ?? ""}
                      className="min-h-12 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                    >
                      <option value="">Not resolved</option>
                      {triageResolutionCodeSchema.options.map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm sm:col-span-2">
                    Retest reference
                    <input
                      name="retestReference"
                      defaultValue={item.triage.retestReference}
                      maxLength={120}
                      placeholder="Test, PR, or evidence reference"
                      className="min-h-12 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={savingId === `${item.signalType}:${item.signalId}`}
                    className="min-h-12 w-fit rounded-lg bg-[color:var(--clinical-accent)] px-4 font-extrabold text-[color:var(--clinical-accent-contrast)]"
                  >
                    {savingId === `${item.signalType}:${item.signalId}` ? "Saving…" : "Save triage metadata"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p aria-live="polite" className="text-sm">
          {saveMessage}
        </p>
      </section>

      <section aria-labelledby="clinical-trust-impact-heading" className={sectionClass}>
        <h2 id="clinical-trust-impact-heading" className="text-lg font-extrabold text-[color:var(--text-heading)]">
          Source-change impact
        </h2>
        <Evidence evidence={snapshot.sourceImpact.evidence} />
        {snapshot.sourceImpact.evidence.state === "unknown" ? (
          <p>Source impact is unknown.</p>
        ) : snapshot.sourceImpact.items.length === 0 ? (
          <p>No reviewed source changes are visible in this snapshot.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {snapshot.sourceImpact.items.map((item) => (
              <li key={item.documentId} className={cardClass}>
                <strong>
                  {item.priority} priority · {item.decision}
                </strong>
                <span className="break-all font-mono text-xs">{item.documentId}</span>
                <span className="text-sm">
                  {item.registryLinkCount} registry links · {item.retrievalReach} retrievals · {item.feedbackReach}{" "}
                  feedback items
                </span>
                <span className="text-xs text-[color:var(--text-muted)]">
                  Areas: {item.affectedAreas.length ? item.affectedAreas.join(", ") : "unknown"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="clinical-trust-maturity-heading" className={sectionClass}>
        <h2 id="clinical-trust-maturity-heading" className="text-lg font-extrabold text-[color:var(--text-heading)]">
          Content maturity
        </h2>
        <Evidence evidence={snapshot.contentMaturity.evidence} />
        <p className="text-sm">
          Implementation, source support, source currency, and qualified human review are separate signals.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {snapshot.contentMaturity.bands.map((band) => (
            <li key={band.area} className={cardClass}>
              <strong>{band.label}</strong>
              <span className="text-sm">
                {band.total} catalogue records · {formatCount(band.implementation.available)} implemented
              </span>
              <span className="text-sm">
                Clinical review: {formatCount(band.clinicalReview.reviewed)} reviewed ·{" "}
                {formatCount(band.clinicalReview.pending)} pending · {formatCount(band.clinicalReview.overdue)} overdue
                · {formatCount(band.clinicalReview.unknown)} unverified
              </span>
              <span className="text-sm">
                Source support: {formatCount(band.sourceSupport.supported)} supported ·{" "}
                {formatCount(band.sourceSupport.partial)} partial · {formatCount(band.sourceSupport.unknown)} unverified
              </span>
              <span className="text-sm">
                Currency: {formatCount(band.sourceCurrency.current)} current ·{" "}
                {formatCount(band.sourceCurrency.reviewDue)} due · {formatCount(band.sourceCurrency.overdue)} overdue ·{" "}
                {formatCount(band.sourceCurrency.unknown)} unverified
              </span>
              <Evidence evidence={band.evidence} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

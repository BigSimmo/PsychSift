// Manual-tag editor for the document viewer: add/rename/delete curated manual
// labels via the document labels API. Extracted from DocumentViewer.tsx
// (maturity X3) as a pure move.
import { Check, Loader2, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn, fieldControl, floatingControl, primaryControl, sourceCard, textMuted } from "@/components/ui-primitives";
import type { ClinicalDocument, DocumentLabel, DocumentLabelType } from "@/lib/types";

const primaryButton = primaryControl;
const secondaryButton = floatingControl;

// Mirrors the server contract (`manualLabelSchema` in
// src/app/api/documents/[id]/labels/route.ts: z.string().trim().min(2).max(64)) so a too-short
// or too-long tag is caught in the field instead of round-tripping to a generic 400.
const manualLabelMinLength = 2;
const manualLabelMaxLength = 64;

const manualLabelTypeOptions: Array<{ value: DocumentLabelType; label: string }> = [
  { value: "site", label: "Site" },
  { value: "topic", label: "Topic" },
  { value: "medication", label: "Medication" },
  { value: "risk", label: "Risk" },
  { value: "workflow", label: "Workflow" },
  { value: "setting", label: "Setting" },
  { value: "service", label: "Service" },
  { value: "document_type", label: "Document type" },
  { value: "population", label: "Population" },
  { value: "clinical_action", label: "Clinical action" },
  { value: "care_phase", label: "Care phase" },
  { value: "document_intent", label: "Document intent" },
  { value: "content_feature", label: "Content feature" },
  { value: "custom", label: "Manual" },
];

function manualLabelTypeLabel(value: DocumentLabelType) {
  return manualLabelTypeOptions.find((option) => option.value === value)?.label ?? "Manual";
}

export function DocumentManualTagEditor({
  document,
  canManage,
  clientDemoMode,
  authorizationHeader,
  onLabelsUpdated,
  onUnauthorized,
}: {
  document: ClinicalDocument;
  canManage: boolean;
  clientDemoMode: boolean;
  authorizationHeader: Record<string, string>;
  onLabelsUpdated: (labels: DocumentLabel[]) => void;
  onUnauthorized: () => void;
}) {
  const manualLabels = (document.labels ?? []).filter((label) => label.source === "manual");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftType, setDraftType] = useState<DocumentLabelType>("topic");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [editingType, setEditingType] = useState<DocumentLabelType>("topic");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitManualTag(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, action: string) {
    setBusyAction(action);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${document.id}/labels`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(clientDemoMode ? {} : authorizationHeader),
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        // Hand off to the parent's unauthorized UI and stop here — falling through
        // to the generic throw would also raise an inline error banner underneath it.
        onUnauthorized();
        return false;
      }
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "Tag update failed.");
      if (Array.isArray(payload.labels)) onLabelsUpdated(payload.labels as DocumentLabel[]);
      return true;
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "Tag update failed.");
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function addManualTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const added = await submitManualTag("POST", { label: draftLabel, label_type: draftType }, "add");
    if (added) {
      setDraftLabel("");
      setDraftType("topic");
    }
  }

  async function saveManualTag(label: DocumentLabel) {
    const saved = await submitManualTag(
      "PATCH",
      { labelId: label.id, label: editingLabel, label_type: editingType },
      `edit:${label.id}`,
    );
    if (saved) {
      setEditingId(null);
      setEditingLabel("");
    }
  }

  async function deleteManualTag(label: DocumentLabel) {
    setConfirmingDeleteId(null);
    await submitManualTag("DELETE", { labelId: label.id }, `delete:${label.id}`);
  }

  return (
    <div className={cn(sourceCard, "mt-4 p-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
          <Tag aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--clinical-accent)]" />
          Manual tags
        </p>
        <span className={cn("text-2xs font-semibold", textMuted)}>
          {manualLabels.length ? `${manualLabels.length} curated` : "Generated tags are read-only"}
        </span>
      </div>

      <form onSubmit={addManualTag} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
        <label htmlFor="manual-tag-input" className="sr-only">
          Manual tag
        </label>
        <input
          id="manual-tag-input"
          value={draftLabel}
          onChange={(event) => setDraftLabel(event.target.value)}
          placeholder="Add clean manual tag"
          disabled={!canManage || busyAction !== null}
          maxLength={manualLabelMaxLength}
          className={fieldControl}
          aria-label="Manual tag"
        />
        <select
          value={draftType}
          onChange={(event) => setDraftType(event.target.value as DocumentLabelType)}
          disabled={!canManage || busyAction !== null}
          className={fieldControl}
          aria-label="Manual tag type"
        >
          {manualLabelTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!canManage || busyAction !== null || draftLabel.trim().length < manualLabelMinLength}
          className={cn(primaryButton, "min-h-tap px-3 text-xs")}
        >
          {busyAction === "add" ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Plus aria-hidden="true" className="h-4 w-4" />
          )}
          Add
        </button>
      </form>

      {error ? (
        // An alert, so a failed add, rename or remove is heard, not only seen.
        <p
          role="alert"
          className="mt-2 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-semibold text-[color:var(--warning)]"
        >
          {error}
        </p>
      ) : null}

      {manualLabels.length ? (
        <div className="mt-3 grid gap-2">
          {manualLabels.map((label) => {
            const editing = editingId === label.id;
            return (
              <div
                key={label.id}
                className="grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                {editing ? (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <input
                      value={editingLabel}
                      onChange={(event) => setEditingLabel(event.target.value)}
                      maxLength={manualLabelMaxLength}
                      className={fieldControl}
                      aria-label="Manual tag label"
                    />
                    <select
                      value={editingType}
                      onChange={(event) => setEditingType(event.target.value as DocumentLabelType)}
                      className={fieldControl}
                      aria-label="Manual tag type"
                    >
                      {manualLabelTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[color:var(--text)]">{label.label}</p>
                    <p className={cn("text-2xs font-semibold", textMuted)}>{manualLabelTypeLabel(label.label_type)}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => saveManualTag(label)}
                        disabled={editingLabel.trim().length < manualLabelMinLength || busyAction !== null}
                        className={cn(primaryButton, "px-2 text-xs")}
                        aria-label={`Save ${label.label}`}
                      >
                        {busyAction === `edit:${label.id}` ? (
                          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check aria-hidden="true" className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={busyAction !== null}
                        className={cn(secondaryButton, "sm:min-h-compact-meta px-2 text-xs")}
                        aria-label="Cancel edit"
                      >
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </>
                  ) : confirmingDeleteId === label.id ? (
                    <>
                      {/* Distinct keys keep React from reusing the Remove button's DOM node for
                          the destructive confirm (so the control the user pressed is never turned
                          into "delete" in place), and the leading prompt occupies the position the
                          Remove button was clicked from — together a rapid double-click on the old
                          Remove target can't reach the confirm. */}
                      <span
                        key="delete-confirm-prompt"
                        className="inline-flex min-h-tap items-center px-1 text-xs font-semibold text-[color:var(--text-muted)] sm:min-h-9"
                      >
                        Remove this tag?
                      </span>
                      <button
                        key="delete-confirm"
                        type="button"
                        onClick={() => deleteManualTag(label)}
                        disabled={!canManage || busyAction !== null}
                        className={cn(
                          secondaryButton,
                          "sm:min-h-compact-meta px-2 text-xs border-[color:var(--danger)]/40 text-[color:var(--danger)]",
                        )}
                        aria-label={`Confirm remove ${label.label}`}
                      >
                        {busyAction === `delete:${label.id}` ? (
                          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        )}
                        Confirm remove
                      </button>
                      <button
                        key="delete-cancel"
                        type="button"
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={busyAction !== null}
                        className={cn(secondaryButton, "sm:min-h-compact-meta px-2 text-xs")}
                        aria-label={`Cancel removing ${label.label}`}
                      >
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        key="rename"
                        type="button"
                        onClick={() => {
                          setConfirmingDeleteId(null);
                          setEditingId(label.id);
                          setEditingLabel(label.label);
                          setEditingType(label.label_type);
                        }}
                        disabled={!canManage || busyAction !== null}
                        className={cn(secondaryButton, "sm:min-h-compact-meta px-2 text-xs")}
                        aria-label={`Rename ${label.label}`}
                      >
                        <Pencil aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        key="remove"
                        type="button"
                        onClick={() => setConfirmingDeleteId(label.id)}
                        disabled={!canManage || busyAction !== null}
                        className={cn(secondaryButton, "sm:min-h-compact-meta px-2 text-xs text-[color:var(--danger)]")}
                        aria-label={`Remove ${label.label}`}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

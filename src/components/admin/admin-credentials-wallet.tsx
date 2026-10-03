"use client";

import { Check, Copy, CreditCard, Edit3, Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import {
  DEFAULT_CREDENTIALS,
  loadDoctorCredentials,
  saveDoctorCredentials,
  type DoctorCredentials,
} from "@/lib/admin/credentials-storage";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

export function AdminCredentialsWallet({ testId = "admin-credentials-wallet" }: { readonly testId?: string }) {
  const [creds, setCreds] = useState<DoctorCredentials>(() => loadDoctorCredentials());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DoctorCredentials>(() => loadDoctorCredentials());

  useEffect(() => {
    return subscribeAccountTransition(() => {
      setCreds(DEFAULT_CREDENTIALS);
      setDraft(DEFAULT_CREDENTIALS);
    });
  }, []);

  const triggerHaptic = useCallback(() => {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(10);
      } catch {
        // Ignored
      }
    }
  }, []);

  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleCopy = useCallback(
    async (key: string, value: string) => {
      if (!value.trim()) {
        setEditing(true);
        return;
      }
      triggerHaptic();
      try {
        await copyTextToClipboard(value.trim());
        setCopyFailedKey(null);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1800);
      } catch {
        setCopiedKey(null);
        setCopyFailedKey(key);
        setTimeout(() => setCopyFailedKey(null), 2500);
      }
    },
    [triggerHaptic],
  );

  const handleSave = () => {
    const cleaned: DoctorCredentials = {
      ...draft,
      providerNumbers: draft.providerNumbers.filter((p) => p.site.trim() || p.number.trim()),
    };
    const ok = saveDoctorCredentials(cleaned);
    if (!ok) {
      setSaveError("Failed to save credentials to local device storage.");
      return;
    }
    setSaveError(null);
    setCreds(cleaned);
    setDraft(cleaned);
    setEditing(false);
  };

  const cards = [
    {
      key: "ahpra",
      label: "Ahpra Registration",
      value: creds.ahpraNumber || "MED000...",
      realValue: creds.ahpraNumber,
    },
    {
      key: "prescriber",
      label: "Prescriber Number",
      value: creds.prescriberNumber || "7 digits",
      realValue: creds.prescriberNumber,
    },
    ...creds.providerNumbers.map((p) => ({
      key: `provider-${p.id}`,
      label: `Provider (${p.site})`,
      value: p.number || "Provider #",
      realValue: p.number,
    })),
    {
      key: "wwcc",
      label: "Working with Children",
      value: creds.wwccNumber || "WWCC #",
      realValue: creds.wwccNumber,
    },
  ];

  return (
    <section
      data-testid={testId}
      aria-label="Doctor credentials wallet"
      className="grid gap-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5 shadow-xs"
    >
      <div className="flex items-center justify-between">
        <h3 className={cn(eyebrowText, "flex items-center gap-1.5")}>
          <CreditCard className="size-3.5" aria-hidden="true" />
          Credentials Wallet
        </h3>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-2xs text-[color:var(--text-muted)]">
            <Lock className="size-3" aria-hidden="true" />
            Device-only
          </span>
          <button
            type="button"
            data-testid={`${testId}-edit-button`}
            onClick={() => {
              setDraft(creds);
              setSaveError(null);
              setEditing(true);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[color:var(--primary)] hover:bg-[color:var(--surface-subtle)]",
              focusRing,
            )}
          >
            <Edit3 className="size-3" aria-hidden="true" />
            Edit
          </button>
        </div>
      </div>
      <p className="text-xs text-[color:var(--text-muted)]">
        Stored on this device only. Use it on your own phone, not a shared ward computer.
      </p>

      {/* Grid of Micro-Passcards */}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="list">
        {cards.map((c) => {
          const isCopied = copiedKey === c.key;
          const isFailed = copyFailedKey === c.key;
          const hasValue = Boolean(c.realValue);
          return (
            <li key={c.key} className="contents" role="listitem">
              <button
                type="button"
                data-testid={`${testId}-card-${c.key}`}
                aria-label={`${c.label}: ${c.realValue || "Tap to set"}`}
                onClick={() => void handleCopy(c.key, c.realValue)}
                className={cn(
                  "relative flex min-h-16 flex-col justify-between rounded-xl border p-2.5 text-left transition-colors active:opacity-80",
                  hasValue
                    ? "border-[color:var(--border)] bg-[color:var(--surface-subtle)] hover:border-[color:var(--command)] hover:bg-[color:var(--surface-inset)]"
                    : "border-dashed border-[color:var(--border-dashed)] bg-transparent text-[color:var(--text-muted)]",
                  focusRing,
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-2xs font-medium text-[color:var(--text-muted)]">{c.label}</span>
                  <Copy className="size-2.5 shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
                </div>

                <span className="mt-1 font-mono text-sm tracking-tight text-[color:var(--text-heading)]">
                  {c.value}
                </span>

                {/* Floating "Copied!" Pill Tooltip */}
                {isCopied && (
                  <div
                    data-testid={`${testId}-copied-${c.key}`}
                    role="status"
                    className="absolute inset-0 grid place-items-center rounded-xl bg-[color:var(--surface-raised)]/95 shadow-sm backdrop-blur-xs animate-in fade-in duration-[var(--duration-quick)]"
                  >
                    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--success)] px-2 py-0.5 text-2xs font-medium text-[color:var(--command-contrast)] shadow-xs">
                      <Check className="size-2.5" aria-hidden="true" />
                      Copied!
                    </span>
                  </div>
                )}

                {/* Floating "Copy failed" Pill Tooltip */}
                {isFailed && (
                  <div
                    data-testid={`${testId}-failed-${c.key}`}
                    role="status"
                    className="absolute inset-0 grid place-items-center rounded-xl bg-[color:var(--surface-raised)]/95 shadow-sm backdrop-blur-xs animate-in fade-in duration-[var(--duration-quick)]"
                  >
                    <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-inset)] px-2 py-0.5 text-2xs font-medium text-[color:var(--text-heading)] shadow-xs">
                      Copy failed
                    </span>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Edit Sheet */}
      <Sheet
        open={editing}
        onClose={() => {
          setSaveError(null);
          setEditing(false);
        }}
        title="Edit Doctor Credentials"
        testId={`${testId}-sheet`}
        footer={
          <Button variant="primary" block onClick={handleSave} testId={`${testId}-save-button`}>
            Save to device
          </Button>
        }
      >
        <div className="grid gap-3 py-1">
          <p className="text-xs text-[color:var(--text-muted)]">
            These numbers stay securely in this browser on your device for fast copy-pasting onto drug charts and
            referral slips.
          </p>

          {saveError && (
            <p role="alert" className="text-xs font-medium text-[color:var(--text-heading)]">
              {saveError}
            </p>
          )}

          <TextField
            label="Ahpra Registration Number"
            placeholder="e.g. MED0001234567"
            value={draft.ahpraNumber}
            onChange={(e) => setDraft({ ...draft, ahpraNumber: e.target.value })}
            id={`${testId}-input-ahpra`}
          />

          <TextField
            label="Prescriber Number"
            placeholder="7-digit prescriber number"
            value={draft.prescriberNumber}
            onChange={(e) => setDraft({ ...draft, prescriberNumber: e.target.value })}
            id={`${testId}-input-prescriber`}
          />

          <div className="grid gap-2 border-t border-[color:var(--border)] pt-2">
            <span className="text-xs font-medium text-[color:var(--text-heading)]">Hospital Site Provider Numbers</span>
            {draft.providerNumbers.map((p, idx) => (
              <div key={p.id} className="grid grid-cols-[1fr_1fr] gap-2">
                <TextField
                  label={`Site ${idx + 1}`}
                  value={p.site}
                  onChange={(e) => {
                    const updated = [...draft.providerNumbers];
                    updated[idx] = { ...updated[idx], site: e.target.value };
                    setDraft({ ...draft, providerNumbers: updated });
                  }}
                />
                <TextField
                  label="Provider #"
                  value={p.number}
                  onChange={(e) => {
                    const updated = [...draft.providerNumbers];
                    updated[idx] = { ...updated[idx], number: e.target.value };
                    setDraft({ ...draft, providerNumbers: updated });
                  }}
                />
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                setDraft({
                  ...draft,
                  providerNumbers: [...draft.providerNumbers, { id: `site-${Date.now()}`, site: "", number: "" }],
                })
              }
              testId={`${testId}-add-site-button`}
            >
              Add a site
            </Button>
          </div>

          <TextField
            label="Working with Children Check (WWCC)"
            placeholder="WWCC card number"
            value={draft.wwccNumber}
            onChange={(e) => setDraft({ ...draft, wwccNumber: e.target.value })}
          />
        </div>
      </Sheet>
    </section>
  );
}

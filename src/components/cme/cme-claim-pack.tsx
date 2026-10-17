"use client";

import { ClipboardCheck, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCopyToast } from "@/components/ui/toast";
import type { CmeEntry } from "@/lib/cme/types";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";

function claimableEntries(entries: readonly CmeEntry[]): CmeEntry[] {
  return entries
    .filter((entry) => !entry.archivedAt && typeof entry.costCents === "number" && entry.costCents > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/**
 * Formats a list of CME entries into an itemized, human-readable claim pack text
 * for hospital study budget or payslip reimbursement submissions.
 *
 * Excludes archived entries and entries without positive costs.
 * Sorts by date ascending.
 */
export function generateClaimPackText(entries: readonly CmeEntry[]): string {
  const claimable = claimableEntries(entries);

  if (claimable.length === 0) {
    return "No claimable expenses recorded (0 entries with financial costs).";
  }

  const totalCents = claimable.reduce((sum, entry) => sum + (entry.costCents ?? 0), 0);
  const totalDollars = (totalCents / 100).toFixed(2);

  const lines: string[] = [
    "CONTINUING PROFESSIONAL DEVELOPMENT (CPD) / STUDY LEAVE CLAIM PACK",
    `Total Claim Amount: $${totalDollars} AUD (${claimable.length} ${claimable.length === 1 ? "expense" : "expenses"})`,
    "--------------------------------------------------------------------------------",
    "Itemized Expenses:",
  ];

  claimable.forEach((entry, index) => {
    const amount = ((entry.costCents ?? 0) / 100).toFixed(2);
    lines.push(`${index + 1}. Date: ${entry.date} | Title: ${entry.title} | Amount: $${amount} AUD`);
    if (entry.documentId) {
      lines.push(`   Receipt / Document ID: ${entry.documentId}`);
    }
    if (entry.reflection && entry.reflection.trim()) {
      lines.push(`   Justification / Reflection: ${entry.reflection.trim()}`);
    }
  });

  lines.push("--------------------------------------------------------------------------------");
  lines.push(`Total Reimbursable Claim: $${totalDollars} AUD`);

  return lines.join("\n");
}

/**
 * Downloads the itemized claim pack text as a text file in the browser.
 */
export function downloadClaimPackText(entries: readonly CmeEntry[], filename = "cme-claim-pack.txt"): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const text = generateClaimPackText(entries);
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  } catch {
    return false;
  }
}

export interface CmeClaimPackButtonProps {
  readonly entries: readonly CmeEntry[];
  readonly className?: string;
  readonly filename?: string;
  readonly demoMode?: boolean;
}

export function CmeClaimPackButton({
  entries,
  className,
  filename = "cme-claim-pack.txt",
  demoMode = false,
}: CmeClaimPackButtonProps) {
  const [downloaded, setDownloaded] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const example = useExampleData("cpd").active;
  const showToast = useCopyToast();

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleExport = () => {
    if (!guardExampleAction(demoMode || example, "export")) return;
    if (claimableEntries(entries).length === 0) {
      showToast("No claimable expenses recorded for this year");
      return;
    }
    if (!downloadClaimPackText(entries, filename)) {
      showToast("Unable to download claim pack");
      return;
    }
    setDownloaded(true);
    showToast("Claim pack exported and downloaded");
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setDownloaded(false);
      resetTimerRef.current = null;
    }, 2500);
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={downloaded ? ClipboardCheck : FileText}
      onClick={handleExport}
      className={className}
      testId="cme-claim-pack-button"
    >
      {downloaded ? "Claim pack exported" : "Export claim pack"}
    </Button>
  );
}

"use client";

import { useState } from "react";
import { ClipboardCopy } from "lucide-react";

import { cn } from "@/components/ui-primitives";
import { useCopyToast } from "@/components/ui/toast";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

export function CopyAfterReviewButton({
  text,
  className,
  label = "Copy after review",
}: {
  text: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const showToast = useCopyToast();

  async function copyText() {
    try {
      await copyTextToClipboard(text);
      setCopied(true);
      showToast("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyText}
      className={cn(
        "inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent)] px-4 text-sm font-bold text-[color:var(--clinical-accent-contrast)] shadow-[var(--e2)] hover:bg-[color:var(--primary-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
        className,
      )}
    >
      <ClipboardCopy className="h-4 w-4" aria-hidden />
      {copied ? "Copied" : label}
    </button>
  );
}

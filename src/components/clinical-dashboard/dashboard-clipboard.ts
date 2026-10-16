import { useState } from "react";
import { errorCopy } from "@/lib/ui-copy";
import type { AnswerErrorKind } from "@/components/clinical-dashboard/search-utils";

export interface UseDashboardClipboardOptions {
  setError: (error: string | null) => void;
  setErrorKind: (kind: AnswerErrorKind | null) => void;
  setLastFailedQuery: (query: string | null) => void;
}

export function useDashboardClipboard({ setError, setErrorKind, setLastFailedQuery }: UseDashboardClipboardOptions) {
  const [copiedAction, setCopiedAction] = useState<string | null>(null);

  async function copyText(action: string, text: string) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textArea);
      } catch {
        copied = false;
      }
    }
    if (!copied) {
      setError(errorCopy.clipboardCopyFailed);
      setErrorKind(null);
      setLastFailedQuery(null);
      return;
    }
    setCopiedAction(action);
    window.setTimeout(() => setCopiedAction((current) => (current === action ? null : current)), 1800);
  }

  return {
    copiedAction,
    setCopiedAction,
    copyText,
  };
}

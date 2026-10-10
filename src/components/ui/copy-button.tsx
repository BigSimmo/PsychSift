"use client";

import { Clipboard, ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCopyToast } from "@/components/ui/toast";
import { copyButton } from "@/lib/ui-copy";

export type CopyButtonProps = {
  label: string;
  shortLabel?: string;
  ariaLabel?: string;
  copied: boolean;
  onClick: () => void;
  className?: string;
  testId?: string;
  disabled?: boolean;
};

/**
 * Copy control wrapping `<Button>`. The proof sites already own clipboard, so
 * this primitive injects `onClick` rather than calling `@/lib/copy-to-clipboard`.
 * Copied state swaps the icon and visible label; the accessible name stays the
 * idle label unless `ariaLabel` is passed.
 */
export function CopyButton({
  label,
  shortLabel,
  ariaLabel,
  copied,
  onClick,
  className,
  testId,
  disabled,
}: CopyButtonProps) {
  const showToast = useCopyToast();
  const idleCompact = shortLabel ?? label;
  const showCompactIdle = Boolean(shortLabel) && shortLabel !== label && !copied;

  const handleClick = () => {
    onClick();
    showToast();
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={copied ? ClipboardCheck : Clipboard}
      onClick={handleClick}
      aria-label={ariaLabel ?? label}
      className={className}
      testId={testId}
      disabled={disabled}
    >
      {showCompactIdle ? (
        <>
          <span className="sm:hidden">{idleCompact}</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : copied ? (
        copyButton.copied
      ) : (
        label
      )}
    </Button>
  );
}

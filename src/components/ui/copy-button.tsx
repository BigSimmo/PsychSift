"use client";

import { Clipboard, ClipboardCheck } from "lucide-react";

import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { useCopyToast } from "@/components/ui/toast";
import { copyButton } from "@/lib/ui-copy";

export type CopyButtonProps = {
  label: string;
  shortLabel?: string;
  ariaLabel?: string;
  copied: boolean;
  /** Return (or resolve) `false` when the copy failed, so no success toast is shown; a rejected
   *  promise is treated the same way. */
  onClick: () => void | boolean | Promise<void | boolean>;
  className?: string;
  testId?: string;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  toastTitle?: string;
  /** Set false when the caller already announces its own copy result. */
  toastOnSuccess?: boolean;
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
  variant = "secondary",
  size = "sm",
  toastTitle,
  toastOnSuccess = true,
}: CopyButtonProps) {
  const showToast = useCopyToast();
  const idleCompact = shortLabel ?? label;
  const showCompactIdle = Boolean(shortLabel) && shortLabel !== label && !copied;

  const handleClick = () => {
    const announce = (result: void | boolean) => {
      if (toastOnSuccess && result !== false) showToast(toastTitle);
    };
    const result = onClick();
    // Asynchronous clipboard writes announce only once they succeed.
    if (result instanceof Promise) void result.then(announce, () => undefined);
    else announce(result);
  };

  return (
    <Button
      variant={variant}
      size={size}
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

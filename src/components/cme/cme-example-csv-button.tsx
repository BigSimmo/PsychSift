"use client";

import type { ReactNode } from "react";

import { guardExampleAction } from "@/lib/example-data/guards";

/**
 * "Download CSV" on a page showing example records. The export route reads the account, so a plain
 * link there would hand over REAL records under made-up ones: this button only explains why the file
 * can't be made, through the shared example-data guard.
 */
export function CmeExampleCsvButton({
  className,
  testId,
  children,
}: {
  readonly className?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  return (
    <button type="button" onClick={() => guardExampleAction(true, "export")} data-testid={testId} className={className}>
      {children}
    </button>
  );
}

"use client";

import { Folder } from "lucide-react";

import { T5Icon, T5List, T5Row } from "@/components/teaching/t5-kit";

/*
 * The way into the term evidence folder: one row, a literal link to /teaching/term/folder. Mounted on the
 * Term page under the term itself; the shared frame can also place it in Teaching's More sheet.
 */
export function TermFolderEntryLink({ className }: { className?: string }) {
  return (
    <T5List ruled className={className}>
      <T5Row
        title="Evidence folder"
        meta="Your term in one place, ready to export"
        lead={<T5Icon icon={Folder} />}
        href="/teaching/term/folder"
        testId="term-folder-entry"
      />
    </T5List>
  );
}

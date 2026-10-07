"use client";

import { Download, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";

import { csvHref } from "@/components/teaching/organise-model";
import { buttonFaceClass } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import {
  FOLDER_EXPORT_DEFAULTS,
  FOLDER_PRIVACY_LINE,
  folderGaps,
  termFolderCsv,
  termFolderFileName,
  type FolderExportOptions,
  type TermFolder,
} from "@/lib/teaching/term-folder";

/*
 * Export the term folder (mock-up nf_teach_accExport): choose what goes in, names off by default, and the gaps
 * always listed first in the file, never hidden. A CSV the doctor downloads; nothing is sent anywhere.
 */

function Toggle({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  detail: string;
}) {
  const id = useId();
  return (
    <li className="relative flex min-h-13 items-center gap-3 border-t border-[color:var(--border)] px-3.5 py-2.5 first:border-t-0 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--focus)]">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <label
          htmlFor={id}
          className="cursor-pointer text-sm font-medium text-[color:var(--text-heading)] after:absolute after:inset-0"
        >
          {title}
        </label>
        <span id={`${id}-detail`} className="text-sm text-[color:var(--text-muted)]">
          {detail}
        </span>
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        aria-describedby={`${id}-detail`}
        className="relative size-5 shrink-0 accent-[color:var(--mode-identity)]"
      />
    </li>
  );
}

export function TermFolderExportSheet({
  open,
  onClose,
  folder,
  today,
  demoMode,
  onExported,
}: {
  open: boolean;
  onClose: () => void;
  folder: TermFolder;
  today: string;
  demoMode: boolean;
  onExported: () => void;
}) {
  const [options, setOptions] = useState<FolderExportOptions>(FOLDER_EXPORT_DEFAULTS);
  const toggle = (key: keyof FolderExportOptions) => setOptions((o) => ({ ...o, [key]: !o[key] }));
  const gaps = folderGaps(folder);
  return (
    <Sheet open={open} onClose={onClose} title={`Export ${folder.title}`} testId="term-folder-export">
      <div className="grid gap-3">
        <ul
          role="list"
          aria-label="What goes in"
          className="grid min-w-0 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)]"
        >
          <li className="flex min-h-13 items-center gap-3 px-3.5 py-2.5">
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm font-medium text-[color:var(--text-heading)]">Every part and its status</span>
              <span className="text-sm text-[color:var(--text-muted)]">{`${folder.parts.length} parts, gaps first. Always in`}</span>
            </span>
          </li>
          <Toggle
            checked={options.sessions}
            onChange={() => toggle("sessions")}
            title="Teaching sessions"
            detail={`${folder.sessions.length} this term, with hours`}
          />
          <Toggle
            checked={options.supervision}
            onChange={() => toggle("supervision")}
            title="Supervision entries"
            detail={`${folder.supervision.length} this term, minutes and status only`}
          />
          <Toggle
            checked={options.names}
            onChange={() => toggle("names")}
            title="Include names"
            detail="Your supervisor's name, and session titles and services. Off keeps it to counts and dates"
          />
        </ul>
        <div
          role="status"
          className={cn(
            "flex min-w-0 items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm",
            gaps.length
              ? "bg-[color:var(--warning-bg)] text-[color:var(--text)]"
              : "border border-[color:var(--border)] text-[color:var(--text-muted)]",
          )}
        >
          <TriangleAlert
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-icon-sm shrink-0",
              gaps.length ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]",
            )}
          />
          <span>
            {gaps.length
              ? `${gaps.length === 1 ? "1 gap goes" : `${gaps.length} gaps go`} in the export, listed first, never hidden: ${gaps.map((g) => g.label).join(", ")}.`
              : "No gaps. The export still lists the gaps section, as None."}
          </span>
        </div>
        <a
          href={csvHref(termFolderCsv(folder, today, options))}
          download={termFolderFileName(folder, demoMode)}
          // The download starts from this tap first. The sheet closes on the next tick, so the link is still on
          // the page when the browser acts on it (a detached link can lose its download in some browsers).
          onClick={() => window.setTimeout(onExported, 0)}
          className={cn(buttonFaceClass({ variant: "primary", block: true }), "no-underline")}
          data-testid="term-folder-csv"
        >
          <Download aria-hidden="true" className="size-icon-sm" />
          Download CSV
        </a>
        <p className="text-center text-xs text-[color:var(--text-muted)]">{FOLDER_PRIVACY_LINE}</p>
      </div>
    </Sheet>
  );
}

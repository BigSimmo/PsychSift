"use client";

import Link from "next/link";
import { FileQuestion, Search } from "lucide-react";
import { cn, commandControl } from "@/components/ui-primitives";

export default function NotFound() {
  return (
    // The global skip link in `app/layout.tsx` targets `#main-content`, which the
    // shells supply. This page bypasses them, so without this element the skip
    // link points at nothing and Enter leaves focus on the link itself — dead
    // keyboard escape on the one page reached by a mistyped or stale URL.
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen flex-col items-center justify-center bg-[color:var(--surface-lux)] px-4 font-sans text-[color:var(--text)]"
    >
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-elevated)] text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--info-soft)] text-[color:var(--info)]">
          <FileQuestion aria-hidden="true" className="h-6 w-6" />
        </div>

        <h1 className="mt-4 text-lg font-semibold tracking-tight text-[color:var(--text-heading)]">Page not found</h1>

        <p className="mt-2 text-sm text-[color:var(--text-muted)] leading-relaxed">
          The page you are looking for does not exist or may have been moved. Check the address, or head back to search.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/"
            className={cn(
              commandControl,
              "flex min-h-12 items-center justify-center gap-2 px-4 py-2 text-sm font-medium",
            )}
          >
            <Search aria-hidden="true" className="h-4 w-4" />
            Back to search
          </Link>

          <Link
            href="/documents/search"
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm font-medium text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            Browse documents
          </Link>
        </div>
      </div>
    </main>
  );
}

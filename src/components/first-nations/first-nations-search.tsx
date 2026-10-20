"use client";
// The mode's own search box: no microphone, and the text stays in component state only. Nothing is
// handed to the main search bar or OpenAI (design standard §13), stored, put in the URL or sent.
import { Search } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { searchEntries, type SearchEntry } from "@/lib/first-nations/search";

export function FirstNationsSearch({ entries }: { entries: readonly SearchEntry[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchEntries(entries, query), [entries, query]);
  const inputId = useId();
  const listId = useId();
  return (
    <div role="search" data-fn-part="search" className="grid gap-2">
      <div className="flex min-h-12 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 focus-within:outline focus-within:outline-2 focus-within:outline-[color:var(--focus)]">
        <Search className="size-icon-md text-[color:var(--text-muted)]" aria-hidden="true" />
        <label htmlFor={inputId} className="sr-only">
          Search First Nations
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder="Search First Nations"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          // Only point at the results once they exist; an id with no element is invalid ARIA.
          aria-controls={query.trim() ? listId : undefined}
          className="min-h-12 min-w-0 flex-1 bg-transparent text-sm-minus text-[color:var(--text-heading)] outline-none"
        />
      </div>
      {query.trim() ? (
        results.length ? (
          <ul
            id={listId}
            className="grid rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)]"
          >
            {results.map((r) => (
              <li key={r.id} className="border-t border-[color:var(--border)] first:border-t-0">
                <Link href={r.href} className="grid min-h-12 content-center gap-0.5 px-3 py-2">
                  <span className="text-sm-minus font-medium text-[color:var(--text-heading)]">{r.title}</span>
                  <span className="text-sm-minus text-[color:var(--text-muted)]">{r.number ?? r.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p id={listId} role="status" className="px-1 text-sm-minus text-[color:var(--text-muted)]">
            Nothing found for that.
          </p>
        )
      ) : null}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { buttonFaceClass } from "@/components/ui/button-face";

export const metadata: Metadata = {
  title: "Document Search - PsychSift",
  description: "Search indexed clinical documents and review matching evidence.",
};

export default function DocumentsSearchRoute() {
  return (
    <main className="mx-auto flex min-h-[55dvh] max-w-3xl flex-col items-center justify-center px-4 py-12 text-center">
      <p className="text-xs font-bold uppercase tracking-eyebrow text-[color:var(--clinical-accent)]">
        Indexed sources
      </p>
      <h1 className="mt-3 text-3xl font-semibold text-[color:var(--text-heading)]">Search clinical documents</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[color:var(--text-muted)]">
        Enter a query in the Documents composer to search the indexed sources. Results open the source document at the
        matching page and passage.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link href="/?mode=documents&focus=1" className={buttonFaceClass({ variant: "primary" })}>
          Open Documents search
        </Link>
      </div>
    </main>
  );
}

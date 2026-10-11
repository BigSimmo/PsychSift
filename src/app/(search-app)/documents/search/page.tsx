import type { Metadata } from "next";
import Link from "next/link";
import { buttonFaceClass } from "@/components/ui/button-face";
import { cn } from "@/components/ui-primitives";

export const metadata: Metadata = {
  title: "Document Search - PsychSift",
  description: "Search indexed clinical documents and review matching evidence.",
};

// Primary buttons wear the area colour, never the shared near-black command
// fill (design pass, October 2026). Re-pointing the command tokens on the
// button itself keeps Button's hover and pressed states and leaves every other
// control on the page alone. In forced colours the accent becomes LinkText,
// which ButtonText cannot sit on, so the native button pair comes back.
const clinicalPrimaryAccent =
  "[--command:var(--clinical-accent)] [--command-hover:var(--clinical-accent-hover)] [--command-active:var(--clinical-accent-active)] [--command-contrast:var(--clinical-accent-contrast)] forced-colors:[--command:ButtonFace] forced-colors:[--command-hover:ButtonFace] forced-colors:[--command-active:ButtonFace]";

// The empty screen's line drawing: two stacked documents and a magnifier, in
// the area colour. It repeats what the heading says, so it is hidden from
// screen readers. Fills use tokens through classes so dark mode follows.
function DocumentsSearchIllustration() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 132 84"
      className="h-21 w-33 text-[color:var(--clinical-accent)]"
      fill="none"
    >
      <rect
        x="30"
        y="14"
        width="52"
        height="64"
        rx="8"
        className="fill-[color:var(--clinical-accent-soft)]"
        stroke="currentColor"
        strokeOpacity=".35"
      />
      <rect
        x="50"
        y="6"
        width="52"
        height="64"
        rx="8"
        className="fill-[color:var(--surface-raised)]"
        stroke="currentColor"
        strokeOpacity=".6"
      />
      <path
        d="M60 22h32M60 31h32M60 40h20"
        stroke="currentColor"
        strokeOpacity=".45"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect x="58" y="47" width="28" height="9" rx="4.5" fill="currentColor" fillOpacity=".18" />
      <circle
        cx="96"
        cy="58"
        r="13"
        className="fill-[color:var(--surface-raised)]"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path d="m105 67 9 9" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export default function DocumentsSearchRoute() {
  return (
    <main className="mx-auto flex min-h-[55dvh] max-w-3xl flex-col items-center justify-center px-4 py-12 text-center">
      <DocumentsSearchIllustration />
      <p className="mt-4 text-xs font-bold uppercase tracking-eyebrow text-[color:var(--clinical-accent)]">
        Indexed sources
      </p>
      <h1 className="mt-3 text-3xl font-semibold text-[color:var(--text-heading)]">Search clinical documents</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[color:var(--text-muted)]">
        Enter a query in the Documents composer to search the indexed sources. Results open the source document at the
        matching page and passage.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/?mode=documents&focus=1"
          className={cn(buttonFaceClass({ variant: "primary" }), clinicalPrimaryAccent)}
        >
          Open Documents search
        </Link>
      </div>
    </main>
  );
}

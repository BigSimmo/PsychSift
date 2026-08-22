import { SyntheticMarker } from "@/components/caring-contacts/workspace/synthetic-marker";

export default function LoadingCaringContactsWorkspace() {
  return (
    <main aria-busy="true" className="min-h-dvh bg-[color:var(--background)] p-5">
      <p className="sr-only">Loading the Caring Contacts workspace</p>
      <div className="mx-auto w-full max-w-6xl space-y-4">
        {/* Carried here too: a screenshot of a loading state should still say
            what this workspace is, and Tasks 16-18 make it data-driven. */}
        <SyntheticMarker />
        <div className="h-12 w-56 animate-pulse rounded-[var(--radius-md)] bg-[color:var(--surface-inset)] motion-reduce:animate-none" />
        <div className="h-80 animate-pulse rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface)] motion-reduce:animate-none" />
      </div>
    </main>
  );
}

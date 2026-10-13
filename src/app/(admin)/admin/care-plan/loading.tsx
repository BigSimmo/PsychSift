/**
 * The waiting state for the whole route family. It shows the shape of the shell
 * and nothing else: inventing a name or a plan line here would put fabricated
 * clinical content on screen before any record has been read.
 */
export default function LoadingCarePlanMockup() {
  return (
    <main aria-busy="true" className="min-h-dvh bg-[color:var(--background)] p-5">
      <p className="sr-only">Loading the synthetic Care Plan prototype</p>
      <div className="mx-auto grid max-w-[74rem] gap-4">
        <div className="h-12 w-56 animate-pulse rounded-[var(--radius-md)] bg-[color:var(--surface-inset)] motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface)] motion-reduce:animate-none" />
      </div>
    </main>
  );
}

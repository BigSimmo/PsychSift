"use client";
// The reference notice stays visible; the full About sheet opens only on request.
import { useEffect, useState } from "react";
import { FnButton } from "@/components/first-nations/kit";
import { Sheet } from "@/components/ui/sheet";

export const PRIMER_EVENT = "first-nations:open-primer";

export function Primer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(PRIMER_EVENT, reopen);
    return () => window.removeEventListener(PRIMER_EVENT, reopen);
  }, []);

  const close = () => setOpen(false);

  return (
    <>
      <aside
        aria-label="First Nations reference notice"
        className="mx-auto w-full max-w-[48rem] px-3 pt-3 text-sm-minus text-[color:var(--text-muted)]"
      >
        A reference and contacts tool, not clinical decision support. Cultural content shows its source and awaits your
        service&apos;s Aboriginal health team.
      </aside>
      <Sheet open={open} onClose={close} title="About First Nations">
        <ul className="grid gap-2 text-sm-minus text-[color:var(--text)]">
          <li>A reference and contacts tool, not clinical decision support.</li>
          <li>Cultural content shows its source and awaits your service&apos;s Aboriginal health team.</li>
          <li>Nothing about any patient is saved or sent.</li>
        </ul>
        <div className="mt-3">
          <FnButton filled label="Got it" onClick={close} />
        </div>
      </Sheet>
    </>
  );
}

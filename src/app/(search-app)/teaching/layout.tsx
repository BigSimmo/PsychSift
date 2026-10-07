import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

/**
 * Teaching's frame. Example data is announced once, by the example data banner
 * the frame mounts under the band, so the layout carries no sample notice of
 * its own.
 */
export default function TeachingLayout({ children }: { children: ReactNode }) {
  return (
    <ModeBand modeId="teaching" hiddenOn={["/teaching/resources/"]}>
      {children}
    </ModeBand>
  );
}

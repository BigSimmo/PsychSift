import type { ReactNode } from "react";

import { MyDayBand } from "@/components/my-day/my-day-band";

export default function MyDayLayout({ children }: { children: ReactNode }) {
  return <MyDayBand>{children}</MyDayBand>;
}

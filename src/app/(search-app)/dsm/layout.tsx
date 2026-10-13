import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <main className="min-w-0">{children}</main>;
}

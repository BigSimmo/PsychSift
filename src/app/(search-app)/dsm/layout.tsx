import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="min-w-0">
      {children}
    </main>
  );
}

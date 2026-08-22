import type { Metadata } from "next";
import type { ReactNode } from "react";

// Listed in the live tools catalogue by the owner's decision of 19 August 2026, but never
// indexed: this workspace holds invented patients only and must not appear in a search result
// where its synthetic nature is not visible.
export const metadata: Metadata = {
  title: "Caring Contacts - Clinical KB",
  robots: { index: false, follow: false },
};

export default function CaringContactsLayout({ children }: { children: ReactNode }) {
  return children;
}

import type { Metadata } from "next";

import { SourcesCurrencyPage } from "@/components/sources/sources-currency-page";

export const metadata: Metadata = {
  title: "Currency check",
  description: "Which sources are current, which are due for review, and which reviews come up in the next six months.",
};

export default function CurrencyPage() {
  return <SourcesCurrencyPage />;
}

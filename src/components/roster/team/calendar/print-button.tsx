"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";

/** Hands the month to the browser's print dialog; the print styles do the rest. */
export function PrintButton() {
  // Example records never leave the app, printed included.
  const { active } = useExampleData("rost");
  return (
    <Button
      className="min-h-12"
      icon={Printer}
      data-print-hide
      onClick={() => {
        if (guardExampleAction(active, "export")) window.print();
      }}
    >
      Print
    </Button>
  );
}

import type { Metadata } from "next";

import { EdScreen } from "@/components/ward-management/ed/ed-screen";

export const metadata: Metadata = {
  title: "Emergency department — Ward Flow",
  description: "Synthetic single-department emergency department view for the Ward Flow prototype.",
};

export default async function EdDepartmentPage({ params }: { params: Promise<{ edId: string }> }) {
  const { edId } = await params;
  return <EdScreen edId={decodeURIComponent(edId)} />;
}

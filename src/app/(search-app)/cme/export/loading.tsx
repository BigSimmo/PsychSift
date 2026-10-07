import { WorkScreenLoading } from "@/components/work-screens/work-screen-loading";

export default function Loading() {
  return <WorkScreenLoading label="Loading your CPD export" testId="cpd-export-loading" hero rows={3} />;
}

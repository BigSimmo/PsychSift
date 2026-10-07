import { WorkScreenLoading } from "@/components/work-screens/work-screen-loading";

export default function Loading() {
  return <WorkScreenLoading label="Loading your CPD evidence" testId="cpd-evidence-loading" tiles={3} rows={3} />;
}

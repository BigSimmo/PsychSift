import { WorkScreenLoading } from "@/components/work-screens/work-screen-loading";

export default function Loading() {
  return <WorkScreenLoading label="Loading this doctor" testId="assessments-trainee-loading" hero rows={4} />;
}

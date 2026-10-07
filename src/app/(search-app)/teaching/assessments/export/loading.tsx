import { WorkScreenLoading } from "@/components/work-screens/work-screen-loading";

export default function Loading() {
  return <WorkScreenLoading label="Loading export" testId="assessments-export-loading" rows={4} />;
}

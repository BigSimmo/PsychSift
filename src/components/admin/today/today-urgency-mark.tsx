import { AdminStatusTag } from "@/components/admin/admin-status-tag";

/** The two date-state marks "Needs you" rows use: the shared status tag. */
export function TodayUrgencyMark({ state }: { state: "passed" | "not-recorded" }) {
  return <AdminStatusTag status={state === "passed" ? "date-passed" : "not-recorded"} />;
}

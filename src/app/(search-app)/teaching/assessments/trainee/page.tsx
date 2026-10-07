import { redirect } from "next/navigation";

// A doctor's page needs a doctor. Without one, the term overview lists every doctor to choose from.
export default function Page() {
  redirect("/teaching/assessments?view=overview&as=supervisor");
}

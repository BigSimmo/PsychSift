"use client";

import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import { WorkCard, WorkIconRow, WorkSectionLabel } from "@/components/mode-kit/work";
import { HOSPITAL_SECTION_ICON } from "@/components/work-screens/hospital/hospital-icons";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { useExampleData } from "@/lib/example-data/store";
import {
  exampleTeamNames,
  hospitalCardRows,
  hospitalsCovered,
  HOSPITAL_HUB_HREF,
  type HospitalCardRow,
} from "@/lib/work-roles/hospital-hub";
import { useWorkRoles } from "@/lib/work-roles/use-work-roles";

/**
 * Hospital on My Day: a compact card for people who hold a hospital role, one
 * row per role opening its main screen, and a link to Hospital. It renders
 * nothing for everyone else, and nothing while the roles are still being read,
 * so most doctors never see it. With Admin's example data switched on it shows
 * the example reader, who holds every role.
 */
export function HospitalRolesCard() {
  // Signed out there are no roles to read, so My Day makes no request for them.
  const roles = useWorkRoles(useSignedIn());
  const example = useExampleData("admin");
  // Only an explicit switch-on shows the example card: auto mode would put it on every new doctor's My Day.
  if (example.mode === "on" && example.active) return <ExampleCard />;
  if (roles.status !== "ready" || roles.grants.length === 0) return null;
  const hospital = hospitalsCovered(roles.grants)[0] ?? null;
  const rows = hospitalCardRows(roles.grants, hospital?.id ?? null);
  return <CardView rows={rows} example={false} />;
}

function ExampleCard() {
  const read = useRegistryDataset("admin.hospital", true);
  if (read.status !== "ready") return null;
  const hospital = hospitalsCovered(read.data.grants)[0] ?? null;
  const rows = hospitalCardRows(read.data.grants, hospital?.id ?? null, exampleTeamNames(read.data));
  return <CardView rows={rows} example />;
}

function CardView({ rows, example }: { readonly rows: readonly HospitalCardRow[]; readonly example: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="hospital-roles-card-label" className="contents" data-testid="hospital-roles-card">
      <WorkSectionLabel
        id="hospital-roles-card-label"
        action={{ label: "Open", href: HOSPITAL_HUB_HREF }}
      >
        Hospital
      </WorkSectionLabel>
      <WorkCard>
        {rows.map((row) => (
          <WorkIconRow
            key={row.key}
            icon={HOSPITAL_SECTION_ICON[row.id]}
            title={row.title}
            sub={row.sub}
            href={row.href}
            testId={`hospital-roles-card-${row.id}`}
          />
        ))}
      </WorkCard>
    </section>
  );
}

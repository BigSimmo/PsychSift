import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import { DocumentTagCloud } from "@/components/DocumentTagCloud";
import { buildSmartDocumentTags } from "@/lib/document-tags";

const labels = [
  { label: "clozapine", label_type: "medication", source: "generated", confidence: 0.9 },
  { label: "monitoring", label_type: "workflow", source: "generated", confidence: 0.9 },
  { label: "outpatient", label_type: "setting", source: "generated", confidence: 0.9 },
] satisfies NonNullable<ComponentProps<typeof DocumentTagCloud>["labels"]>;

describe("DocumentTagCloud interactions", () => {
  it.each([false, true])("expands %s grouped tags and activates the chosen tag by keyboard", async (grouped) => {
    const user = userEvent.setup();
    const onTagClick = vi.fn();
    const tags = buildSmartDocumentTags(labels, { includeManualGroup: true });
    render(
      <DocumentTagCloud
        labels={labels}
        compact
        grouped={grouped}
        limit={1}
        selectedTagKeys={[tags[0].key]}
        onTagClick={onTagClick}
      />,
    );

    const selected = screen.getByRole("button", { name: tags[0].label });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    // DOM contract only: the browser lane must prove actual boundary hit testing.
    expect(selected).toHaveClass("min-h-tap", "min-w-tap");
    expect(selected.className).not.toContain("before:");
    expect(selected.className).not.toContain("ring-");
    await user.tab();
    expect(selected).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onTagClick).toHaveBeenCalledWith(tags[0]);

    const disclosure = screen.getByRole("button", { name: `Show ${tags.length - 1} more document tags` });
    expect(disclosure).toHaveClass("min-h-tap", "min-w-tap");
    await user.click(disclosure);
    expect(screen.queryByRole("button", { name: /more document tags/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(tags.length);
    expect(onTagClick).toHaveBeenCalledOnce();
  });

  it("keeps noninteractive metadata out of the tab order", () => {
    render(<DocumentTagCloud labels={labels} compact expandable={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/clozapine/i)).toBeVisible();
  });
});

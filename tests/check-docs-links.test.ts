import { describe, expect, it } from "vitest";

import {
  appliedInboxFallbackPath,
  collectBundledSkillFailures,
  collectDocumentFailures,
  defaultTargets,
  markdownAnchorSlugs,
} from "../scripts/check-docs-links.mjs";

describe("bundled Cloud skill link coverage", () => {
  const target = ".claude/cloud-profile/skills/playwright-best-practices/advanced/network-advanced.md";

  it("includes nested shipped references in the normal blocking scan", () => {
    expect(defaultTargets()).toContain(target);
    expect(defaultTargets()).toContain(".claude/cloud-profile/skills/sentry-nextjs-sdk/SKILL.md");
  });

  it("catches the escaped sibling link and checks its corrected destination", () => {
    const broken = collectBundledSkillFailures({ target, markdown: "[Offline](error-testing.md#offline-testing)" });
    expect(broken.checked).toBe(1);
    expect(broken.failures).toHaveLength(1);
    const fixed = collectBundledSkillFailures({
      target,
      markdown: "[Offline](../debugging/error-testing.md#offline-testing)",
    });
    expect(fixed.checked).toBe(1);
    expect(fixed.failures).toEqual([]);
  });

  it("checks real links while ignoring fenced examples and illustrative inline code", () => {
    const markdown =
      "`src/example-only.ts`\n```md\n[Example](unbuilt-example.md)\n```\n[Real](../debugging/error-testing.md#offline-testing)";
    const result = collectBundledSkillFailures({ target, markdown });
    expect(result.checked).toBe(1);
    expect(result.failures).toEqual([]);
    expect(collectDocumentFailures({ target: "README.md", markdown: "`src/example-only.ts`" }).failures).toHaveLength(
      1,
    );
  });

  it("still rejects missing anchors and repository escapes in skill prose", () => {
    const result = collectBundledSkillFailures({
      target,
      markdown: "[Anchor](#missing-anchor) [Escape](../../../../../../outside.md)",
    });
    expect(result.checked).toBe(2);
    expect(result.failures).toHaveLength(2);
  });

  it("does not close a fenced example on a marker carrying a language label", () => {
    const markdown = [
      "```md",
      "```typescript",
      "[Example](absent-example.md)",
      "```",
      "[Real](../debugging/error-testing.md#offline-testing)",
    ].join("\n");
    const result = collectBundledSkillFailures({ target, markdown });
    expect(result.checked).toBe(1);
    expect(result.failures).toEqual([]);
  });
});

describe("appliedInboxFallbackPath", () => {
  it("maps a pending inbox UUID citation to the applied sibling", () => {
    expect(appliedInboxFallbackPath("docs/outstanding-issues-inbox/edebb730-91d9-42f5-bd93-ca2abb9678bc.json")).toBe(
      "docs/outstanding-issues-inbox/applied/edebb730-91d9-42f5-bd93-ca2abb9678bc.json",
    );
  });

  it("does not wrap an already-applied path or a nested inbox file", () => {
    expect(
      appliedInboxFallbackPath("docs/outstanding-issues-inbox/applied/edebb730-91d9-42f5-bd93-ca2abb9678bc.json"),
    ).toBeNull();
    expect(appliedInboxFallbackPath("docs/outstanding-issues-inbox/README.md")).toBeNull();
    expect(appliedInboxFallbackPath("docs/outstanding-issues.md")).toBeNull();
    expect(appliedInboxFallbackPath("docs/outstanding-issues-inbox/not-a-uuid.json")).toBeNull();
  });
});

describe("collectDocumentFailures", () => {
  // Same document shape as the #ZM8902 escape: a spec under docs/superpowers/specs/
  // linking outside every ROOT_PREFIXES prefix via a relative "../../" path.
  const target = "docs/superpowers/specs/2026-08-15-caring-contact-coordination-design.md";

  it("reports a relative link, outside every ROOT_PREFIXES prefix, to a file that has never existed", () => {
    // This is the exact link that escaped the gate before the fix: relative,
    // not repo-root-relative, pointing at a file docs/caring-contacts/design-handoff.md
    // that has never existed in this repo.
    const markdown = "Binding: see the [design handoff](../../caring-contacts/design-handoff.md).";
    const { failures, checked } = collectDocumentFailures({ target, markdown });
    expect(checked).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("../../caring-contacts/design-handoff.md");
    expect(failures[0]).toContain("docs/caring-contacts/design-handoff.md");
  });

  it("does not report the same relative-link shape when the target file exists", () => {
    // Negative control using a real repo file, so the assertion proves resolution
    // succeeded rather than merely that no logic ran.
    const markdown = "Binding: see the [design system](../../design-system/README.md).";
    const { failures, checked } = collectDocumentFailures({ target, markdown });
    expect(checked).toBe(1);
    expect(failures).toHaveLength(0);
  });

  it("counts the relative-link reference rather than silently skipping it", () => {
    // A "no failure" assertion alone cannot distinguish "resolved" from "never
    // checked" — the precise bug #ZM8902 recorded. Assert the checked count itself.
    const withLink = collectDocumentFailures({
      target,
      markdown: "[design handoff](../../caring-contacts/design-handoff.md)",
    });
    const withoutLink = collectDocumentFailures({ target, markdown: "No repo links in this document." });
    expect(withoutLink.checked).toBe(0);
    expect(withLink.checked).toBeGreaterThan(withoutLink.checked);
  });
});

describe("markdownAnchorSlugs", () => {
  it("extracts and slugifies standard and formatted headings", () => {
    const md = `
# Title

## 1. Quick Start

### Some \`code\` & [Link text](http://example.com)

## L0 — Structural (1)

### PR 1 — clinical status semantics

## Duplicate Heading

## Duplicate Heading
`;
    const slugs = markdownAnchorSlugs(md);
    expect(slugs.has("title")).toBe(true);
    expect(slugs.has("1-quick-start")).toBe(true);
    expect(slugs.has("some-code--link-text")).toBe(true);
    expect(slugs.has("l0--structural-1")).toBe(true);
    expect(slugs.has("pr-1--clinical-status-semantics")).toBe(true);
    expect(slugs.has("duplicate-heading")).toBe(true);
    expect(slugs.has("duplicate-heading-1")).toBe(true);
  });

  it("recognizes explicit HTML anchor ids and names", () => {
    const md = `
<a id="custom-target"></a>
<a name="legacy-name"></a>
<span id="span-anchor"></span>
`;
    const slugs = markdownAnchorSlugs(md);
    expect(slugs.has("custom-target")).toBe(true);
    expect(slugs.has("legacy-name")).toBe(true);
    expect(slugs.has("span-anchor")).toBe(true);
  });
});

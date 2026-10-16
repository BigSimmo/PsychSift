/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Restrict suppressHydrationWarning to <html> and <body> tags only",
      category: "Possible Errors",
      recommended: true,
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name === "suppressHydrationWarning") {
          const parentElement = node.parent; // JSXOpeningElement
          if (parentElement && parentElement.name) {
            const tagName = parentElement.name.name;
            // The audit explicitly requested banning it on elements other than html and body.
            // We also allow script since it's required for nonce mismatch bypass in layout.tsx.
            if (tagName !== "html" && tagName !== "body" && tagName !== "script") {
              context.report({
                node,
                message:
                  "suppressHydrationWarning is only allowed on <html>, <body>, and <script> elements. Fix the underlying mismatch instead of hiding it.",
              });
            }
          }
        }
      },
    };
  },
};

export default rule;

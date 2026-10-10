// Toxicity list headings ("Signs and symptoms of severe toxicity:") and the bullets listed under them.
// Shared by the extractive answer, which states a heading with its bullets, and claim support, which
// verifies such a statement against that heading and one of its bullets (owner decision, #ZZ4RAP).

// Bullets listed directly under a heading, with their wrapped lines. Blank lines between bullets are
// skipped. The list ends at a new colon-led heading, a peer "•" bullet when the heading is itself a
// "•" item, or text after a blank line or a finished item that is not a bullet.
export function bulletItemsAfter(lines: string[], headingIsBullet: boolean) {
  const marker = headingIsBullet ? /^\s*[o\-–]\s+/ : /^\s*[•o\-–]\s+/;
  const items: string[] = [];
  let sawBlank = false;
  for (const line of lines) {
    if (!line.trim()) {
      sawBlank = true;
      continue;
    }
    if (/:\s*$/.test(line) || (headingIsBullet && /^\s*•/.test(line))) break;
    if (marker.test(line)) items.push(line.replace(marker, ""));
    else if (items.length > 0 && !sawBlank && !/(?<!\b(?:e\.g|i\.e))[.!?]\s*$/i.test(items[items.length - 1]))
      items[items.length - 1] += ` ${line}`;
    else break;
    sawBlank = false;
  }
  return items;
}

// Only a heading that introduces a list of signs, features or contributors carries over; an action
// heading ("If lithium toxicity is suspected:") never turns its steps into a features list.
export const toxicityListHeadingPattern =
  /\b(?:signs?|symptoms?|features?|presentation|risk factors?|contributors?|causes?)\b[^:]*\btoxic\w*[^:]*:\s*$/i;
export const toxicityActionHeadingPattern = /\b(?:if|when|suspected|manage\w*|action|steps?|withhold|escalat\w*)\b/i;

/** "Heading bullet" passages for each toxicity list heading in source text, one per bullet. */
export function toxicityHeadingBulletPassages(content: string | null | undefined) {
  if (!content) return [];
  const lines = content.split("\n");
  return lines.flatMap((line, index) => {
    if (!toxicityListHeadingPattern.test(line) || toxicityActionHeadingPattern.test(line)) return [];
    const heading = line.replace(/^[\s•]+/, "").trim();
    return bulletItemsAfter(lines.slice(index + 1), /^\s*•/.test(line)).map((item) => `${heading} ${item.trim()}`);
  });
}

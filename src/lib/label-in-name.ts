/**
 * WCAG 2.5.3 Label in Name: a control's spoken name must contain the words it shows,
 * in the same order, so a voice-control user can say what they see.
 *
 * Words are compared the way axe-core's `label-content-name-mismatch` rule compares
 * them: case-folded, punctuation and parenthetical asides dropped, and the visible
 * words must appear as one unbroken run inside the name.
 */
function words(text: string): string[] {
  let stripped = text.normalize("NFKD");
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(/\([^()]*\)/g, "");
  } while (stripped !== previous);
  return stripped
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function nameContainsLabel(name: string, visibleLabel: string): boolean {
  const label = words(visibleLabel);
  if (label.length === 0) return true;
  const spoken = words(name);
  for (let start = 0; start + label.length <= spoken.length; start += 1) {
    if (label.every((word, offset) => spoken[start + offset] === word)) return true;
  }
  return false;
}

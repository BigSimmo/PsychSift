/** Dated evidence stays historical unless its header explicitly opts into maintenance. */
export function isMaintainedDatedDocument(markdown) {
  return /^\*\*Status:\*\*\s+(?:maintained|active|current)\b/im.test(markdown.slice(0, 4096));
}

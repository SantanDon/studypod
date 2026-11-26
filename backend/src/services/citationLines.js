// The source viewer numbers the original stored text by LF, including blank lines.
export function locateCitationLines(content, excerpt) {
  if (typeof content !== "string" || typeof excerpt !== "string" || !excerpt.trim()) return {};
  const words = excerpt.trim().split(/\s+/);
  const pattern = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const search = new RegExp(pattern, "giu");
  const match = search.exec(content);
  if (!match) return {};
  // A repeated passage has no single location, including overlapping matches.
  search.lastIndex = match.index + (content.codePointAt(match.index) > 0xffff ? 2 : 1);
  if (search.exec(content)) return {};
  let startLine = 1;
  let endLine = 1;
  const end = match.index + match[0].length;
  for (let offset = content.indexOf("\n"); offset >= 0 && offset < end; offset = content.indexOf("\n", offset + 1)) {
    if (offset < match.index) startLine++;
    endLine++;
  }
  return { chunk_lines_from: startLine, chunk_lines_to: endLine };
}

/** Only complete supplied paragraphs can enter spoken evidence. Model output selects IDs, never narration. */
export interface EvidencePassage { id: string; text: string }
export function indexPodcastEvidence(content: string, budget = 12000) {
  const passages: EvidencePassage[] = [];
  let used = 0;
  let omitted = /^COVERAGE: partial;/m.test(content);
  // A positional excerpt can sever the clause containing a qualification. Fail closed.
  if (/\[(?:\.\.\.\s*excerpt gap|focused excerpt;|Excerpt unavailable)/i.test(content)) {
    throw new Error('Podcast evidence contains incomplete excerpts. Select a shorter source or complete passage before generating audio.');
  }
  const blocks = content.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const text = block.replace(/^(?:SOURCE|STRUCTURE|COVERAGE):[^\n]*(?:\n|$)/gm, '')
      .replace(/^\[(?:Source|Opening|BOOK\s[^\]\n]*|CHAPTER\s[^\]\n]*|PART\s[^\]\n]*|INTRODUCTION[^\]\n]*)\]\s*\n?/gm, '').trim();
    if (!text) continue;
    // Do not split a paragraph: qualifiers and a planned/result distinction must remain together.
    if (text.length > 4000 || used + text.length > budget || passages.length >= 60) { omitted = true; continue; }
    const id = `p${passages.length + 1}`;
    passages.push({id, text});
    used += text.length;
  }
  if (!passages.length) throw new Error('No complete source passages fit the podcast budget. Select a shorter source or complete passage.');
  return {passages, budgetedChars: used, excerpted: omitted};
}
export function compilePodcastEvidence(response: string, passages: EvidencePassage[], host1: string, host2: string, solo: boolean, ceiling: number) {
  let value: unknown;
  const fenced = response.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  try { value = JSON.parse(fenced ? fenced[1] : response.trim()); }
  catch { throw new Error('Provider output was not valid episode JSON. Expected a passageIds evidence plan.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid podcast evidence plan.');
  const plan = value as Record<string, unknown>;
  if (Object.keys(plan).length !== 1 || !Array.isArray(plan.passageIds) || !plan.passageIds.length || plan.passageIds.length > 60) {
    throw new Error('Invalid podcast evidence plan: only a nonempty passageIds array is accepted; model-written narration is forbidden.');
  }
  const ids = plan.passageIds;
  if (ids.some(id => typeof id !== 'string' || !passages.some(p => p.id === id)) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid podcast evidence plan: unknown or duplicate passage ID.');
  }
  const selected = passages.filter(p => ids.includes(p.id)); // Preserve source order even if the plan reverses it.
  const second = solo ? host1 : host2;
  const segments = [{speaker: host1, text: 'Let’s explore selected source passages in their own words. This guided reading covers only these passages, not the entire source. Questions are prompts for reflection, not reported findings.'}];
  for (const [index, passage] of selected.entries()) {
    segments.push({speaker: second, text: `Here is source passage ${index + 1}. Listen for what it states and any limits it gives.`});
    segments.push({speaker: host1, text: passage.text});
    segments.push({speaker: second, text: 'What is stated here, and what remains uncertain? Keep plans, predictions, and questions separate from reported results.'});
  }
  segments.push({speaker: host1, text: 'That ends our selected passages. Return to the source for context before drawing further conclusions.'});
  const words = segments.reduce((sum, segment) => sum + segment.text.split(/\s+/).filter(Boolean).length, 0);
  if (words > ceiling) throw new Error('The selected passages exceeded the podcast depth limit. Select fewer passages or a greater depth; nothing was truncated.');
  return {title: 'Guided source discussion', segments, words, evidencePassageIds: selected.map(p => p.id)};
}

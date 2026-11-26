const stop = new Set('what when where which should would could the a an do does did i my to on how from me we is in for and of it can you am supposed planned plan scheduled schedule activity activities please guide says say happen happens day'.split(' '));
const words = text => (text.toLowerCase().replace(/['’]s\b/g, '').match(/[a-z0-9]+/g) || []).filter(word => !stop.has(word));
const weekdays = new Set('monday tuesday wednesday thursday friday saturday sunday'.split(' '));

export function matchPassage(question, passages) {
  let query = [...new Set(words(question))];
  const days = query.filter(term => weekdays.has(term));
  if (days.length > 1) return null;
  const candidates = days.length
    ? passages.filter(passage => passage.heading.toLowerCase() === days[0])
    : passages;
  if (days.length) {
    query = query.filter(term => term !== days[0]);
    if (!query.length) return candidates.length === 1 ? candidates[0] : null;
  }
  let best = null;
  let high = 0;
  for (const passage of candidates) {
    const terms = new Set(words(passage.heading + ' ' + passage.quote));
    const score = query.filter(word => terms.has(word)).length;
    if (score > high && score >= Math.ceil(query.length / 2)) { high = score; best = passage; }
    else if (score && score === high) best = null;
  }
  return best;
}

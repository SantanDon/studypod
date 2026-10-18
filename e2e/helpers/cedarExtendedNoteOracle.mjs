// Independent oracle for studio-extended's four requested facts. This fixture
// intentionally differs from the full-flow photosynthesis/control fixture.
export const cedarExtendedSourceFacts = [
  'The Cedar experiment uses 17 blue trays.',
  'Each tray receives six hours of light daily.',
  'The control group uses plain water.',
  'The treatment group uses nutrient solution.',
];
const facts = [
  { id: 'tray-count', positive: /\b(?:17|seventeen)\s+(?:blue\s+)?trays\b/i },
  { id: 'daily-light', positive: /(?:\b(?:six|6)[ -](?:hours?|hrs?)\b.{0,70}\blight\b|\blight\b.{0,70}\b(?:six|6)[ -](?:hours?|hrs?)\b)/i, daily: /\b(?:daily|each day|every day|per day)\b/i },
  { id: 'plain-water-control', positive: /\bcontrol(?: group)?\b.{0,70}\bplain water\b|\bplain water\b.{0,70}\bcontrol(?: group)?\b/i },
  { id: 'nutrient-treatment', positive: /\btreatment(?: group)?\b.{0,70}\bnutrient (?:solution|water)\b|\bnutrient (?:solution|water)\b.{0,70}\btreatment(?: group)?\b/i },
];
const number = '(?:[-+]?\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[ -]\\w+)?)';
// Exempt only explicit, bounded denials of a wrong relationship. Other
// negation remains fail-closed; a negated source fact still cannot satisfy it.
function deniesWrongRelation(relation) {
  return /^(?:control|treatment)(?: group)?\s+(?:does not (?:use|receive)|doesn['’]t (?:use|receive)|never (?:uses|receives))\s+(?:nutrient (?:solution|water)|plain water)$/i.test(relation)
    || /^(?:nutrient (?:solution|water)|plain water)\s+is not (?:used|received) by\s+(?:the\s+)?(?:control|treatment)(?: group)?$/i.test(relation);
}
function affirmsWrongRelation(text, expression) {
  return [...text.matchAll(expression)].some(match => (!deniesWrongRelation(match[0]) || text.slice(match.index + match[0].length).trim() !== ''));
}
function deniedQuantity(text, index) {
  return /\b(?:not|never)(?:\s+(?:supplied|provided)\s+for)?\s+(?:exactly\s+)?$/i.test(text.slice(0, index));
}
// Unknown relation verbs, quantity syntax and modifiers are unaudited.
function supportedMaterialRelation(text, subject, material) {
 const s = '(?:the )?' + subject + '(?: group)?';
 return new RegExp('^(?:' + s + ' (?:uses|receives|is given) ' + material + '|' + material + ' is (?:used|received) by ' + s + ')$', 'i').test(text);
}
function unsupportedSourceRelation(text) {
 if (/\bcontrol(?: group)?\b/i.test(text) && /\bplain water\b/i.test(text)) return !supportedMaterialRelation(text, 'control', 'plain water');
 if (/\btreatment(?: group)?\b/i.test(text) && /\bnutrient (?:solution|water)\b/i.test(text)) return !supportedMaterialRelation(text, 'treatment', 'nutrient (?:solution|water)');
 return false;
}
function supportedQuantityClaim(text) {
 const count = '(?:17|seventeen)', duration = '(?:6|six)[ -](?:hours?|hrs?)', daily = '(?:daily|each day|every day|per day)';
 const tray = new RegExp('^(?:(?:the (?:cedar )?(?:experiment|trial|study)) (?:uses|has|contains) ' + count + ' blue trays|(?:there are )?' + count + ' blue trays(?: are used)?)$', 'i');
 const light = new RegExp('^(?:(?:(?:each|every) tray|(?:the )?trays) (?:receives?|gets?|is given) ' + duration + ' of light ' + daily + '|light is (?:provided|supplied) for ' + duration + ' ' + daily + ')$', 'i');
 const denied = /^(?:there are (?:not|never) (?:exactly )?(?:\d+|\w+) (?:blue )?trays|light is not (?:supplied|provided) for (?:\d+|\w+) hours (?:daily|each day|every day|per day))$/i;
 return tray.test(text) || light.test(text) || denied.test(text);
}
export function auditCedarExtendedNote(content) {
  const clauses = String(content).replace(/[*_`#]/g, '').split(/(?<!\d)\.|\.(?!\d)|[!?;\n]+|\b(?:while|whereas|and|but)\s+(?:the\s+)?(?=(?:control|treatment)(?: group)?\b)/i).map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const missing = facts.filter(fact => !clauses.some(text => fact.positive.test(text) && !unsupportedSourceRelation(text) && (!fact.daily || fact.daily.test(text)) && !/\b(?:not|never|no longer|incorrect|false)\b|n['’]t\b/i.test(text))).map(fact => fact.id);
  const contradictions = [];
  for (const text of clauses) {
    if (unsupportedSourceRelation(text)) contradictions.push('unsupported-source-relation');
    if ((/\b(?:hours?|hrs?)\b/i.test(text) || /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b.{0,20}\btrays\b/i.test(text)) && !supportedQuantityClaim(text)) contradictions.push('unsupported-quantity-claim');
    // Explicit alternative tray colors contradict the blue-tray fixture.
    for (const match of text.matchAll(/\b(?:trays?\s+(?:are|is|were|was)\s+(?:red|green|yellow|orange|purple|black|white|brown|pink|gray|grey)|(?:red|green|yellow|orange|purple|black|white|brown|pink|gray|grey)\s+trays?)\b/gi)) {
      if (!deniedQuantity(text, match.index)) contradictions.push('wrong-tray-color');
    }
    if (facts.some(fact => fact.positive.test(text)) && /\b(?:not|never|no longer|incorrect|false)\b|n['’]t\b/i.test(text)) contradictions.push('negated-source-fact');
    for (const match of text.matchAll(new RegExp('(?<![\\w.])(' + number + ')\\s+(?:blue\\s+)?trays\\b', 'gi'))) if (!/^(?:17|seventeen)$/i.test(match[1]) && !deniedQuantity(text, match.index)) contradictions.push('wrong-tray-count');
    if (/\blight\b/i.test(text)) for (const match of text.matchAll(new RegExp('(?<![\\w.])(' + number + ')[ -](?:hours?|hrs?)\\b', 'gi'))) if (!/^(?:6|six)$/i.test(match[1]) && !deniedQuantity(text, match.index)) contradictions.push('wrong-light-duration');
    if (affirmsWrongRelation(text, /\bcontrol(?: group)?\b.{0,70}?\bnutrient (?:solution|water)\b|\bnutrient (?:solution|water)\b.{0,70}?\bcontrol(?: group)?\b/gi)) contradictions.push('nutrient-control');
    if (affirmsWrongRelation(text, /\btreatment(?: group)?\b.{0,70}?\bplain water\b|\bplain water\b.{0,70}?\btreatment(?: group)?\b/gi)) contradictions.push('plain-water-treatment');
  }
  return { requiredFacts: facts.map(fact => fact.id), missing, contradictions: [...new Set(contradictions)] };
}

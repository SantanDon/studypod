export type MapConnection = { source: string; target: string; label: string };

// Check directed, affirmative relationships against the independent Cedar fixture.
// Whole labels prevent a negated or merely modal edge from earning factual credit.
export function supportedCedarConnection({ source, target, label }: MapConnection): boolean {
  const verb = label.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  const relations = [
    { source: /^bean seedlings?$/i, target: /^light(?: exposure)?$/i, verb: /^receives?$/ },
    { source: /\b(?:blue )?trays?\b/i, target: /\bbean seedlings?\b/i, verb: /^(?:houses?|contains?)$/ },
    { source: /\bchlorophyll\b/i, target: /\blight\b/i, verb: /^(?:absorbs?|captures?)$/ },
    { source: /\bphotosynthesis\b/i, target: /\b(?:sugars?|glucose|oxygen)\b/i, verb: /^(?:produces?|creates?|releases?|results in)$/ },
    { source: /\bphotosynthesis\b/i, target: /\b(?:water|carbon dioxide|co2)\b/i, verb: /^(?:requires?|uses?|consumes?)$/ },
    { source: /\blight\b/i, target: /\bphotosynthesis\b/i, verb: /^(?:supports?|enables?)$/ },
  ];
  return relations.some(relation => relation.source.test(source) && relation.target.test(target) && relation.verb.test(verb));
}

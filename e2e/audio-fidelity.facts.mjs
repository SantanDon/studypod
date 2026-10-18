// Predeclared Cedar source facts shared by the browser gate and its unit checks.
export const facts = [
 { id: 'trays', pattern: '(?:17|seventeen) blue trays', forbiddenPatterns: ['(?:16|sixteen|18|eighteen) blue trays'] },
 { id: 'seedlings', pattern: '(?:three|3) bean seedlings', forbiddenPatterns: ['(?:two|2|four|4) bean seedlings'] },
 { id: 'light', pattern: '(?:six|6) hours (?:daily|of daily light)', forbiddenPatterns: ['(?:seven|7|five|5) hours (?:daily|of daily light)'] },
 { id: 'duration', pattern: '(?:fourteen|14) days', forbiddenPatterns: ['(?:thirteen|13|fifteen|15) days'] },
  { id: 'control', pattern: "\\bcontrol(?: group)? receive(?:s)? (?:the same|identical) (?:amount of |measured )?water,? but (?:absolutely )?no light\\b", forbiddenPatterns: ["\\bcontrol(?: group)? receive(?:s)? (?:the same|identical) (?:amount of |measured )?water,? (?:and|with|but) (?:some )?light\\b","\\bcontrol(?: group)? receive(?:s)? (?:different|unequal|more|less) (?:amounts? of )?water\\b"] },
];

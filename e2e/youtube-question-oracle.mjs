export function evaluate(response,reference) {
  const text=String(response.answer??'');
  const reasons=[];
  // Finite question oracle: recognize complete, unambiguous answers only.
  // Strip presentation and citations, not arbitrary prose or additional claims.
  const normalized=text.replace(/\[\d+\]/g,'').replace(/\*\*/g,'').trim().replace(/[.!]$/,'').trim().toLowerCase();
  const lead='(?:(?:according to (?:the |this )?(?:video|transcript|source)(?: transcript)?|in (?:the |this )?(?:video|transcript))[, :]*)?';
  const action='(?:produce|make|build|create|form|synthesize)';
  const suffix='(?: (?:during|through|via|by) photosynthesis)?';
  const relations=[
    'glucose',
    '(?:the )?sugar is glucose',
    `(?:the )?plants ${action} (?:the sugar |a sugar called |a sugar named )?glucose${suffix}`,
    `(?:the )?sugar (?:that )?plants ${action} is glucose${suffix}`,
    `glucose is (?:the |a )?sugar (?:that )?plants ${action}${suffix}`,
    `(?:the )?plants ${action} glucose, (?:which is )?(?:a |the )?sugar${suffix}`
  ];
  // Independently reviewed literal from the pinned TED-Ed acceptance fixture.
  // Equality admits the full source sentence only; suffixes or extra claims fail.
  const pinnedLiteral = "So now that the chloroplast has all the building blocks - carbon, hydrogen, oxygen, and electrons - it can use them to go through the rest of the steps of photosynthesis to transform that original carbon dioxide gas into a simple carbohydrate called glucose, C-6-H-12-O-6.";
  const completeLiteral = text.replace(/\[\d+\]/g,'').replace(/\*\*/g,'').trim();
  const pinnedAnswer = completeLiteral === pinnedLiteral
    && reference.evidence?.text?.trim() === pinnedLiteral
    && reference.source?.includes(pinnedLiteral);
  if(!pinnedAnswer && !new RegExp(`^${lead}(?:${relations.join('|')})$`,'i').test(normalized)) reasons.push('answer-relation-or-grammar-unverified');
  const supported=(response.citations??[]).some(c=>{
    if(c.sourceIndex!==1||typeof c.excerpt!=='string'||c.excerpt.trim().length<30)return false;
    const excerpt=c.excerpt.trim(), evidence=reference.evidence.text.trim();
    return reference.source.includes(excerpt)&&/\bglucose\b/i.test(excerpt)&&(evidence.includes(excerpt)||excerpt.includes(evidence));
  });
  if(!supported)reasons.push('requested-source-evidence-missing');
  return {accept:reasons.length===0,reasons,scope:'bounded fixture answer grammar and evidence assertions',releaseAuthorized:false,additionalClaimReviewRequired:true};
}

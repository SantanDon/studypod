/** Manually reviewed evidence catalogue. Patterns select exact retained-source spans, never provider output. */
export const proseProfiles = {
  cedar: {
    trays: /(?:The Cedar experiment uses exactly |(?:The )?Cedar experiment uses exactly )(?:17|seventeen) blue trays[.!]?/i,
    seedlings: /Each tray contains (?:three|3) bean seedlings[.!]?/i,
    light: /The seedlings receive light for (?:six|6) hours daily[.!]?/i,
    water: /Water is measured every morning[.!]?/i,
    pigment: /Chlorophyll absorbs light during photosynthesis[.!]?/i,
    conversion: /Plants use carbon dioxide and water to produce sugars and release oxygen[.!]?/i,
    control: /The experimental control receives the same water but no light[.!]?/i,
    comparison: /Researchers compare growth after (?:fourteen|14) days[.!]?/i,
  },
  'wikipedia-photosynthesis': {
    production: /The carbohydrates produced are stored in or used by the plant[.!]?/i,
    definition: /(?:Photosynthesis\[note 1\] is a system of biological processes by which photopigment-bearing autotrophic organisms, such as most plants, algae and cyanobacteria, convert light energy[\u2014\uFFFD]typically from sunlight[\u2014\uFFFD]into the chemical energy necessary to fuel their metabolism|Photosynthesis is a biological process by which photopigment-bearing autotrophic organisms convert light energy into chemical energy to fuel their metabolism)[.!]?/i,
    storage: /(?:Photosynthetic organisms store the converted chemical energy within the bonds of intracellular organic compounds \(complex compounds containing carbon\), typically carbohydrates like sugars \(mainly glucose, fructose and sucrose\), starches, phytoglycogen and cellulose|(?:These |The )?organisms store (?:the )?(?:converted |this )?chemical energy (?:within|in) (?:the )?bonds of intracellular organic compounds, (?:typically|primarily) carbohydrates (?:such as|like) sugars (?:\(glucose, fructose, sucrose\)|\(glucose, fructose and sucrose\)), starches, phytoglycogen, and cellulose)[.!]?/i,
    evolution: /(?:The )?first photosynthetic organisms probably evolved early in the evolutionary history of life(?: using reducing agents such as hydrogen or hydrogen sulfide, rather than water, as sources of electrons)?[.!]?/i,
    oxygenation: /(?:Cyanobacteria appeared later; the excess oxygen they produced contributed directly to the oxygenation of the Earth,\[8\] which rendered the evolution of complex life possible|Cyanobacteria appeared later(?: than early photosynthetic organisms)?; their production of excess oxygen directly contributed to the oxygenation of (?:the )?Earth, making the evolution of complex life possible)[.!]?/i,
  },
  'ted-photosynthesis': {
    percentage: /(?:Well, )?(?:About|Approximately) 60\s*% of the food you eat (?:every day )?is (?:made up of )?carbohydrates[.!]?/i,
    stomata: /(?:Plants |They )?(?:absorb|take in|get) carbon dioxide from the air through (?:tiny )?pores in their leaves called stomata[.!]?/i,
    airCarbonDioxide: /It actually all starts with the air you are exhaling this very minute, specifically the carbon dioxide molecules\./i,
    skinStomata: /Plants are going to breath in this very same carbon dioxide through pores in their skin, called stomata\./i,
    rootBuildingBlocks: /Plants drink in water from their roots to get the needed oxygen and hydrogen atoms, and their electrons, in order to build carbohydrates\./i,
    cellulose: /Cellulose is a type of carbohydrate found in plants that our body cannot break down[.!]?/i,
    fiber: /We call it fiber and we eat it in vegetables like lettuce, broccoli, and celery[.!]?/i,
    strength: /Plants use cellulose to keep themselves strong[.!]?/i,
  },
};

// Independently retained TED sentences; keep skin evidence separate from synthetic leaf evidence.
export const retainedTedInputs = 'It actually all starts with the air you are exhaling this very minute, specifically the carbon dioxide molecules. Plants are going to breath in this very same carbon dioxide through pores in their skin, called stomata. Plants drink in water from their roots to get the needed oxygen and hydrogen atoms, and their electrons, in order to build carbohydrates.';

// These synthetic fixtures exercise the pure checker; they do not replace live retained sources.
export const proseFixtureSources = {
  cedar: 'The Cedar experiment uses exactly 17 blue trays. Each tray contains three bean seedlings. The seedlings receive light for six hours daily. Water is measured every morning. Chlorophyll absorbs light during photosynthesis. Plants use carbon dioxide and water to produce sugars and release oxygen. The experimental control receives the same water but no light. Researchers compare growth after fourteen days.',
  'wikipedia-photosynthesis': 'The carbohydrates produced are stored in or used by the plant. Photosynthesis is a biological process by which photopigment-bearing autotrophic organisms convert light energy into chemical energy to fuel their metabolism. These organisms store the converted chemical energy within the bonds of intracellular organic compounds, typically carbohydrates such as sugars (glucose, fructose, sucrose), starches, phytoglycogen, and cellulose. The first photosynthetic organisms probably evolved early in the evolutionary history of life. Cyanobacteria appeared later; their production of excess oxygen directly contributed to the oxygenation of Earth, making the evolution of complex life possible.',
  'ted-photosynthesis': 'About 60% of the food you eat is carbohydrates. Plants absorb carbon dioxide from the air through pores in their leaves called stomata. Cellulose is a type of carbohydrate found in plants that our body cannot break down. We call it fiber and we eat it in vegetables like lettuce, broccoli, and celery. Plants use cellulose to keep themselves strong.',
};

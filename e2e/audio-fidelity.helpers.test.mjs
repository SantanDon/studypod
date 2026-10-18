import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, compareFacts, wordErrorRate, sha256 } from './audio-fidelity.helpers.mjs';
import { facts as cedarFacts } from './audio-fidelity.facts.mjs';

const facts = [{ id: 'trays', pattern: '(?:17|seventeen) blue trays', forbiddenPatterns: ['(?:18|eighteen) blue trays'] }];
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'studypod-fidelity-contract-'));
  const audio = Buffer.from('RIFF0000WAVEcontract-header-only');
  const manifest = { syntheticReference: true, kind: 'podcast', audioPath: 'audio.wav', audioSha256: sha256(audio), sourcePath: 'source.txt', scriptPath: 'script.txt', facts };
  writeFileSync(join(directory, 'audio.wav'), audio);
  writeFileSync(join(directory, 'source.txt'), 'Exactly 17 blue trays.');
  writeFileSync(join(directory, 'script.txt'), 'Exactly seventeen blue trays.');
  const path = join(directory, 'manifest.json');
  const save = () => writeFileSync(path, JSON.stringify(manifest));
  save();
  try { run({ directory, manifest, path, save }); } finally { rmSync(directory, { recursive: true, force: true }); }
}
// Header fixtures test manifest validation only; never passed to an audio model.
test('resolves reference artifacts relative to manifest and preserves byte hash', () => fixture(({ path }) => {
  const loaded = loadManifest(path);
  assert.equal(loaded.format[1], 'audio/wav');
  assert.equal(sha256(loaded.audio), loaded.manifest.audioSha256);
}));
test('rejects altered download bytes before browser execution', () => fixture(({ directory, path }) => {
  writeFileSync(join(directory, 'audio.wav'), 'changed bytes');
  assert.throws(() => loadManifest(path), /hash does not match/);
}));
test('rejects mislabeled unsupported binary container', () => fixture(({ directory, manifest, path, save }) => {
  const audio = Buffer.from('this is not playable media');
  writeFileSync(join(directory, 'audio.wav'), audio); manifest.audioSha256 = sha256(audio); save();
  assert.throws(() => loadManifest(path), /Unrecognized download container/);
}));
test('rejects non-synthetic evidence, absent source facts and empty matching regex', () => fixture(({ manifest, path, save }) => {
  manifest.syntheticReference = false; save(); assert.throws(() => loadManifest(path), /synthetic/);
  manifest.syntheticReference = true; manifest.facts = [{ id: 'absent', pattern: '99 trays' }]; save(); assert.throws(() => loadManifest(path), /missing/);
  manifest.facts = [{ id: 'vacuous', pattern: '.*' }]; save(); assert.throws(() => loadManifest(path), /empty text/);
}));
test('distinguishes script omission from speech loss and flags contradictory script or speech', () => {
  assert.equal(compareFacts(facts, '17 blue trays', 'No trays.', '17 blue trays')[0].script, false);
  assert.equal(compareFacts(facts, '17 blue trays', '17 blue trays', '17 blutues')[0].speechTranscript, false);
  const mixed = compareFacts(facts, '17 blue trays', '17 blue trays and 18 blue trays', '17 blue trays and eighteen blue trays')[0];
  assert.equal(mixed.scriptContradicted, true); assert.equal(mixed.contradicted, true);
});
test('word error diagnostic normalizes punctuation but records omissions', () => {
  assert.equal(wordErrorRate('Blue trays!', 'blue trays').rate, 0);
  assert.equal(wordErrorRate('seventeen blue trays', 'blue trays').edits, 1);
  assert.equal(wordErrorRate('', 'words').rate, null);
});

test('actual Cedar light gate accepts source and spoken daily-light paraphrases', () => {
  const light = cedarFacts.find(fact => fact.id === 'light');
  for (const phrase of ['six hours daily', '6 hours daily', 'six hours of daily light', '6 hours of daily light']) {
    const [result] = compareFacts([light], 'six hours daily', phrase, phrase);
    assert.equal(result.source, true);
    assert.equal(result.script, true, phrase);
    assert.equal(result.speechTranscript, true, phrase);
    assert.equal(result.scriptContradicted, false);
    assert.equal(result.contradicted, false);
  }
});

test('actual Cedar light gate rejects incorrect quantities including mixed correct and wrong claims', () => {
  const light = cedarFacts.find(fact => fact.id === 'light');
  for (const phrase of ['five hours daily', '7 hours daily', 'five hours of daily light', '7 hours of daily light']) {
    const [wrong] = compareFacts([light], 'six hours daily', phrase, phrase);
    assert.equal(wrong.script, false, phrase);
    assert.equal(wrong.speechTranscript, false, phrase);
    assert.equal(wrong.scriptContradicted, true, phrase);
    assert.equal(wrong.contradicted, true, phrase);
    const [mixed] = compareFacts([light], 'six hours daily', `six hours daily; ${phrase}`, `6 hours of daily light; ${phrase}`);
    assert.equal(mixed.scriptContradicted, true, phrase);
    assert.equal(mixed.contradicted, true, phrase);
  }
});

test('actual Cedar control gate accepts group paraphrase and rejects light or different water', () => {
  const control = cedarFacts.find(fact => fact.id === 'control');
  for (const subject of ['control', 'control group']) {
    const phrase = `${subject} receives the same water but no light`;
    const [positive] = compareFacts([control], 'control receives the same water but no light', phrase, phrase);
    assert.equal(positive.script && positive.speechTranscript, true, phrase);
    assert.equal(positive.scriptContradicted || positive.contradicted, false);
    for (const connector of ['and', 'with']) {
      const wrong = `${subject} receives the same water ${connector} light`;
      const [negative] = compareFacts([control], phrase, wrong, wrong);
      assert.equal(negative.script || negative.speechTranscript, false, wrong);
      assert.equal(negative.scriptContradicted && negative.contradicted, true, wrong);
      const [mixed] = compareFacts([control], phrase, `${phrase}; ${wrong}`, `${phrase}; ${wrong}`);
      assert.equal(mixed.scriptContradicted && mixed.contradicted, true, wrong);
    }
    const wrongWater = `${subject} receives different water but no light`;
    const [differentWater] = compareFacts([control], phrase, wrongWater, wrongWater);
    assert.equal(differentWater.script || differentWater.speechTranscript, false, wrongWater);
  }
});


test('control gate preserves explicit negation with absolutely and rejects semantic loss', () => {
  const control = cedarFacts.find(fact => fact.id === 'control');
  const source = 'control receives the same water but no light';
  const good = 'control receives the same amount of water but absolutely no light';
  const [positive] = compareFacts([control], source, good, good);
  assert.equal(positive.script && positive.speechTranscript, true);
  assert.equal(positive.scriptContradicted || positive.contradicted, false);
  for (const bad of [
    'control receives the same amount of water but absolutely light',
    'control receives the same amount of water but not absolutely no light',
    'control receives different water but absolutely no light',
    'control receives the same amount of water',
    'absolutely no light',
    'control receives the same amount of water but almost no light',
    'control receives the same amount of water but some light',
  ]) {
    const [negative] = compareFacts([control], source, bad, bad);
    assert.equal(negative.script || negative.speechTranscript, false, bad);
  }
  for (const bad of ['control receives the same amount of water but some light', 'control receives different water']) {
    const [mixed] = compareFacts([control], source, `${good}; ${bad}`, `${good}; ${bad}`);
    assert.equal(mixed.scriptContradicted && mixed.contradicted, true, bad);
  }
});

import { auditCedarAudioGrounding, cedarAudioSourceSha256 } from './audio-fidelity.helpers.mjs';
const audioSource = 'Synthetic StudyPod acceptance material. The Cedar experiment uses exactly 17 blue trays. Each tray contains three bean seedlings. The seedlings receive light for six hours daily. Water is measured every morning. Chlorophyll absorbs light during photosynthesis. Plants use carbon dioxide and water to produce sugars and release oxygen. The experimental control receives the same water but no light. Researchers compare growth after fourteen days. No private or copyrighted course material is included.';
test('audio oracle is bound to exact source fixture and accepts complete source', () => {
  assert.equal(sha256(audioSource), cedarAudioSourceSha256);
  assert.equal(auditCedarAudioGrounding(audioSource, audioSource).passed, true);
  assert.equal(auditCedarAudioGrounding(audioSource + ' ', audioSource).passed, false);
});
const faithfulAudio = 'Welcome to Synthetic StudyPod. Today, we discuss the Cedar experiment. The experiment uses seventeen blue trays. Each tray has three bean seedlings. These plants receive light for six hours each day. Water is measured every morning. Chlorophyll absorbs light. During photosynthesis, plants use carbon dioxide and water to produce sugars and release oxygen. The control group receives identical water but absolutely no light. Growth will be compared after two weeks. The supplied source describes the experimental setup but does not report observed results.';
for (const [name, text] of Object.entries({
  'natural complete explanation': faithfulAudio,
  'grounded mechanism': 'Photosynthesis uses light energy to convert carbon dioxide and water into sugars and releases oxygen. Light provides the energy for photosynthesis. Oxygen is released during photosynthesis.',
  'explicit absent results': 'The source does not report growth measurements. The source does not provide oxygen measurements.',
  'neutral questions': 'What is the experimental setup? What role does chlorophyll play in photosynthesis?',
  'speech number spellings': 'The experiment uses seventeen blue trays. Each tray contains three bean seedlings. Researchers compare growth after fourteen days.',
})) test(`audio grounding accepts ${name}`, () => assert.equal(auditCedarAudioGrounding(audioSource, text).passed, true));
for (const bad of [
  'They release less oxygen.',
  'The study confirms that specific conditions drive sugar production over two weeks.',
  'Without it, growth stalls despite adequate water.',
  'The experiment proves light increases growth.',
  'The control group grew less than the treatment group.',
  'Growth increased by 20 percent.',
  'Researchers found no difference in growth.',
  'The control receives plain water while treatment receives nutrient solution.',
  'The control group receives the same water but no light and grows less.',
  'Researchers compare growth after fourteen days and found faster growth.',
  'Chlorophyll absorbs light, so these plants grew faster.',
  'The experiment uses exactly 17 blue trays except for one red tray.',
  'The experiment does not use exactly 17 blue trays.',
  'Each tray contains minus three bean seedlings.',
  'The seedlings receive light for six point six hours daily.',
  'The seedlings receive light for 6.6 hours daily.',
  'The control group receives the same water and light.',
  'The control group receives the same water but no light exclusively.',
  'Why did the control grow less?',
  'If the experiment confirms growth increased then it proves the theory.',
  'Plants use oxygen and water to produce sugars and release carbon dioxide.',
  'Researchers compare growth after fourteen weeks.',
  'Plants release more oxygen in these trays.',
  'Plants did not release oxygen during photosynthesis.',
]) test(`audio grounding rejects unsupported clause: ${bad}`, () => {
  // Correct required facts cannot mask an additional unsupported proposition.
  assert.equal(auditCedarAudioGrounding(audioSource, audioSource + ' ' + bad).passed, false);
});
test('audio grounding rejects empty, unknown scaffolding and incomplete punctuationless ASR', () => {
  for (const text of ['', 'Exactly.', 'The study confirms it.', 'Chlorophyll absorbs light plants grew faster'])
    assert.equal(auditCedarAudioGrounding(audioSource, text).passed, false);
});

test("audio grounding rejects observed actual generated script", () => {
  assert.equal(auditCedarAudioGrounding(audioSource, "Welcome to Synthetic StudyPod. Today, we analyze the Cedar experiment. This study uses exactly 17 blue trays, with three bean seedlings in each. These plants receive light for six hours daily, while water is measured every morning.\n\nThat's precise data. Alex, how does this setup compare to the experimental control?\n\nThe control group receives the same water but no light. Researchers compare growth after fourteen days to see chlorophyll's role in photosynthesis.\n\nSo, without light, plants can't produce sugars using carbon dioxide and water?\n\nExactly. They release less oxygen. The study confirms that specific conditions drive sugar production over two weeks.\n\nWhat is the main takeaway?\n\nLight is essential for photosynthesis in these bean seedlings. Without it, growth stalls despite adequate water.").passed, false);
});

test("audio grounding rejects observed actual saved speech ASR", () => {
  assert.equal(auditCedarAudioGrounding(audioSource, "Welcome to synthetic study pod. Today, we analyze the cedar experiment. This study uses exactly 17 blue trays with three bean seedlings in each. These plants receive light for six hours daily while water is measured every morning. That's precise data. Alex, how does this set up compared to the experimental control? The control group receives the same water but no light. Researchers compare growth after 14 days to see chlorophyll's role in photosynthesis. So without light, plants can't produce sugars using carbon dioxide and water. Exactly, they release less oxygen. The study confirms that specific conditions drive sugar production over two weeks. What is the main takeaway? Light is essential for photosynthesis in these bean seedlings. Without it, growth stalls despite adequate water.").passed, false);
});

test('supported mechanism cannot launder unsupported outcome tail', () => {
  const text = 'Plants use carbon dioxide and water to produce sugars and release oxygen, proving the experiment increased growth.';
  assert.equal(auditCedarAudioGrounding(audioSource, text).passed, false);
});

test('audio grounding requires explicit per-tray seedling context', () => {
  assert.equal(auditCedarAudioGrounding(audioSource, audioSource + ' There are three bean seedlings.').passed, false);
  assert.equal(auditCedarAudioGrounding(audioSource, 'There are three bean seedlings in each tray.').passed, true);
  assert.equal(auditCedarAudioGrounding(audioSource, 'Each tray has three bean seedlings.').passed, true);
});

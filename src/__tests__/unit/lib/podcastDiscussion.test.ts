import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion } from '@/lib/ai/ollamaService';
import { generatePodcastScript } from '@/lib/podcastGenerator';
import { DiscussionSupportError, DiscussionCoverageError, IncompleteDiscussionVerdictError, batchDiscussionEvidence, compileDiscussionSections, discussionSectionSchema, parseDiscussionSection, verifyDiscussionSection } from '@/lib/audio/podcastDiscussionPlan';

vi.mock('@/lib/ai/ollamaService', () => ({chatCompletion: vi.fn()}));
// This suite isolates drafting/coverage/repair. The real sentence gate and its
// integration are exercised in podcastSentenceAudit.test.ts.
vi.mock('@/lib/audio/podcastSentenceAudit', () => ({auditDiscussionSentences: vi.fn().mockResolvedValue(undefined)}));
vi.mock('@/config/ollamaModels', () => ({getModelForTask: () => 'connected-local-model'}));

const passages = [
  {id: 'p1', sourceId: 'used-book', text: 'The pilot is planned for ten clinics. No clinical outcomes have been measured.'},
  {id: 'p2', sourceId: 'unused-book', text: 'A separate topic concerns the archive catalogue.'},
];
const plan = () => ({title: 'A plan is not a result', turns: [
  {speaker: 'host1', kind: 'explanation', text: 'The ten clinics describe the scope of a planned pilot, rather than completed research.', evidence: [{passageId: 'p1', quote: 'The pilot is planned for ten clinics.'}]},
  {speaker: 'host2', kind: 'explanation', text: 'That distinction matters because no clinical outcomes have yet been measured. The passage cannot establish a benefit.', evidence: [{passageId: 'p1', quote: 'No clinical outcomes have been measured.'}]},
  {speaker: 'host1', kind: 'question', text: 'Which phrase tells us that this pilot has not yet reported clinical outcomes?', evidence: [{passageId: 'p1', quote: 'No clinical outcomes have been measured.'}]},
]});
const verified = (count = 3) => JSON.stringify({verdicts: Array.from({length: count}, (_, turnIndex) => ({turnIndex, supported: true}))});
const source = `SOURCE: Pilot\nSOURCE_ID: "used-book"\n\n${passages[0].text}\n\nSOURCE: Archive\nSOURCE_ID: "unused-book"\n\n${passages[1].text}`;
beforeEach(() => {vi.resetAllMocks();});

describe('grounded Deep discussion', () => {
  it('deduplicates valid citation metadata without changing spoken text or accepting invalid citations', () => {
    const candidate = plan();
    candidate.turns[0].evidence.push({...candidate.turns[0].evidence[0]});
    const section = parseDiscussionSection(JSON.stringify(candidate), passages, false);
    expect(section.turns).toEqual(plan().turns);
    candidate.turns[0].evidence.push({passageId: 'p1', quote: 'Invented source quotation.'});
    expect(() => parseDiscussionSection(JSON.stringify(candidate), passages, false)).toThrow('quote absent');
  });
  it('accepts compact known IDs, hydrates canonical evidence and rejects unknown IDs', () => {
    const candidate = {...plan(), turns: plan().turns.map(turn => ({...turn, evidence: ['p1']}))};
    const section = parseDiscussionSection(JSON.stringify(candidate), passages, false);
    expect(section.turns[0].evidence).toEqual([{passageId: 'p1', quote: passages[0].text}]);
    candidate.turns[0].evidence = ['missing'];
    expect(() => parseDiscussionSection(JSON.stringify(candidate), passages, false)).toThrow('unknown passage');
  });
  it('constrains native evidence to canonical IDs without bypassing semantic review', () => {
    const schema = discussionSectionSchema(false, passages) as {properties: {turns: {items: {properties: {evidence: {items: unknown}}}}}};
    expect(schema.properties.turns.items.properties.evidence.items).toEqual({type: 'string', enum: ['p1', 'p2']});
    const candidate = plan();
    candidate.turns.forEach(turn => { turn.evidence = [{passageId: 'p1', quote: passages[0].text}]; });
    candidate.turns[0].text = 'The pilot proved that all ten clinics improved outcomes.';
    const section = parseDiscussionSection(JSON.stringify(candidate), passages, false);
    expect(() => verifyDiscussionSection(JSON.stringify({verdicts: [
      {turnIndex: 0, supported: false}, {turnIndex: 1, supported: true}, {turnIndex: 2, supported: true},
    ]}), section.turns.length)).toThrow(DiscussionSupportError);
  });
  it('requires each turn to cite every supporting passage and independently reviews corrected evidence', async () => {
    const incomplete = plan();
    incomplete.turns[0].text = 'The pilot is planned for ten clinics; a separate topic concerns the archive catalogue.';
    const corrected = plan();
    corrected.turns[0] = {...incomplete.turns[0], evidence: [
      ...incomplete.turns[0].evidence,
      {passageId: 'p2', quote: 'A separate topic concerns the archive catalogue.'},
    ]};
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce(JSON.stringify(incomplete))
      .mockResolvedValueOnce(JSON.stringify({verdicts: [
        {turnIndex: 0, supported: false}, {turnIndex: 1, supported: true}, {turnIndex: 2, supported: true},
      ]}))
      .mockResolvedValueOnce(JSON.stringify(corrected))
      .mockResolvedValueOnce(verified());
    const result = await generatePodcastScript(source, {type: 'deep-dive'});
    const calls = vi.mocked(chatCompletion).mock.calls;
    expect(calls).toHaveLength(4);
    const payloads = calls.map(([request]) => JSON.parse(request.messages[1].content));
    expect(calls[1][0].messages[0].content).toContain("THAT turn's cited full passages");
    expect(calls[1][0].messages[0].content).toContain('Other supplied passages provide context only');
    expect(payloads[1].passages).toHaveLength(2);
    expect(payloads[1].turns[0].evidence).toHaveLength(1);
    expect(payloads[2].rejectedTurnIndexes).toEqual([0]);
    expect(payloads[2].previousSection.turns[0]).toEqual({...incomplete.turns[0], evidence: ['p1']});
    expect(calls[2][0].messages[1].content).toContain('correct its evidence using that known passage ID');
    expect(payloads[3].turns[0].text).toBe(incomplete.turns[0].text);
    expect(payloads[3].turns[0].evidence).toEqual(corrected.turns[0].evidence);
    expect(calls[3][0].messages[0]).toEqual(calls[1][0].messages[0]);
    expect(result).toBeDefined();
  });

  it('fails closed before an oversized complete repair reaches a truncating transport', async () => {
    const large = plan();
    large.turns = Array.from({length: 4}, (_, index) => ({...large.turns[index % 3], text: large.turns[index % 3].text + ' ' + String(index) + 'grounded'.repeat(500)}));
    const rejected = JSON.stringify({verdicts: large.turns.map((_, turnIndex) => ({turnIndex, supported: false, reason: 'Unsupported claim. '.repeat(20)}))});
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(large)).mockResolvedValueOnce(rejected);
    await expect(generatePodcastScript(source, {type: 'deep-dive', userNotes: 'Study notes. '.repeat(80)})).rejects.toThrow('complete-context request budget');
    // Synthesis and the unchanged independent review ran; oversized repair never dispatched.
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const review = JSON.parse(vi.mocked(chatCompletion).mock.calls[1][0].messages[1].content);
    expect(review.turns).toEqual(large.turns);
    expect(review.passages[0].text).toBe(passages[0].text);
  });

  it('preserves full attribution context through synthesis, strict rejection, repair and fresh review', async () => {
    const canonical = 'Polemarchus advances the claim; Socrates asks him to clarify it. ' + passages[0].text + ' Thrasymachus is mentioned here but is not the speaker of that claim.';
    const contextualSource = 'SOURCE: Pilot\nSOURCE_ID: "used-book"\n\n' + canonical;
    const mistaken = plan();
    mistaken.turns[0].text = 'Thrasymachus advances the claim about the planned ten clinics.';
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce(JSON.stringify(mistaken))
      .mockResolvedValueOnce(JSON.stringify({verdicts: [{turnIndex: 0, supported: false}, {turnIndex: 1, supported: true}, {turnIndex: 2, supported: true}]}))
      .mockResolvedValueOnce(JSON.stringify(plan()))
      .mockResolvedValueOnce(verified());
    await expect(generatePodcastScript(contextualSource, {type: 'deep-dive'})).resolves.toBeDefined();
    const calls = vi.mocked(chatCompletion).mock.calls;
    expect(calls).toHaveLength(4);
    const payloads = calls.map(([request]) => JSON.parse(request.messages[1].content));
    payloads.forEach(payload => expect(payload.passages[0].text).toBe(canonical));
    expect(payloads[0].passages).toEqual(payloads[1].passages);
    expect(payloads[2].passages).toEqual(payloads[3].passages);
    expect(payloads[1].turns[0].text).toBe(mistaken.turns[0].text);
    expect(payloads[2].previousSection.turns).toEqual(mistaken.turns.map(turn => ({...turn, evidence: turn.evidence.map(reference => reference.passageId)})));
    expect(payloads[2].rejectedTurnIndexes).toEqual([0]);
    expect(payloads[2]).not.toHaveProperty('rejectedTurns');
    calls.forEach(([request]) => expect(request.messages.reduce((sum, message) => sum + message.content.normalize('NFC').length + message.role.length + 4, 0) + 12).toBeLessThanOrEqual(20_000));
    expect(payloads[3].turns).toEqual(plan().turns);
    expect(calls[0][0].messages[0].content).toContain('Read the full canonical passages');
    expect(calls[0][0].messages[0].content).toContain('For dialogues with unlabelled speakers, explain the argument without assigning names to individual statements');
    expect(calls[0][0].messages[0].content).not.toContain('Aim for 500-900 words');
    expect(calls[3][0].messages[0]).toEqual(calls[1][0].messages[0]);
  });


  it('retries an incomplete verdict with a fresh complete review on the same deadline', async () => {
    const partial = JSON.stringify({verdicts: [{turnIndex: 0, supported: true}]});
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce(partial).mockResolvedValueOnce(verified());
    const signal = new AbortController().signal;
    const deadlineAt = Date.now() + 60_000;
    await expect(generatePodcastScript(source, {type: 'deep-dive', signal, deadlineAt})).resolves.toBeDefined();
    const calls = vi.mocked(chatCompletion).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[2][0].messages).toEqual(calls[1][0].messages);
    const review = JSON.parse(calls[2][0].messages[1].content);
    expect(review.turns).toEqual(plan().turns);
    expect(review.requiredTurnIndexes).toEqual([0, 1, 2]);
    expect(review.turnCount).toBe(3);
    calls.forEach(([request]) => {expect(request.signal).toBe(signal); expect(request.deadlineAt).toBe(deadlineAt);});
  });

  it('rejects persistent incomplete reviews without semantic regeneration or audio', async () => {
    const partial = JSON.stringify({verdicts: [{turnIndex: 0, supported: false}]});
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce(partial).mockResolvedValueOnce(partial);
    await expect(generatePodcastScript(source, {type: 'deep-dive'})).rejects.toThrow('could not be verified');
    expect(chatCompletion).toHaveBeenCalledTimes(3);
  });

  it.each([
    [{turnIndex: 0, supported: true}, {turnIndex: 0, supported: true}],
    [{turnIndex: 0}],
    [{turnIndex: 8, supported: true}],
  ])('does not retry a malformed partial verdict %j', async (...verdicts) => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce(JSON.stringify({verdicts}));
    await expect(generatePodcastScript(source, {type: 'deep-dive'})).rejects.toThrow();
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('honors cancellation before retrying an incomplete verdict', async () => {
    const controller = new AbortController();
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockImplementationOnce(async () => {
      controller.abort();
      return JSON.stringify({verdicts: [{turnIndex: 0, supported: true}]});
    });
    await expect(generatePodcastScript(source, {type: 'deep-dive', signal: controller.signal})).rejects.toThrow();
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('repairs one complete section then independently verifies fresh turns on the same deadline', async () => {
    const original = plan(); original.turns[0].text = 'The pilot proved a clinical benefit.';
    const rejected = JSON.stringify({verdicts: original.turns.map((_, turnIndex) => ({turnIndex, supported: turnIndex !== 0}))});
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(original)).mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce(verified());
    const signal = new AbortController().signal;
    const deadlineAt = Date.now() + 60_000;
    const result = await generatePodcastScript(source, {type: 'deep-dive', signal, deadlineAt});
    expect(result).toBeDefined();
    const calls = vi.mocked(chatCompletion).mock.calls;
    expect(calls).toHaveLength(4);
    const initial = JSON.parse(calls[0][0].messages[1].content);
    const repair = JSON.parse(calls[2][0].messages[1].content);
    expect(repair.passages).toEqual(initial.passages);
    expect(repair.previousSection.turns).toEqual(original.turns.map(turn => ({...turn, evidence: turn.evidence.map(reference => reference.passageId)})));
    expect(repair.rejectedTurnIndexes).toEqual([0]);
    const repairSystem = calls[2][0].messages[0].content;
    expect(repairSystem).not.toBe(calls[0][0].messages[0].content);
    expect(repairSystem.length).toBeLessThan(calls[0][0].messages[0].content.length);
    expect(repairSystem).toContain('Retain sound explanations and their evidence');
    expect(repairSystem).toContain('For dialogues with unlabelled speakers, explain the argument without assigning names to individual statements');
    expect(repairSystem).toContain('Questions must retrieve answers explicitly stated in their own cited passages');
    expect(repairSystem).toContain('Return the entire corrected section, never a patch or filtered subset');
    expect(repair).not.toHaveProperty('rejectedTurns');
    expect(repair.repairInstruction).toContain('Do not invent a converse');
    expect(JSON.parse(calls[3][0].messages[1].content).turns).toEqual(plan().turns);
    expect(calls[3][0].messages[0]).toEqual(calls[1][0].messages[0]);
    calls.forEach(([request]) => {expect(request.signal).toBe(signal); expect(request.deadlineAt).toBe(deadlineAt);});
  });

  it('does not repair an invalid verdict even when it includes an explicit rejection', async () => {
    const invalid = JSON.stringify({verdicts: [{turnIndex: 0, supported: false}, {turnIndex: 0, supported: true}, {turnIndex: 2, supported: true}]});
    let failure: unknown;
    try { verifyDiscussionSection(invalid, 3); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(DiscussionSupportError);
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce(invalid);
    await expect(generatePodcastScript(source, {type: 'deep-dive'})).rejects.toThrow('unsupported');
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('propagates cancellation during semantic repair before another verification', async () => {
    const controller = new AbortController();
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan()))
      .mockResolvedValueOnce(JSON.stringify({verdicts: plan().turns.map((_, turnIndex) => ({turnIndex, supported: false}))}))
      .mockImplementationOnce(async () => {controller.abort(); return JSON.stringify(plan());});
    await expect(generatePodcastScript(source, {type: 'deep-dive', signal: controller.signal})).rejects.toThrow();
    expect(chatCompletion).toHaveBeenCalledTimes(3);
  });

  it('allows one semantic repair per section but stops if that section still fails', async () => {
    const multiSource = Array.from({length: 10}, (_, index) => 'SOURCE: Pilot '+index+'\nSOURCE_ID: "book-'+index+'"\n\n'+passages[0].text+' '+'Qualified evidence remains limited. '.repeat(50)).join('\n\n');
    let reviews = 0;
    vi.mocked(chatCompletion).mockImplementation(async request => {
      const payload = JSON.parse(request.messages[1].content);
      if (payload.turns) {
        reviews++;
        return JSON.stringify({verdicts: payload.turns.map((_: unknown, turnIndex: number) => ({turnIndex, supported: reviews === 2 || turnIndex !== 0})), coverage: payload.passages.map((passage: {id: string}) => ({passageId: passage.id, missingPoints: []}))});
      }
      const section = plan();
      section.turns.forEach(turn => {turn.evidence[0].passageId = payload.passages[0].id;});
      return JSON.stringify(section);
    });
    await expect(generatePodcastScript(multiSource, {type: 'deep-dive'})).rejects.toThrow('unsupported');
    expect(reviews).toBe(4);
    expect(chatCompletion).toHaveBeenCalledTimes(8);
  });

  it('invokes the connected model and verifier, saves actual segment evidence, and permits an honest short episode', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce(verified());
    const controller = new AbortController();
    const deadlineAt = Date.now() + 60_000;
    const script = await generatePodcastScript(source, {type: 'deep-dive', signal: controller.signal, deadlineAt});
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(vi.mocked(chatCompletion).mock.calls[0][0]).toMatchObject({maxOutputTokens: 4096, jsonMode: true});
    const synthesisPolicy = vi.mocked(chatCompletion).mock.calls[0][0].messages[0].content;
    expect(synthesisPolicy).toContain("Every factual clause, attribution and question premise must be supported by that turn's own cited full passages");
    expect(synthesisPolicy).toContain('For dialogues with unlabelled speakers, explain the argument without assigning names to individual statements');
    expect(synthesisPolicy).toContain('choose an explicit source-stated answer first');
    expect(synthesisPolicy).toContain('Omit unsupported clauses rather than hedge them');
    expect(synthesisPolicy).toContain('Select each evidence ID from the SAME passage');
    expect(vi.mocked(chatCompletion).mock.calls[1][0]).toMatchObject({maxOutputTokens: 2048, jsonMode: true});
    for (const [call] of vi.mocked(chatCompletion).mock.calls) {
      expect(call).toMatchObject({model: 'connected-local-model', signal: controller.signal, deadlineAt});
      expect(call.messages.map(message => message.content).join('').length).toBeLessThan(20_000);
    }
    expect(vi.mocked(chatCompletion).mock.calls[1][0].messages[0].content).toContain('Evidence quotes alone do not establish entailment');
    expect(script.metadata).toMatchObject({narrationMode: 'grounded-discussion', evidencePassageIds: ['p1'], evidenceSourceIds: ['used-book'], durationTarget: {status: 'below-target'}});
    expect(script.metadata?.segmentEvidence).toEqual(plan().turns.map((turn, segmentIndex) => ({segmentIndex, kind: turn.kind, evidence: turn.evidence})));
    expect(script.segments[0].text).not.toBe(passages[0].text);
    expect(script.metadata?.durationTarget?.explanation).toContain('without padding');
    expect(script.estimatedDuration).toBeLessThan(1200);
  });

  it('accepts one complete structured response wrapped by a local model without changing its evidence', () => {
    const section = plan();
    section.turns[0].text += ' A literal brace { and an escaped quote " remain prose.';
    const json = JSON.stringify(section);
    for (const response of [json, `\x60\x60\x60json\n${json}\n\x60\x60\x60`, `<think>Check the source.</think>\n${json}`, `Here is the JSON:\n${json}\nEnd of response.`]) {
      expect(parseDiscussionSection(response, passages, false)).toEqual(section);
      verifyDiscussionSection(`Verification:\n${verified()}\nComplete.`, section.turns.length);
    }
  });

  it('verifies a turns-only response when Qwen omits the decorative section title', async () => {
    const section = plan();
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify({turns: section.turns}))
      .mockResolvedValueOnce(verified());
    const script = await generatePodcastScript(source, {type: 'deep-dive'});
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(chatCompletion).mock.calls[1][0].messages[1].content).turns).toEqual(section.turns);
    expect(script.title).toBe('Source-grounded discussion');
    expect(script.metadata?.segmentEvidence).toEqual(section.turns.map((turn, segmentIndex) => ({segmentIndex, kind: turn.kind, evidence: turn.evidence})));
  });

  it('does not relax evidence or semantic verification for a turns-only response', async () => {
    const section = plan();
    section.turns[0].evidence[0].quote = 'The pilot proved a substantial clinical benefit.';
    expect(() => parseDiscussionSection(JSON.stringify({turns: section.turns}), passages, false)).toThrow('quote absent');
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify({turns: plan().turns}))
      .mockResolvedValueOnce(JSON.stringify({verdicts: plan().turns.map((_, turnIndex) => ({turnIndex, supported: turnIndex !== 0}))}));
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce('{"verdicts":[{"turnIndex":0,"supported":false},{"turnIndex":1,"supported":true},{"turnIndex":2,"supported":true}]}');
    await expect(generatePodcastScript(source, {type: 'deep-dive'})).rejects.toThrow('unsupported');
    expect(chatCompletion).toHaveBeenCalledTimes(4);
  });

  it.each([null, '', 42, 'x'.repeat(121)])('still rejects a supplied invalid section title %s', title => {
    expect(() => parseDiscussionSection(JSON.stringify({...plan(), title}), passages, false)).toThrow('invalid section shape');
  });

  it('rejects extra root fields even when the decorative title is absent', () => {
    expect(() => parseDiscussionSection(JSON.stringify({turns: plan().turns, summary: 'Extra unverified prose'}), passages, false)).toThrow('invalid section shape');
  });

  it('verifies a formatted nine-turn discussion above the old raw cap within the actual prompt budget', async () => {
    vi.mocked(chatCompletion).mockImplementation(async request => {
      const payload = JSON.parse(request.messages[1].content);
      if (payload.turns) return JSON.stringify({...JSON.parse(verified(payload.turns.length)), ...(request.messages.length > 2 ? {coverage: payload.passages.map((passage: {id: string}) => ({passageId: passage.id, missingPoints: []}))} : {})});
      const section = {title: 'Interpreting a planned pilot', turns: Array.from({length: 9}, (_, index) => ({
        speaker: index % 2 ? 'host2' : 'host1', kind: index === 8 ? 'question' : 'explanation',
        text: `Point ${index + 1}. The scope of this pilot is planned, so the number of clinics describes an intended activity rather than a measured outcome. That wording does not tell us that any patient improved. The absence of clinical outcomes is an explicit limitation on what we can conclude from the passage. ${index === 8 ? 'Which wording distinguishes a plan from a measured result?' : 'We should preserve that limitation when interpreting the claim.'}`,
        evidence: [
          {passageId: payload.passages[0].id, quote: passages[0].text.split(' No')[0]},
          {passageId: payload.passages[0].id, quote: 'No clinical outcomes have been measured.'},
        ],
      }))};
      const response = JSON.stringify(section, null, 8);
      expect(response.length).toBeGreaterThan(8000);
      expect(response.length).toBeLessThan(24_000);
      return response;
    });
    const script = await generatePodcastScript(source, {type: 'deep-dive'});
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const verifier = vi.mocked(chatCompletion).mock.calls[1][0];
    expect(verifier.messages.map(message => message.content).join('').length).toBeLessThan(20_000);
    expect(JSON.parse(verifier.messages[1].content).turns).toHaveLength(9);
    expect(script.metadata?.segmentEvidence?.flatMap(turn => turn.evidence)).toHaveLength(18);
    expect(script.segments).toHaveLength(9);
  });

  it('bounds raw transport separately and rejects excessive canonical evidence before verification', () => {
    expect(() => parseDiscussionSection(' '.repeat(24_001), passages, false)).toThrow('bounded verification budget');
    const quotes = ['A', 'B', 'C', 'D'].map(letter => `${letter} `.repeat(599) + letter);
    const longPassages = [{id: 'p1', sourceId: 'book', text: quotes.join(' ')}];
    const section = plan();
    section.turns.forEach(turn => { turn.evidence = quotes.map(quote => ({passageId: 'p1', quote})); });
    const response = JSON.stringify(section);
    expect(response.length).toBeLessThan(24_000);
    expect(JSON.stringify({passages: longPassages, turns: section.turns}).length).toBeGreaterThan(18_000);
    expect(() => parseDiscussionSection(response, longPassages, false)).toThrow('bounded verification budget');
  });

  it('still rejects a speaker misattribution despite an exact quotation and sufficient verification budget', async () => {
    const philosophy = 'Polemarchus uses the shield and lyre examples to question whether justice is useful when objects are not in use.';
    vi.mocked(chatCompletion).mockImplementation(async request => {
      const payload = JSON.parse(request.messages[1].content);
      if (payload.turns) {
        expect(payload.passages[0].text).toContain('Polemarchus');
        expect(payload.turns[0].text).toContain('Thrasymachus');
        return JSON.stringify({verdicts: payload.turns.map((_: unknown, turnIndex: number) => ({turnIndex, supported: turnIndex !== 0}))});
      }
      const section = plan();
      section.turns[0].text = 'Thrasymachus uses the shield and lyre examples to question the usefulness of justice.';
      section.turns[1].text = 'The passage asks whether justice is useful when objects are not in use.';
      section.turns[2].text = 'Who uses the shield and lyre examples in this passage?';
      section.turns.forEach(turn => {turn.evidence = [{passageId: payload.passages[0].id, quote: philosophy}];});
      return JSON.stringify(section);
    });
    await expect(generatePodcastScript(`SOURCE: Philosophy\nSOURCE_ID: "book"\n\n${philosophy}`, {type: 'deep-dive'})).rejects.toThrow('unsupported');
    expect(chatCompletion).toHaveBeenCalledTimes(4);
  });

  it('never repairs truncated JSON or accepts multiple structured objects', () => {
    const json = JSON.stringify(plan());
    for (const response of [json.slice(0, -1), json.slice(0, -30), `${json}\n{}`, `[${json}]`]) {
      expect(() => parseDiscussionSection(response, passages, false)).toThrow();
    }
    expect(() => verifyDiscussionSection(verified().slice(0, -1), plan().turns.length)).toThrow();
  });

  it('fails before synthesis on unsupported claims and never substitutes a guided reading', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce(JSON.stringify({verdicts: [
      {turnIndex: 0, supported: true}, {turnIndex: 1, supported: false}, {turnIndex: 2, supported: true},
    ]}));
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce('{"verdicts":[{"turnIndex":0,"supported":false},{"turnIndex":1,"supported":true},{"turnIndex":2,"supported":true}]}');
    await expect(generatePodcastScript(source, {type: 'deep-dive'})).rejects.toThrow('unsupported');
    expect(chatCompletion).toHaveBeenCalledTimes(4);
  });

  it.each([
    'Does using a weapon against an enemy threaten the stability of the state?',
    'Why does the shield example establish that justice is a static virtue and a passive skill?',
    'How does Socrates replace conventional social norms with a universal definition of justice?',
  ])('still rejects an unsupported question premise despite a related exact quote: %s', async question => {
    // Reduced cases motivated by the rejected live 10555 discussion; this is a
    // mocked fail-closed regression, not a replay or a model-quality verdict.
    const philosophy = 'If you want to keep a shield or a lyre, and not to use them, you would say that justice is useful; but if you want to use them, then the art of the soldier or of the musician?';
    vi.mocked(chatCompletion).mockImplementation(async request => {
      const payload = JSON.parse(request.messages[1].content);
      if (payload.turns) {
        expect(payload.turns[2].text).toBe(question);
        expect(payload.turns[2].evidence[0].quote).toBe(philosophy);
        expect(request.messages[0].content).toContain('question presupposition not entailed');
        return JSON.stringify({verdicts: payload.turns.map((_: unknown, turnIndex: number) => ({turnIndex, supported: turnIndex !== 2}))});
      }
      const section = plan();
      section.turns[0].text = 'The passage contrasts keeping a shield or lyre with using it.';
      section.turns[1].text = 'For use, the passage mentions the soldier and the musician.';
      section.turns[2].text = question;
      section.turns.forEach(turn => {turn.evidence = [{passageId: payload.passages[0].id, quote: philosophy}];});
      return JSON.stringify(section);
    });
    await expect(generatePodcastScript(`SOURCE: Philosophy\nSOURCE_ID: "book"\n\n${philosophy}`, {type: 'deep-dive'})).rejects.toThrow('unsupported');
    expect(chatCompletion).toHaveBeenCalledTimes(4);
  });

  it.each(['unknown kinds', 'question labelled explanation'])('regenerates once for %s, then strictly verifies the fresh attributed section', async fault => {
    const drift = plan();
    if (fault === 'unknown kinds') drift.turns.forEach((turn, index) => { turn.kind = ['qualification', 'clarification', 'retrieval_question'][index]; });
    else drift.turns[2].kind = 'explanation';
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(drift))
      .mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce(verified());
    const controller = new AbortController();
    const deadlineAt = Date.now() + 60_000;
    const script = await generatePodcastScript(source, {type: 'deep-dive', signal: controller.signal, deadlineAt});
    const calls = vi.mocked(chatCompletion).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0][0].jsonSchema).toBeDefined();
    expect(calls[1][0].messages[1].content).toContain('Generate a fresh complete section');
    expect(calls[1][0].messages[0].content).toBe(calls[0][0].messages[0].content);
    calls.forEach(([request]) => expect(request).toMatchObject({signal: controller.signal, deadlineAt, jsonMode: true}));
    expect(JSON.parse(calls[2][0].messages[1].content).turns).toEqual(plan().turns);
    expect(script.metadata?.segmentEvidence).toHaveLength(3);
  });

  it.each(['missing evidence', 'invented quote', 'repeated kind drift'])('does not accept a schema regeneration with %s', async fault => {
    const drift = plan(); drift.turns[2].kind = 'retrieval_question';
    const repair = plan();
    if (fault === 'missing evidence') repair.turns[0].evidence = [];
    if (fault === 'invented quote') repair.turns[0].evidence[0].quote = 'The pilot proved a substantial clinical benefit.';
    if (fault === 'repeated kind drift') repair.turns[2].kind = 'retrieval_question';
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(drift)).mockResolvedValueOnce(JSON.stringify(repair));
    await expect(generatePodcastScript(source, {type: 'deep-dive'})).rejects.toThrow();
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported content even when a schema regeneration has valid evidence quotes', async () => {
    const drift = plan(); drift.turns[2].kind = 'retrieval_question';
    const repair = plan(); repair.turns[0].text = 'The pilot proved a substantial clinical benefit.';
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(drift)).mockResolvedValueOnce(JSON.stringify(repair))
      .mockResolvedValueOnce(JSON.stringify({verdicts: [{turnIndex: 0, supported: false}, {turnIndex: 1, supported: true}, {turnIndex: 2, supported: true}]}));
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce('{"verdicts":[{"turnIndex":0,"supported":false},{"turnIndex":1,"supported":true},{"turnIndex":2,"supported":true}]}');
    await expect(generatePodcastScript(source, {type: 'deep-dive'})).rejects.toThrow('unsupported');
    expect(chatCompletion).toHaveBeenCalledTimes(5);
  });

  it('propagates cancellation during schema regeneration and never asks for verification', async () => {
    const controller = new AbortController();
    const drift = plan(); drift.turns[2].kind = 'retrieval_question';
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(drift))
      .mockImplementationOnce(async () => {controller.abort(); return JSON.stringify(plan());});
    await expect(generatePodcastScript(source, {type: 'deep-dive', signal: controller.signal})).rejects.toThrow(/abort/i);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('regenerates a mismatched known passage ID from original evidence and verifies only the fresh section', async () => {
    const invalid = plan(); invalid.turns[0].evidence[0].passageId = 'p2';
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(invalid))
      .mockResolvedValueOnce(JSON.stringify(plan())).mockResolvedValueOnce(verified());
    const controller = new AbortController();
    const deadlineAt = Date.now() + 60_000;
    const script = await generatePodcastScript(source, {type: 'deep-dive', signal: controller.signal, deadlineAt});
    const calls = vi.mocked(chatCompletion).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[1][0].messages[1].content).toContain(calls[0][0].messages[1].content);
    expect(calls[1][0].messages[1].content).toContain('unknown passage or a quote absent from its source');
    expect(calls[1][0].messages[1].content).not.toContain(JSON.stringify(invalid));
    calls.forEach(([request]) => expect(request).toMatchObject({signal: controller.signal, deadlineAt}));
    expect(JSON.parse(calls[2][0].messages[1].content).turns).toEqual(plan().turns);
    expect(script.metadata?.evidencePassageIds).toEqual(['p1']);
    expect(invalid.turns[0].evidence[0].passageId).toBe('p2');
  });

  it('shares the single repair budget when an evidence retry returns kind drift', async () => {
    const invalid = plan(); invalid.turns[0].evidence[0].passageId = 'p2';
    const drift = plan(); drift.turns[2].kind = 'retrieval_question';
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(invalid)).mockResolvedValueOnce(JSON.stringify(drift));
    await expect(generatePodcastScript(source, {type: 'deep-dive'})).rejects.toThrow();
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('rejects a second invented quote without asking the semantic verifier or retrying again', async () => {
    const invalid = plan(); invalid.turns[0].evidence[0].quote = 'The pilot improved outcomes by twenty percent.';
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(invalid)).mockResolvedValueOnce(JSON.stringify(invalid));
    await expect(generatePodcastScript(source, {type: 'deep-dive'})).rejects.toThrow('quote absent');
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('propagates cancellation after a provider reply and makes no verifier request', async () => {
    const controller = new AbortController();
    vi.mocked(chatCompletion).mockImplementationOnce(async () => {controller.abort(); return JSON.stringify(plan());});
    await expect(generatePodcastScript(source, {type: 'deep-dive', signal: controller.signal})).rejects.toThrow(/abort/i);
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('stops before any model call for an expired shared deadline', async () => {
    await expect(generatePodcastScript(source, {type: 'deep-dive', deadlineAt: Date.now() - 1})).rejects.toThrow('deadline');
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('keeps all complete passages in bounded requests instead of stopping after four batches', () => {
    const long = Array.from({length: 20}, (_, index) => ({id: `p${index + 1}`, sourceId: `book-${index}`, text: `The study ${index} has not measured clinical outcomes. ` + 'Qualified evidence remains limited. '.repeat(60)}));
    const batches = batchDiscussionEvidence(long);
    expect(batches.length).toBeGreaterThan(4);
    expect(batches.flat()).toEqual(long);
    batches.forEach(batch => expect(batch.reduce((sum, passage) => sum + JSON.stringify(passage).length, 0)).toBeLessThanOrEqual(7600));
  });

  it('splits a token-exhausted draft without losing source order or skipping verification', async () => {
    const drafts: string[][] = [];
    const reviews: string[][] = [];
    vi.mocked(chatCompletion).mockImplementation(async request => {
      const payload = JSON.parse(request.messages[1].content);
      const ids = payload.passages.map((passage: {id: string}) => passage.id);
      if (payload.turns) {
        reviews.push(ids);
        return verified(payload.turns.length);
      }
      drafts.push(ids);
      if (drafts.length === 1) throw new Error('Ollama generation ended before completion (token limit reached).');
      const passage = payload.passages[0];
      return JSON.stringify({title: `Section ${passage.id}`, turns: [
        {speaker: 'host1', kind: 'explanation', text: passage.text, evidence: [passage.id]},
        {speaker: 'host2', kind: 'explanation', text: `This section states: ${passage.text}`, evidence: [passage.id]},
        {speaker: 'host1', kind: 'question', text: `What does section ${passage.id} establish?`, evidence: [passage.id]},
      ]});
    });
    const script = await generatePodcastScript(source, {type: 'deep-dive'});
    expect(drafts).toEqual([['p1', 'p2'], ['p1'], ['p2']]);
    expect(reviews).toEqual([['p1'], ['p2']]);
    expect(script.metadata?.evidencePassageIds).toEqual(['p1', 'p2']);
    expect(script.segments[0].text).toBe(passages[0].text);
    expect(script.segments[3].text).toBe(passages[1].text);
  });

  it('does not retry token exhaustion for a single complete passage', async () => {
    vi.mocked(chatCompletion).mockRejectedValue(new Error('Ollama generation ended before completion (token limit reached).'));
    await expect(generatePodcastScript(`SOURCE: Pilot\nSOURCE_ID: "used-book"\n\n${passages[0].text}`, {type: 'deep-dive'})).rejects.toThrow('token limit reached');
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('honors an explicit deadline across every batch and reports real progress', async () => {
    const multiSource = Array.from({length: 20}, (_, index) => `SOURCE: Pilot ${index + 1}\nSOURCE_ID: "book-${index + 1}"\n\nThe pilot is planned for ten clinics. No clinical outcomes have been measured. ${'Qualified evidence remains limited. '.repeat(50)}`).join('\n\n');
    vi.mocked(chatCompletion).mockImplementation(async request => {
      const payload = JSON.parse(request.messages[1].content);
      if (payload.turns) return JSON.stringify({...JSON.parse(verified(payload.turns.length)), ...(request.messages.length > 2 ? {coverage: payload.passages.map((passage: {id: string}) => ({passageId: passage.id, missingPoints: []}))} : {})});
      const section = plan();
      section.title = `Pilot section ${payload.section}`;
      section.turns.forEach(turn => {
        turn.text = `For this section ${payload.section}, ${turn.text}`;
        turn.evidence = [{passageId: payload.passages[0].id, quote: turn.evidence[0].quote}];
      });
      return JSON.stringify(section);
    });
    const controller = new AbortController();
    const deadlineAt = Date.now() + 60_000;
    const onProgress = vi.fn();
    const script = await generatePodcastScript(multiSource, {type: 'deep-dive', signal: controller.signal, deadlineAt, onProgress});
    const calls = vi.mocked(chatCompletion).mock.calls;
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.length).toBeGreaterThan(8);
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({phase: 'reviewing', section: calls.length / 2, totalSections: calls.length / 2});
    calls.forEach(([request]) => {
      expect(request.signal).toBe(controller.signal);
      expect(request.deadlineAt).toBe(deadlineAt);
      expect(request.messages.map(message => message.content).join('').length).toBeLessThan(20_000);
    });
    const coverage = script.metadata!.sourceCoverage!;
    expect(coverage.consideredPassages).toBe(coverage.indexedPassages!);
    expect(coverage.usedPassages).toBe(script.metadata!.evidencePassageIds!.length);
    expect(coverage.excerpted).toBe(true);
    expect(coverage.explanation).toContain('Every indexed substantive passage');
    expect(coverage.explanation).toContain('excerpt');
  });

  it('rejects model-written narration in the existing Standard path', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(plan()));
    await expect(generatePodcastScript(source, {type: 'standard'})).rejects.toThrow();
  });
});

describe('discussion evidence contract', () => {
  it('accepts distinct exact spans from one passage and saves both source quotes', async () => {
    const section = plan();
    section.turns[0].evidence.push({passageId: 'p1', quote: 'No clinical outcomes have been measured.'});
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify(section)).mockResolvedValueOnce(verified());
    const script = await generatePodcastScript(source, {type: 'deep-dive'});
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(script.metadata?.segmentEvidence?.[0].evidence).toEqual(section.turns[0].evidence);
    expect(script.metadata?.evidencePassageIds).toEqual(['p1']);
    expect(script.metadata?.evidenceSourceIds).toEqual(['used-book']);
  });

  it('matches only equivalent quote typography and retains the exact source spelling', () => {
    const quotedSource = 'The author calls it ‘a planned pilot’ and says “no outcomes are measured”.';
    const quotedPassages = [{...passages[0], text: quotedSource}];
    const section = plan();
    section.turns.forEach(turn => {turn.evidence = [{passageId: 'p1', quote: "The author calls it 'a planned pilot' and says \"no outcomes are measured\"."}];});
    const parsed = parseDiscussionSection(JSON.stringify(section), quotedPassages, false);
    expect(parsed.turns.every(turn => turn.evidence[0].quote === quotedSource)).toBe(true);
    const compiled = compileDiscussionSections([parsed], quotedPassages, 'Alex', 'Sarah');
    expect(compiled.segmentEvidence[0].evidence[0].quote).toBe(quotedSource);
    section.turns[0].evidence.push({passageId: 'p1', quote: quotedSource});
    expect(parseDiscussionSection(JSON.stringify(section), quotedPassages, false).turns[0].evidence).toEqual(parsed.turns[0].evidence);
  });

  it.each([
    ['negation', 'Clinical outcomes have been measured.'],
    ['omitted words', 'No clinical outcomes measured.'],
    ['ellipsis', 'No clinical outcomes ... measured.'],
    ['case changes', 'no clinical outcomes have been measured.'],
    ['dash substitution', 'The pilot—planned for ten clinics—has no results.'],
  ])('rejects altered source content despite typography tolerance: %s', (_fault, quote) => {
    const section = plan(); section.turns[0].evidence[0].quote = quote;
    const exactPassages = [{...passages[0], text: `${passages[0].text} The pilot-planned for ten clinics-has no results.`}];
    expect(() => parseDiscussionSection(JSON.stringify(section), exactPassages, false)).toThrow('quote absent');
  });

  it('rejects an exact quote assigned to another known passage instead of silently reassigning its ID', () => {
    // Reduced case from live req10835: the wealth question was quoted under the arms example ID.
    const wealthQuestion = 'What do you consider to be the greatest blessing which you have reaped from your wealth?';
    const armsExample = 'Suppose that a friend when in his right mind has deposited arms with me.';
    const exactPassages = [
      {id: 'p3', sourceId: 'book', text: wealthQuestion},
      {id: 'p7', sourceId: 'book', text: armsExample},
    ];
    const section = plan();
    section.turns.forEach(turn => {turn.evidence = [{passageId: 'p7', quote: armsExample}];});
    section.turns[0].evidence.unshift({passageId: 'p7', quote: wealthQuestion});
    expect(() => parseDiscussionSection(JSON.stringify(section), exactPassages, false)).toThrow('quote absent');
    expect(section.turns[0].evidence[0].passageId).toBe('p7');
    section.turns[0].evidence[0].passageId = 'p3';
    const parsed = parseDiscussionSection(JSON.stringify(section), exactPassages, false);
    expect(parsed.turns[0].evidence).toEqual([
      {passageId: 'p3', quote: wealthQuestion},
      {passageId: 'p7', quote: armsExample},
    ]);
  });

  it('rejects unknown IDs, missing explanation, and a second host in solo mode', () => {
    const unknown = plan(); unknown.turns[0].evidence[0].passageId = 'p99';
    expect(() => parseDiscussionSection(JSON.stringify(unknown), passages, false)).toThrow('unknown');
    const shallow = plan(); shallow.turns[1].kind = 'question';
    expect(() => parseDiscussionSection(JSON.stringify(shallow), passages, false)).toThrow('at least two turns');
    expect(() => parseDiscussionSection(JSON.stringify(plan()), passages, true)).toThrow();
  });

  it('rejects partial, duplicate, unknown, and malformed semantic verdicts', () => {
    expect(() => verifyDiscussionSection(verified(2), 3)).toThrow();
    expect(() => verifyDiscussionSection('{"verdicts":[{"turnIndex":0,"supported":true},{"turnIndex":0,"supported":true},{"turnIndex":2,"supported":true}]}', 3)).toThrow();
    expect(() => verifyDiscussionSection('{"verdicts":[{"turnIndex":0,"supported":true},{"turnIndex":1,"supported":true},{"turnIndex":4,"supported":true}]}', 3)).toThrow();
    expect(() => verifyDiscussionSection('{"supported":true}', 3)).toThrow();
    expect(() => verifyDiscussionSection(verified(), 3)).not.toThrow();
  });

  it('rejects repeated cross-section padding and derives multi-source scope only from accepted references', () => {
    const section = parseDiscussionSection(JSON.stringify(plan()), passages, false);
    expect(() => compileDiscussionSections([section, section], passages, 'Alex', 'Sarah')).toThrow('repeats');
    const other = plan();
    other.turns[1].evidence = [{passageId: 'p2', quote: passages[1].text}];
    const compiled = compileDiscussionSections([parseDiscussionSection(JSON.stringify(other), passages, false)], passages, 'Alex', 'Sarah');
    expect(compiled.evidenceSourceIds).toEqual(['used-book', 'unused-book']);
    expect(compiled.segmentEvidence[1].evidence[0].passageId).toBe('p2');
  });

  it.each([[1000, 4500], [11530, 6918], [20000, 9000]])('bounds episode length for a %i-word source at %i words', (sourceWords, budget) => {
    const section = parseDiscussionSection(JSON.stringify(plan()), passages, false);
    const sourcePassages = [{...passages[0], text: Array(sourceWords).fill('source').join(' ')}];
    const makeEpisode = (count: number) => [{...section, turns: [{...section.turns[0], text: Array(count).fill('spoken').join(' ')}]}];
    expect(compileDiscussionSections(makeEpisode(budget), sourcePassages, 'Alex', 'Sarah').words).toBe(budget);
    expect(() => compileDiscussionSections(makeEpisode(budget + 1), sourcePassages, 'Alex', 'Sarah')).toThrow('episode budget');
  });
});


describe('Deep Dive coverage review', () => {
  const verdict = (coverage: unknown) => JSON.stringify({...JSON.parse(verified()), coverage});
  it('rejects a supported but shallow section with actionable missing points', () => {
    expect(() => verifyDiscussionSection(verdict([{passageId: 'p1', missingPoints: ['Explain why the return to the cave matters.']}]), 3, ['p1'])).toThrow(DiscussionCoverageError);
  });
  it('preserves verbose coverage rejections for repair without accepting the section', () => {
    const point = 'Explain the omitted conditions on the central claim. '.repeat(11);
    expect(point.length).toBeGreaterThan(500);
    try {
      verifyDiscussionSection(verdict([{passageId: 'p1', missingPoints: [point]}]), 3, ['p1']);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(DiscussionCoverageError);
      expect(error).toMatchObject({missingPoints: [`p1: ${point}`]});
    }
  });
  it.each(['', 'x'.repeat(1001), 123])('rejects malformed or unbounded coverage feedback %j', point => {
    expect(() => verifyDiscussionSection(verdict([{passageId: 'p1', missingPoints: [point]}]), 3, ['p1'])).toThrow(IncompleteDiscussionVerdictError);
  });
  it('requires a distinct coverage verdict for every supplied passage', () => {
    expect(() => verifyDiscussionSection(verdict([{passageId: 'p1', missingPoints: []}]), 3, ['p1', 'p2'])).toThrow(IncompleteDiscussionVerdictError);
    expect(() => verifyDiscussionSection(verdict([{passageId: 'p1', missingPoints: []}, {passageId: 'p1', missingPoints: []}]), 3, ['p1', 'p2'])).toThrow(IncompleteDiscussionVerdictError);
    expect(() => verifyDiscussionSection(verdict([{passageId: 'p1', missingPoints: []}, {passageId: 'p2', missingPoints: []}]), 3, ['p1', 'p2'])).not.toThrow();
  });
});


it.each([
  [1, 'Explain the absence of measured outcomes.'],
  [2, 'Explain the absence of measured outcomes.'],
  [1, 'Explain the omitted conditions on the central claim. '.repeat(11)],
] as const)('repairs %i rounds of substantive coverage findings before allowing narration (%s)', async (repairs, missingPoint) => {
  const longerSource = `SOURCE: Pilot\nSOURCE_ID: "used-book"\n\n${passages[0].text} ${'The limitations of this planned pilot remain important. '.repeat(40)}`;
  let reviews = 0;
  const onProgress = vi.fn();
  vi.mocked(chatCompletion).mockImplementation(async request => {
    const payload = JSON.parse(request.messages[1].content);
    if (payload.turns) {
      reviews++;
      return JSON.stringify({...JSON.parse(verified()), coverage: payload.passages.map((passage: {id: string}) => ({passageId: passage.id, missingPoints: reviews <= repairs ? [missingPoint] : []}))});
    }
    if (payload.previousSection) expect(payload.missingPoints).toEqual([`p1: ${missingPoint}`]);
    return JSON.stringify(plan());
  });
  await generatePodcastScript(longerSource, {type: 'deep-dive', onProgress});
  expect(chatCompletion).toHaveBeenCalledTimes(2 + repairs * 2);
  expect(onProgress.mock.calls.map(([progress]) => progress.phase)).toEqual(['drafting', 'reviewing', ...Array.from({length: repairs}, () => ['revising', 'reviewing']).flat()]);

});

it('stops after two unsuccessful semantic revisions without producing a script', async () => {
  const longerSource = `SOURCE: Pilot\nSOURCE_ID: "used-book"\n\n${passages[0].text} ${'The limitations of this planned pilot remain important. '.repeat(40)}`;
  vi.mocked(chatCompletion).mockImplementation(async request => {
    const payload = JSON.parse(request.messages[1].content);
    if (payload.turns) return JSON.stringify({...JSON.parse(verified()), coverage: payload.passages.map((passage: {id: string}) => ({passageId: passage.id, missingPoints: ['Explain the absence of measured outcomes.']}))});
    return JSON.stringify(plan());
  });
  await expect(generatePodcastScript(longerSource, {type: 'deep-dive'})).rejects.toThrow('omits substantive');
  expect(chatCompletion).toHaveBeenCalledTimes(6);
});

  it('preserves both factual rejections and coverage gaps for the same repair', () => {
    const verdict = JSON.stringify({
      verdicts: [{turnIndex: 0, supported: false, reason: 'The source does not attribute this claim to the prisoner.'}],
      coverage: [{passageId: 'p1', missingPoints: ['The stated limitation']}],
    });
    try {
      verifyDiscussionSection(verdict, 1, ['p1']);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toMatchObject({rejectedTurnIndexes: [0], missingPoints: ['p1: The stated limitation'], supportFeedback: ['Turn 0: The source does not attribute this claim to the prisoner.']});
    }
  });

  it('keeps a detailed rejection actionable instead of blocking its correction', () => {
    const reason = 'The claim requires another cited passage. '.repeat(12);
    expect(reason.length).toBeGreaterThan(400);
    try {
      verifyDiscussionSection(JSON.stringify({verdicts: [{turnIndex: 0, supported: false, reason}]}), 1);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(DiscussionSupportError);
      expect(error).toMatchObject({rejectedTurnIndexes: [0], supportFeedback: [`Turn 0: ${reason}`]});
    }
  });

  it.each(['', 'x'.repeat(1001), 123])('rejects malformed factual-review feedback %j', (reason) => {
    expect(() => verifyDiscussionSection(JSON.stringify({verdicts: [{turnIndex: 0, supported: false, reason}]}), 1)).toThrow();
  });

import { describe, expect, it } from "vitest";
import {
  alignCitationExcerptsWithClaims,
  buildNotebookContext,
  buildQuestionEvidenceDirective,
  buildSystemPrompt,
  chatWithNotebook,
  ensureExplicitMultiSourceGrounding,
  ensureNamedSourceGrounding,
  ensurePrimaryGrounding,
  finalizeSourceAwareAnswer,
  inferCitationsFromMarkers,
  parseCitationExcerpts,
  selectCitationExcerpt,
  selectRelevantContent,
  shouldUseConversationHistory,
} from "../services/aiChatService.js";

const sourceRefs = [
  {
    index: 1,
    id: "source-1",
    title: "Harness Engineering",
    type: "website",
  },
];

const sources = [
  {
    id: "source-1",
    content:
      "Reliable agents need explicit boundaries and observable feedback loops.",
  },
];

describe("AI chat grounding", () => {
  // Reconstructed from failed browser journeys; these are not complete live transcripts.
  it.each([
    {
      type: "website",
      introduction: 'Photosynthesis photosynthesis photosynthesis. Allen JF. The photosynthesis review. Journal of Theoretical Biology. Photosynthesis bibliography.',
      evidence: "During photosynthesis, plants absorb carbon dioxide and use light energy to produce sugars.",
      question: "What gas do plants absorb during photosynthesis?",
      claim: "Plants absorb carbon dioxide during photosynthesis.",
      fact: "carbon dioxide",
    },
    {
      type: "youtube",
      introduction: "Photosynthesis produces carbohydrates. Carbohydrates account for 60% of our food. Photosynthesis and carbohydrates are the topic of this introduction.",
      evidence: "The chloroplast transforms the original carbon dioxide gas into a simple carbohydrate called glucose, C-6-H-12-O-6.",
      question: "What simple carbohydrate does photosynthesis produce?",
      claim: "Photosynthesis produces the simple carbohydrate glucose.",
      fact: "glucose",
    },
  ])("selects the answered fact instead of a topic-heavy $type introduction", ({ introduction, evidence, question, claim, fact }) => {
    const content = `${introduction}\n${evidence}`;
    const citation = { citation_id: 1, source_id: "source-1", excerpt: introduction };
    const result = alignCitationExcerptsWithClaims(
      `${claim}[1]`, [citation], [{ id: "source-1", content }], question,
    );
    expect(result[0].excerpt).toContain(fact);
    expect(content.replace(/\s+/g, " ")).toContain(result[0].excerpt.replace(/\s+/g, " "));
  });

  it("keeps a citation when the excerpt is verbatim", () => {
    const rawAnswer =
      'Use explicit boundaries.[1]\n\nCITATIONS:\n[1] "explicit boundaries"';

    const result = parseCitationExcerpts(rawAnswer, sourceRefs, sources);

    expect(result.answer).toBe("Use explicit boundaries.[1]");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].source_id).toBe("source-1");
  });

  it("selects a literal excerpt that covers adjacent facts in the cited claim", () => {
    const content = [
      "The retrieval group answered short questions without notes, then checked immediate corrective feedback.",
      "Their average delayed-test score was 78%, compared with 61% for the rereading group.",
      "The trial coordinator was Dr. Amina Khumalo.",
      "The groups were not randomly assigned.",
    ].join("\n");

    const excerpt = selectCitationExcerpt(
      content,
      "Who coordinated the classroom trial, and what were the delayed-test scores?",
      "The trial coordinator was Dr. Amina Khumalo, and the delayed-test scores were 78% and 61%.",
    );

    expect(excerpt).toContain("78%");
    expect(excerpt).toContain("61%");
    expect(excerpt).toContain("Dr. Amina Khumalo");
    expect(content.replace(/\s+/g, " ")).toContain(excerpt);
  });

  it("prefers a coherent full-sentence citation over a higher-overlap fragment", () => {
    const content = [
      "The review recommends spreading successful recall attempts across increasing intervals rather than massing them into one session.",
      "It describes adjustable intervals as a practical scheduling approach and says the reviewed evidence does not establish one universally optimal spacing interval.",
      "The review does not claim that neurons or synapses are strengthened by a specific schedule.",
    ].join(" ");
    const claimContext = [
      "The Spacing Schedule Review recommends adjustable intervals as a practical scheduling approach.",
      "It does not establish one universally optimal spacing interval or a biological mechanism involving neurons or synapses.",
      "The sources do not directly study active recall and spacing as a combined intervention.",
    ].join(" ");

    const excerpt = selectCitationExcerpt(
      content,
      "Explain in depth why active recall and spacing work together, including the mechanism.",
      claimContext,
    );

    expect(excerpt).toMatch(/^It describes/);
    expect(excerpt.endsWith(".")).toBe(true);
    expect(excerpt).toContain("universally optimal spacing interval");
  });

  it("rejects an uncited quantitative paraphrase despite a verbatim weak citation", () => {
    const directSources = [
      {
        id: "trial-source",
        type: "text",
        content: [
          "Active recall is the act of retrieving an answer from memory before reviewing notes.",
          "In a six-week classroom trial at Meridian College, 84 first-year students were assigned to rereading or retrieval practice.",
          "The retrieval group answered short questions without notes, then checked immediate corrective feedback.",
          "Their average delayed-test score was 78%, compared with 61% for the rereading group.",
          "The trial coordinator was Dr. Amina Khumalo.",
          "The report cautions that the groups were not randomly assigned and that motivation was self-reported.",
        ].join("\n"),
      },
    ];
    const answer =
      "The trial coordinator was Dr. Amina Khumalo. The retrieval group had an average delayed-test score of 78%, while the rereading group had an average delayed-test score of 61%.";
    const weakCitation = {
      citation_id: 1,
      source_id: "trial-source",
      source_title: "Active Recall Field Study",
      source_type: "text",
      excerpt:
        "In a six-week classroom trial at Meridian College, 84 first-year students were assigned to rereading or retrieval practice. The retrieval group answered short questions without notes, then checked immediate corrective feedback.",
    };
    const result = alignCitationExcerptsWithClaims(
      answer,
      [weakCitation, { ...weakCitation }],
      directSources,
      "Who coordinated the classroom trial, and what were the delayed-test scores? Answer directly.",
    );

    expect(result).toEqual([]);
  });

  it("replaces a verbatim but weak citation with evidence that supports the claim", () => {
    const directSources = [
      {
        id: "trial-source",
        type: "text",
        content: [
          "Active recall is the act of retrieving an answer from memory before reviewing notes.",
          "In a six-week classroom trial at Meridian College, 84 first-year students were assigned to rereading or retrieval practice.",
          "The retrieval group answered short questions without notes, then checked immediate corrective feedback.",
          "Their average delayed-test score was 78%, compared with 61% for the rereading group.",
          "The trial coordinator was Dr. Amina Khumalo.",
          "The report cautions that the groups were not randomly assigned and that motivation was self-reported.",
        ].join("\n"),
      },
    ];
    const answer =
      "Their average delayed-test score was 78%, compared with 61% for the rereading group.[1]\nThe trial coordinator was Dr. Amina Khumalo.[1]";
    const weakCitation = {
      citation_id: 1,
      source_id: "trial-source",
      source_title: "Active Recall Field Study",
      source_type: "text",
      excerpt:
        "In a six-week classroom trial at Meridian College, 84 first-year students were assigned to rereading or retrieval practice. The retrieval group answered short questions without notes, then checked immediate corrective feedback.",
    };
    const result = alignCitationExcerptsWithClaims(
      answer,
      [weakCitation, { ...weakCitation }],
      directSources,
      "Who coordinated the classroom trial, and what were the delayed-test scores? Answer directly.",
    );

    expect(result).toHaveLength(1);
    expect(result[0].excerpt).toContain("78%");
    expect(result[0].excerpt).toContain("61%");
    expect(result[0].excerpt).toContain("Dr. Amina Khumalo");
    expect(result[0].excerpt).not.toContain("84 first-year students");
  });

  it("preserves opening metadata for publication and document-status questions", () => {
    const source = [
      "Title: WebRTC: Real-Time Communication in Browsers",
      "W3C Recommendation 13 March 2025",
      "Editors: Cullen Jennings and Florent Castelli",
      "",
      "Abstract This document defines a set of ECMAScript APIs in WebIDL.",
      " ".repeat(1400),
      "Status of This Document This section explains consensus, licensing, and implementation requirements.",
    ].join(" ");
    const selected = selectRelevantContent(
      source,
      "What is the document status and publication date, and what APIs does it define?",
      1400,
      "WebRTC: Real-Time Communication in Browsers",
    );
    expect(selected).toContain("W3C Recommendation 13 March 2025");
    expect(selected).toContain("ECMAScript APIs");
  });

  it("adds a seekable timestamp to a validated YouTube citation", () => {
    const youtubeRefs = [
      { index: 1, id: "video-1", title: "AI and Creativity", type: "youtube" },
    ];
    const youtubeSources = [
      {
        id: "video-1",
        type: "youtube",
        url: "https://www.youtube.com/watch?v=xw-9mwZxl-0",
        content: "Creativity means selecting from different possibilities.",
        metadata: JSON.stringify({
          videoId: "xw-9mwZxl-0",
          transcriptSegments: [
            {
              text: "An opening greeting.",
              offset: 0,
              duration: 3000,
              timingSource: "provider",
            },
            {
              text: "Creativity means selecting from different possibilities.",
              offset: 75_000,
              duration: 5000,
              timingSource: "provider",
            },
          ],
        }),
      },
    ];
    const result = parseCitationExcerpts(
      'Creativity is framed as selection.[1]\n\nCITATIONS:\n[1] "Creativity means selecting from different possibilities."',
      youtubeRefs,
      youtubeSources,
    );
    expect(result.citations[0]).toMatchObject({
      timestamp_seconds: 75,
      timestamp_label: "1:15",
      seek_url: "https://www.youtube.com/watch?v=xw-9mwZxl-0&t=75s",
    });
  });

  it("strips bracketed multiline citation metadata emitted by fallback models", () => {
    const rawAnswer =
      'Use explicit boundaries to improve reliability.\n\n[CITATIONS:]\n[1] "Reliable agents need explicit boundaries and observable\nfeedback loops."';

    const result = parseCitationExcerpts(rawAnswer, sourceRefs, sources);

    expect(result.answer).toBe(
      "Use explicit boundaries to improve reliability.",
    );
    expect(result.answer).not.toMatch(/CITATIONS/i);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].excerpt).toBe(
      "Reliable agents need explicit boundaries and observable feedback loops.",
    );
  });

  it("strips markdown-headed citation metadata emitted by fallback models", () => {
    const rawAnswer =
      'Use explicit boundaries to improve reliability.[1]\n\n### CITATIONS:\n[1] "Reliable agents need explicit boundaries and observable feedback loops."';

    const result = parseCitationExcerpts(rawAnswer, sourceRefs, sources);

    expect(result.answer).toBe(
      "Use explicit boundaries to improve reliability.[1]",
    );
    expect(result.answer).not.toMatch(/CITATIONS/i);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].source_id).toBe("source-1");
  });

  it("derives a verbatim structured citation when a model emits only a valid marker", () => {
    const answer = "Reliable agents need explicit boundaries and observable feedback loops.[1]";
    const result = inferCitationsFromMarkers(
      answer,
      sourceRefs,
      sources,
      "What do reliable agents need?",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      citation_id: 1,
      source_id: "source-1",
      source_title: "Harness Engineering",
    });
    expect(sources[0].content).toContain(result[0].excerpt);
  });

  it("adds deterministic grounding when the model omits citation markers", () => {
    const result = ensurePrimaryGrounding(
      "Reliable agents need explicit boundaries and observable feedback loops.",
      [],
      sourceRefs,
      sources,
      "What do reliable agents need?",
    );

    expect(result.answer).toContain("[1]");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].source_id).toBe("source-1");
    expect(sources[0].content).toContain(result.citations[0].excerpt);
  });

  it("does not attach deterministic grounding to an unrelated answer", () => {
    const result = ensurePrimaryGrounding(
      "Quarterly revenue increased after a pricing change.",
      [],
      sourceRefs,
      sources,
      "What changed in the financial results?",
    );

    expect(result.answer).not.toContain("[1]");
    expect(result.citations).toEqual([]);
  });

  it("recovers a missing citation for an explicit two-source comparison", () => {
    const refs = [
      { index: 1, id: "white-paper", title: "STI White Paper", type: "pdf" },
      { index: 2, id: "video", title: "AI and Creativity", type: "youtube" },
    ];
    const comparisonSources = [
      {
        id: "white-paper",
        type: "pdf",
        content:
          "The Fourth Industrial Revolution requires updated STI policy responses and positions artificial intelligence as an innovation driver.",
      },
      {
        id: "video",
        type: "youtube",
        url: "https://www.youtube.com/watch?v=xw-9mwZxl-0",
        content:
          "Intelligence is the ability to pursue goals and overcome problems. Consciousness is the ability to feel joy, love, pain, and anger.",
        metadata: JSON.stringify({
          videoId: "xw-9mwZxl-0",
          transcriptSegments: [
            {
              text: "Intelligence is the ability to pursue goals and overcome problems.",
              offset: 60_000,
              duration: 5000,
              timingSource: "provider",
            },
            {
              text: "Consciousness is the ability to feel joy, love, pain, and anger.",
              offset: 65_000,
              duration: 5000,
              timingSource: "provider",
            },
          ],
        }),
      },
    ];
    const answer = [
      "The White Paper treats AI as an innovation driver within the Fourth Industrial Revolution. [1]",
      "The video instead distinguishes intelligence as pursuing goals from consciousness as the ability to feel joy, love, pain, and anger.",
    ].join("\n\n");
    const result = ensureExplicitMultiSourceGrounding(
      answer,
      [
        {
          citation_id: 1,
          source_id: "white-paper",
          source_title: "STI White Paper",
          source_type: "pdf",
          excerpt: comparisonSources[0].content,
        },
      ],
      refs,
      comparisonSources,
      "Use both the STI White Paper and the YouTube source. Contrast their treatment of AI and cite both sources.",
    );
    expect(result.answer).toContain("[2]");
    expect(result.citations).toHaveLength(2);
    expect(result.citations[1]).toMatchObject({
      source_id: "video",
      timestamp_seconds: 60,
      timestamp_label: "1:00",
      seek_url: "https://www.youtube.com/watch?v=xw-9mwZxl-0&t=60s",
    });
  });

  it("grounds a missing citation when the answer explicitly names the supporting source", () => {
    const refs = [
      { index: 1, id: "trial", title: "Active Recall Field Study", type: "text" },
      { index: 2, id: "commentary", title: "Study Methods Commentary", type: "text" },
      { index: 3, id: "spacing", title: "Spacing Schedule Review", type: "text" },
    ];
    const namedSources = [
      {
        id: "trial",
        type: "text",
        content:
          "Their average delayed-test score was 78%, compared with 61% for the rereading group.",
      },
      {
        id: "commentary",
        type: "text",
        content:
          "The author claims a 30% improvement but provides no dataset or method, so the number cannot be verified.",
      },
      {
        id: "spacing",
        type: "text",
        content:
          "It summarizes three small studies, but only one directly measured university exam performance. That study reported a 9 percentage-point improvement over massed practice.",
      },
    ];
    const answer = [
      'The "Active Recall Field Study" reports 78% versus 61%. [1]',
      'The "Study Methods Commentary" makes an unsupported 30% claim. [2]',
      '### Uncertainties\nThe "Spacing Schedule Review" reports a 9 percentage-point improvement over massed practice.',
    ].join("\n\n");
    const result = ensureNamedSourceGrounding(
      answer,
      [
        {
          citation_id: 1,
          source_id: "trial",
          source_title: "Active Recall Field Study",
          source_type: "text",
          excerpt: namedSources[0].content,
        },
        {
          citation_id: 2,
          source_id: "commentary",
          source_title: "Study Methods Commentary",
          source_type: "text",
          excerpt: namedSources[1].content,
        },
      ],
      refs,
      namedSources,
      "Do these sources prove that active recall always beats rereading by 30%?",
    );

    expect(result.answer).toMatch(/Spacing Schedule Review[^\n]*\[3\]/);
    expect(result.citations).toHaveLength(3);
    expect(result.citations[2]).toMatchObject({
      citation_id: 3,
      source_id: "spacing",
    });
    expect(result.citations[2].excerpt).toContain("9 percentage-point improvement");
  });

  it("does not attach every source without an explicit all-source citation request", () => {
    const result = ensureExplicitMultiSourceGrounding(
      "Explicit boundaries improve reliability. [1]",
      [
        {
          citation_id: 1,
          source_id: "source-1",
          source_title: "Harness Engineering",
          source_type: "website",
          excerpt: sources[0].content,
        },
      ],
      [...sourceRefs, { index: 2, id: "other", title: "Other", type: "text" }],
      [
        ...sources,
        {
          id: "other",
          type: "text",
          content: "Unrelated quarterly revenue projections.",
        },
      ],
      "What do reliable agents need?",
    );
    expect(result.answer).not.toContain("[2]");
    expect(result.citations).toHaveLength(1);
  });

  it("refuses to recover an unrelated missing source even when both citations are requested", () => {
    const result = ensureExplicitMultiSourceGrounding(
      "Explicit boundaries improve reliability. [1]",
      [
        {
          citation_id: 1,
          source_id: "source-1",
          source_title: "Harness Engineering",
          source_type: "website",
          excerpt: sources[0].content,
        },
      ],
      [
        ...sourceRefs,
        { index: 2, id: "finance", title: "Finance Report", type: "pdf" },
      ],
      [
        ...sources,
        {
          id: "finance",
          type: "pdf",
          content:
            "Quarterly revenue increased while operating expenses declined.",
        },
      ],
      "Compare the two documents and cite both sources.",
    );
    expect(result.answer).not.toContain("[2]");
    expect(result.citations).toHaveLength(1);
  });

  it("removes a citation marker when the excerpt is fabricated", () => {
    const rawAnswer =
      'Use a proprietary swarm protocol.[1]\n\nCITATIONS:\n[1] "proprietary swarm protocol"';

    const result = parseCitationExcerpts(rawAnswer, sourceRefs, sources);

    expect(result.answer).toBe("Use a proprietary swarm protocol.");
    expect(result.citations).toEqual([]);
  });

  it("uses a direct evidence-first agent prompt", () => {
    const prompt = buildSystemPrompt("agent", "dense");

    expect(prompt).toContain("untrusted reference material");
    expect(prompt).toContain("Do not invent bibliographic details");
    expect(prompt).toContain("use them as the sole factual basis");
    expect(prompt).toContain("Do not manufacture contradictions");
    expect(prompt).toContain("Explore next:");
    expect(prompt).not.toContain("Llama 3.1");
    expect(prompt).not.toContain("dark tone");
    expect(prompt).not.toContain("Cold Librarian");
  });

  it("adds question-specific constraints for source-limited mechanism questions", () => {
    const directive = buildQuestionEvidenceDirective(
      "Explain in depth why active recall and spacing work together, including the mechanism.",
      [
        { index: 1, title: "Active Recall Field Study" },
        { index: 2, title: "Spacing Schedule Review" },
      ],
    );

    expect(directive).toContain("do not establish a deeper mechanism");
    expect(directive).toContain("neurons");
    expect(directive).toContain("combined intervention");
    expect(directive).toContain('"Active Recall Field Study"');
    expect(directive).toContain("Explore next:");
    expect(directive).toContain("Skip it when it would feel repetitive or add no value");
    expect(directive).toContain("invent a limitation");
    expect(directive).toContain("compare a source with itself");
  });

  it("keeps direct factual questions brief and continuation-free", () => {
    const directive = buildQuestionEvidenceDirective(
      "Who coordinated the trial, and what were the exact scores? Answer directly.",
      [{ index: 1, title: "Active Recall Field Study" }],
    );

    expect(directive).toContain("one to three sentences");
    expect(directive).toContain("omit an Explore next line");
  });

  it("honors an exact sentence count and explicit no-follow-up request without changing default teaching", () => {
    const directive = buildQuestionEvidenceDirective(
      "Explain active recall in exactly two sentences, and don't ask me any follow-up questions.",
      sourceRefs,
    );
    const ordinaryTeaching = buildQuestionEvidenceDirective(
      "Explain active recall in simpler terms.",
      sourceRefs,
    );

    expect(directive).toContain("answer prose must contain exactly 2 sentences");
    expect(directive).toContain("Do not add a follow-up question, invitation, offer, or next step");
    expect(directive).toContain("CITATIONS metadata");
    expect(directive).not.toContain("When a concrete, evidence-linked next step would help");
    expect(ordinaryTeaching).not.toContain("EXPLICIT PRESENTATION OVERRIDE");
    expect(ordinaryTeaching).toContain("When a concrete, evidence-linked next step would help");
  });

  it("teaches explanations through evidence and labeled examples without requiring practice", () => {
    const directive = buildQuestionEvidenceDirective("Explain active recall in simpler terms.", sourceRefs);
    expect(directive).toContain("meaning in plain language");
    expect(directive).toContain("source-stated reasoning");
    expect(directive).toContain("connect that explanation to a cited passage");
    expect(directive).toContain("Label any illustrative inference and its assumptions");
    expect(directive).not.toContain("The user requested practice");
    expect(buildSystemPrompt("human", "conversational")).toContain("never require a quiz before answering");
  });

  it("honors natural quote requests and keeps quotation separate from explanation", () => {
    const directive = buildQuestionEvidenceDirective(
      "Can you share a memorable quote from this chapter?",
      sourceRefs,
    );
    const prompt = buildSystemPrompt("human", "conversational");

    expect(directive).toContain("Do not require a source to label a passage");
    expect(directive).toContain("concise, exact, verbatim line");
    expect(directive).toContain("keep your explanation outside the quote");
    expect(prompt).toContain("selecting the best supported material");
    expect(prompt).toContain("Keep exact quotations verbatim");
  });

  it("keeps response structure and learner follow-ups flexible", () => {
    const prompt = buildSystemPrompt("human", "conversational");

    expect(prompt).toContain("amount of structure the question needs");
    expect(prompt).toContain("genuinely multi-part explanation");
    expect(prompt).not.toContain("DO NOT use markdown headers");
    expect(prompt).toContain("Do not routinely append \"Explore next:\"");
    expect(prompt).toContain("vary the form and wording");
  });

  it("respects brief explanation requests instead of forcing a lesson", () => {
    const directive = buildQuestionEvidenceDirective("Explain active recall in one sentence.", sourceRefs);
    expect(directive).toContain("one to three sentences");
    expect(directive).not.toContain("Teach the requested idea");
  });

  it("recognizes passage learning actions without loosening their evidence contract", () => {
    const explanation = buildQuestionEvidenceDirective("Explain this passage in simpler terms, grounded in the source.", sourceRefs);
    expect(explanation).toContain("Teach the requested idea");
    expect(explanation).toContain("connect that explanation to a cited passage");
    expect(explanation).toContain("without inventing a cause or effort claim");
    expect(explanation).toContain("CITATIONS: on its own line");
    expect(explanation).toContain("one source marker at its end");
    const practice = buildQuestionEvidenceDirective("Test my understanding of this passage. Ask one question and wait for my answer.", sourceRefs);
    expect(practice).toContain("ask one focused question and wait");
    expect(practice).toContain("only the question and its source marker");
    expect(practice).toContain("Do not quote or paraphrase the answer");
    expect(practice).toContain("Omit Explore next and other extra questions");
    expect(practice).toContain("wait for the learner's attempt before revealing or explaining its answer");
    expect(practice).toContain("An immediate-answer request does not change this one-question-at-a-time flow");
    expect(practice).not.toContain("include them instead");
    expect(practice).toContain("Keep all required source markers and literal citation excerpts");
  });

  it("distinguishes interactive practice from a requested question set and discussion of quizzes", () => {
    const interactive = buildQuestionEvidenceDirective("Quiz me on active recall.", sourceRefs);
    expect(interactive).toContain("ask one focused question and wait");
    expect(interactive).toContain("practice never overrides the evidence contract");
    const immediateAnswers = buildQuestionEvidenceDirective("Quiz me on active recall and tell me the answer now.", sourceRefs);
    expect(immediateAnswers).toContain("wait for the learner's attempt before revealing or explaining its answer");
    expect(immediateAnswers).not.toContain("include them instead");
    expect(interactive).not.toContain("you may end with one short question");
    const batch = buildQuestionEvidenceDirective("Give me three practice questions with answers.", sourceRefs);
    expect(batch).toContain("match the requested format and count");
    expect(batch).not.toContain("ask one focused question and wait");
    const discussion = buildQuestionEvidenceDirective("Explain how practice questions help in this study.", sourceRefs);
    expect(discussion).not.toContain("The user requested practice");
  });

  it("recognizes natural practise tutoring requests without treating discussion as a quiz request", () => {
    const practiceRequest = buildQuestionEvidenceDirective(
      "Help me practise the main idea from these sources. Ask one question at a time and wait for my answer before revealing the answer. Then give brief feedback supported by a source citation and help me correct any misunderstanding.",
      sourceRefs,
    );
    expect(practiceRequest).toContain("The user requested practice");
    expect(practiceRequest).toContain("ask one focused question and wait");
    expect(practiceRequest).toContain("wait for the learner's attempt before revealing or explaining its answer");

    const practiceSpelling = buildQuestionEvidenceDirective("Help me practice the main idea. Ask one question at a time and wait for my answer.", sourceRefs);
    expect(practiceSpelling).toContain("ask one focused question and wait");

    const discussion = buildQuestionEvidenceDirective("Explain how practice questions help learners remember ideas.", sourceRefs);
    expect(discussion).not.toContain("The user requested practice");
  });

  it("recognizes an imperative quick-practice prompt only when it asks for turn-taking", () => {
    const quickPrompt = buildQuestionEvidenceDirective(
      "Practise the main idea from these sources. Ask one question at a time and wait for my answer before revealing it.",
      sourceRefs,
    );
    expect(quickPrompt).toContain("The user requested practice");
    expect(quickPrompt).toContain("ask one focused question and wait");
    expect(quickPrompt).toContain("visible practice response must contain only the question and its source marker");

    const descriptive = buildQuestionEvidenceDirective(
      "Explain how practice questions help learners understand the main idea.",
      sourceRefs,
    );
    expect(descriptive).not.toContain("The user requested practice");
  });

  it.each(["My answer is spaced repetition.", "Why is that wrong?", "Check my reasoning."])("gives evidence-based feedback for %s", (message) => {
    const directive = buildQuestionEvidenceDirective(message, sourceRefs);
    expect(directive).toContain("explain any specific reasoning gap");
    expect(directive).toContain("CITATIONS: on its own line");
    expect(directive).toContain("Omit Explore next and other extra questions");
    expect(directive).toContain("If the prior question is unavailable, ask for it");
    expect(directive).not.toContain("you may end with one short question");
  });

  it("routes short learner attempts to feedback only with a prior assistant question", () => {
    const history = [
      { role: "user", content: "Help me practise active recall. Ask one question at a time and wait for my answer." },
      { role: "assistant", content: "Which method asks you to retrieve without looking at notes? [1]" },
    ];
    expect(buildQuestionEvidenceDirective("Active recall.", sourceRefs, history)).toContain("Respond to the learner's attempt");
    expect(buildQuestionEvidenceDirective("I think active recall.", sourceRefs, history)).toContain("Respond to the learner's attempt");
    expect(buildQuestionEvidenceDirective("B", sourceRefs, history)).toContain("Respond to the learner's attempt");
    expect(buildQuestionEvidenceDirective("What is the spacing effect?", sourceRefs, history)).not.toContain("Respond to the learner's attempt");
    expect(buildQuestionEvidenceDirective("Explain spacing in one sentence.", sourceRefs, history)).not.toContain("Respond to the learner's attempt");
    expect(buildQuestionEvidenceDirective("B", sourceRefs)).not.toContain("Respond to the learner's attempt");
    expect(buildQuestionEvidenceDirective("Active recall.", sourceRefs, [
      { role: "user", content: "What is the main idea?" },
      { role: "assistant", content: "Which idea do you mean?" },
    ])).not.toContain("Respond to the learner's attempt");
  });

  it("does not guess through an ambiguous source-grounded question", () => {
    const directive = buildQuestionEvidenceDirective(
      "What should I do first?",
      [
        { index: 1, title: "Active Recall Field Study" },
        { index: 2, title: "Beginner Orientation Commentary" },
      ],
    );

    expect(directive).toContain("user state unspecified");
    expect(directive).toContain("Do not silently choose one interpretation");
    expect(directive).toContain("as an inference");
  });

  it("separates evidence strength from genuine conflicts and universal claims", () => {
    const comparisonDirective = buildQuestionEvidenceDirective(
      "Compare all three sources. Do they conflict on whether a beginner should retrieve immediately?",
      [
        { index: 1, title: "Active Recall Field Study" },
        { index: 2, title: "Beginner Orientation Commentary" },
      ],
    );
    const incompleteDirective = buildQuestionEvidenceDirective(
      "Do these sources prove that active recall always improves exam scores by at least 30%?",
      [{ index: 1, title: "Active Recall Field Study" }],
    );

    expect(comparisonDirective).toContain("nuances, not conflicts");
    expect(incompleteDirective).toContain("Separate supported findings");
    expect(incompleteDirective).toContain("universal rule");
    expect(incompleteDirective).toContain("percentage-point difference");
  });

  it("removes generic framing without manufacturing a limitation or comparison", () => {
    const answer = [
      "## Introduction to the evidence",
      "The notebook links retrieval practice with immediate feedback and describes spacing as creating desirable difficulty. The field study reports delayed-test scores and limitations, while the review proposes adjustable intervals. The commentary adds a beginner-orientation condition without directly contradicting the trial.",
      "## Conclusion",
      "The practical implication is to orient first when needed, retrieve without notes, check feedback, and adapt intervals after successful or failed recall.",
    ].join("\n\n");

    const finalized = finalizeSourceAwareAnswer(
      answer,
      "Explain in depth why active recall and spacing work together.",
      [
        { index: 1, title: "Active Recall Field Study" },
        { index: 2, title: "Spacing Schedule Review" },
      ],
    );

    expect(finalized).not.toMatch(/## Introduction/i);
    expect(finalized).not.toMatch(/## Conclusion/i);
    expect(finalized).not.toContain("Explore next:");
    expect(finalized).toContain("The practical implication is to orient first");
  });

  it("does not append a self-comparison to the deployed single-source Plato overview", () => {
    const answer = "INTRODUCTION AND ANALYSIS The Republic of Plato is the longest of his works with the exception of the Laws, and is certainly the greatest of them[2]. The Republic of Plato is also the first treatise upon education, of which the writings of Milton and Locke, Rousseau, Jean Paul, and Goethe are the legitimate descendants[3].";

    expect(finalizeSourceAwareAnswer(answer, "what is Plato republic about", [
      { index: 1, title: "plato_-_the_republic.pdf" },
    ])).toBe(answer);
  });

  it.each([
    "Compare the study and the review.",
    "How should I apply this for my exam?",
    "Do these sources prove this always works?",
  ])("does not invent unresolved gaps or exam tasks after answering %s", (question) => {
    const answer = "The study reports higher delayed-test scores for the retrieval group, while the review recommends adjusting intervals after recall. [1][2] The sources describe separate findings; neither source establishes the effects of a combined intervention. Their recommendations can be described without adding an unsupported claim about a causal mechanism. [1][2]";

    expect(finalizeSourceAwareAnswer(answer, question, [
      { index: 1, title: "Active Recall Field Study" },
      { index: 2, title: "Spacing Schedule Review" },
    ])).toBe(answer);
  });

  it("preserves a specific continuation already supplied with the grounded answer", () => {
    const answer = "The review recommends adjusting intervals after successful or failed recall. [1]\n\nExplore next: Which interval adjustment does the review recommend after failed recall?";

    expect(finalizeSourceAwareAnswer(answer)).toBe(answer);
  });

  it("does not append a continuation to a direct factual answer", () => {
    const finalized = finalizeSourceAwareAnswer(
      "Dr. Amina Khumalo coordinated the trial. The scores were 78% and 61%. [1]",
      "Who coordinated the trial, and what were the exact scores? Answer directly.",
      [{ index: 1, title: "Active Recall Field Study" }],
    );

    expect(finalized).not.toContain("Explore next:");
  });

  it("ranks an explicitly named short source ahead of a huge generic document", () => {
    const notebook = {
      title: "QA Notebook",
      description: "Mixed research sources",
    };
    const query =
      "Use only the Blue Lantern QA Field Note. Who is the coordinator and what is the code phrase?";
    const hugeGenericDocument = `${"The group and source information appears in general English prose. ".repeat(4000)}`;
    const blueLantern =
      "The Blue Lantern study group is coordinated by Naledi Mokoena. The code phrase is ORBITAL-PENGUIN-731.";

    const result = buildNotebookContext(
      notebook,
      [
        {
          id: "generic",
          title: "plain-english.txt",
          type: "text",
          content: hugeGenericDocument,
        },
        {
          id: "blue",
          title: "Blue Lantern QA Field Note",
          type: "text",
          content: blueLantern,
        },
      ],
      [],
      query,
    );

    expect(result.sourceRefs[0]).toMatchObject({
      id: "blue",
      title: "Blue Lantern QA Field Note",
    });
    expect(result.context).toContain("[1] SOURCE: Blue Lantern QA Field Note");
    expect(result.context).toContain("Naledi Mokoena");
    expect(result.context).toContain("ORBITAL-PENGUIN-731");
  });

  it("selects a relevant passage from deep inside a long source", () => {
    const notebook = { title: "Transformer Research" };
    const filler =
      "Unrelated introductory material about document formatting. ".repeat(300);
    const target =
      "The encoder is composed of a stack of N = 6 identical layers. The model dimension is d_model = 512.";
    const content = `${filler}${target}${filler}`;

    const result = buildNotebookContext(
      notebook,
      [
        {
          id: "paper",
          title: "attention-is-all-you-need.pdf",
          type: "pdf",
          content,
        },
      ],
      [],
      "According to Attention Is All You Need, how many encoder layers are used and what is d_model?",
    );

    expect(result.context).toContain("N = 6 identical layers");
    expect(result.context).toContain("d_model = 512");
  });

  it("prefers a requested document over a related webpage and retrieves a numbered section", () => {
    const query =
      "According to the South African Constitution document, name three founding values in section 1.";
    const result = buildNotebookContext(
      { title: "Constitution Study" },
      [
        {
          id: "web",
          title: "The SA Constitution",
          type: "website",
          content:
            "The preamble refers to democratic values, social justice and fundamental human rights.",
        },
        {
          id: "pdf",
          title: "SA-Constitution.pdf",
          type: "pdf",
          content: `${"Contents and introductory material. ".repeat(160)}\nCHAPTER 1 FOUNDING PROVISIONS\nSECTION 1 — FOUNDING PROVISIONS\nThe Republic is founded on the following values: (a) Human dignity, the achievement of equality and the advancement of human rights and freedoms. (b) Non-racialism and non-sexism. (c) Supremacy of the constitution and the rule of law.`,
        },
      ],
      [],
      query,
    );

    expect(result.sourceRefs[0]).toMatchObject({ id: "pdf", type: "pdf" });
    expect(result.context).toContain("Human dignity");
    expect(result.context).toContain("achievement of equality");
    expect(result.context).toContain("Supremacy of the constitution");
  });

  it("scopes long-book retrieval to the requested Plato book heading", () => {
    const content = [
      "Introduction: Plato's Republic contains Book IV, and this overview repeats justice and harmony many times. ".repeat(50),
      "BOOK I — Justice and the City",
      "Book I evidence: justice means paying debts and returning what is owed.",
      "BOOK IV — Justice and the Soul",
      "Book IV evidence: justice is harmony among the parts of the soul and the city.",
      "The guardians preserve harmony through education and shared civic duties.",
      "BOOK V — The Philosopher Rulers",
      "Book V evidence: philosophers should rule because they know the good.",
    ].join("\n");
    const selected = selectRelevantContent(
      content,
      "According to Plato's Republic, explain Book IV and its account of justice.",
      1800,
      "Plato's Republic",
    );

    expect(selected).toContain("Book IV evidence: justice is harmony");
    expect(selected).toContain("guardians preserve harmony");
    expect(selected).not.toContain("Introduction:");
    expect(selected).not.toContain("Book I evidence");
    expect(selected).not.toContain("Book V evidence");
  });

  it("prefers structural EPUB headings over repeated introduction titles", () => {
    const selected = selectRelevantContent([
      "INTRODUCTION AND ANALYSIS",
      "--- BOOK I. The Republic opens with a truly Greek scene ---",
      "The introduction mentions Atlantis and summarizes justice.",
      "--- BOOK II. Thrasymachus is pacified ---",
      "More introductory analysis, not the structural book.",
      "--- BOOK I ---",
      "I went down yesterday to the Piraeus with Glaucon.",
      "Socrates asks what justice is; the discussion considers whether it benefits the stronger.",
      "BOOK II. appears in this paragraph as a reference, not a heading.",
      "--- BOOK II ---",
      "The next book begins with a different argument.",
    ].join("\n"), "At Reader position: Structural section: Book I. Explain the opening discussion of justice.", 1800, "Plato Republic");
    expect(selected).toContain("I went down yesterday to the Piraeus");
    expect(selected).toContain("what justice is");
    expect(selected).toContain("BOOK II. appears in this paragraph");
    expect(selected).not.toContain("INTRODUCTION AND ANALYSIS");
    expect(selected).not.toContain("Atlantis");
    expect(selected).not.toContain("next book begins");
  });

  it("accepts EPUB BOOK I. headings and stops at the standalone BOOK II. boundary", () => {
    const selected = selectRelevantContent(
      [
        "Introduction: BOOK I. and BOOK II. are listed in this overview, alongside Atlantis.",
        "BOOK I.",
        "I went down yesterday to the Piraeus with Glaucon.",
        "The phrase BOOK II. appears in prose here and must not end this section.",
        "BOOK II.",
        "With these words, the argument turns to a different question.",
      ].join("\n"),
      "At Reader position: Structural section: Book I. Explain what happens at the Piraeus.",
      1800,
      "Plato's Republic",
    );

    expect(selected).toContain("I went down yesterday to the Piraeus");
    expect(selected).toContain("The phrase BOOK II. appears in prose");
    expect(selected).not.toContain("Introduction:");
    expect(selected).not.toContain("With these words");
  });

  it("deduplicates adjacent EPUB Book I heading variants while keeping the Book II boundary", () => {
    const selected = selectRelevantContent(
      [
        "Introduction: Atlantis and justice are discussed here, but are not Book I evidence.",
        "--- BOOK I. ---",
        "",
        "BOOK I.",
        "I went down yesterday to the Piraeus with Glaucon.",
        "Socrates and Cephalus discuss justice before Thrasymachus enters the debate.",
        "--- BOOK II. ---",
        "The second book begins with a different argument.",
      ].join("\n"),
      "At Reader position: Structural section: Book I. Explain the opening discussion of justice.",
      1800,
      "Plato's Republic",
    );

    expect(selected).toContain("I went down yesterday to the Piraeus");
    expect(selected).toContain("Socrates and Cephalus discuss justice");
    expect(selected).not.toContain("Introduction:");
    expect(selected).not.toContain("second book begins");
  });

  it("does not substitute unrelated evidence when an explicitly requested book is absent", () => {
    const selected = selectRelevantContent(
      "Introduction mentions Book IV, but the extracted text has no Book IV heading.\nBOOK I\nJustice is discussed here.",
      "Explain Book IV.",
      1200,
      "Plato's Republic",
    );
    expect(selected).toBe("");
  });

  it("omits notebook notes without section provenance from explicit chapter context only", () => {
    const notebook = { title: "Plato's Republic" };
    const sources = [{
      id: "republic",
      title: "Plato's Republic",
      type: "epub",
      content: "BOOK I.\nSocrates goes down to the Piraeus and discusses justice.\nBOOK II.\nA different discussion begins.",
    }];
    const notes = [{ content: "Introduction note: Atlantis is mentioned before Book I.", created_at: "2026-10-22" }];

    const chapterContext = buildNotebookContext(
      notebook,
      sources,
      notes,
      "[Reader position: 146 seconds. Structural section: Book I.] Explain the opening discussion of justice.",
    );
    expect(chapterContext.context).toContain("Piraeus");
    expect(chapterContext.context).not.toContain("=== NOTES");
    expect(chapterContext.context).not.toContain("Atlantis");

    const unscopedContext = buildNotebookContext(
      notebook,
      sources,
      notes,
      "Summarize my notes about Atlantis.",
    );
    expect(unscopedContext.context).toContain("=== NOTES");
    expect(unscopedContext.context).toContain("Atlantis");
  });

  it("rejects a heading-only requested book without falling back to introduction text", async () => {
    const sourceContent = [
      "Introduction: Atlantis and justice are discussed here, but are not Book I evidence.",
      "BOOK I.",
      "BOOK II.",
      "The second book contains unrelated material.",
    ].join("\n");
    const message = "At Reader position: Structural section: Book I. Explain the opening discussion of justice.";
    const selected = selectRelevantContent(
      sourceContent,
      message,
      1200,
      "Plato's Republic",
    );

    expect(selected).toBe("");
    await expect(chatWithNotebook({
      notebook: { id: "notebook-1", title: "Plato's Republic" },
      sources: [{ id: "republic", title: "Plato's Republic", type: "epub", content: sourceContent }],
      notes: [],
      message,
      allowWebFallback: false,
    })).rejects.toMatchObject({ code: "REQUESTED_SECTION_NOT_FOUND" });
  });

  it("fails closed when a reader-position book is only mentioned in prose", async () => {
    const message = "What does justice mean here? [Reader position: 146 seconds. Structural section: Book I.]";

    expect(shouldUseConversationHistory(message, [
      { role: "assistant", content: "The introduction discusses Atlantis." },
    ])).toBe(false);

    await expect(
      chatWithNotebook({
        notebook: { id: "notebook-1", title: "Plato's Republic" },
        sources: [{
          id: "republic",
          title: "Plato's Republic",
          type: "epub",
          content: "Introduction mentions Book I, justice, and Atlantis, but no structural Book I heading was extracted.",
        }],
        notes: [],
        message,
        history: [{ role: "assistant", content: "The introduction discusses Atlantis." }],
        allowWebFallback: false,
      }),
    ).rejects.toMatchObject({ code: "REQUESTED_SECTION_NOT_FOUND" });
  });

  it("scopes explicit chapter requests to that chapter through the next chapter heading", () => {
    const selected = selectRelevantContent(
      "CHAPTER 3\nEarlier chapter evidence about memory and attention.\nCHAPTER 4\nChapter four explains memory through spaced recall.\nCHAPTER 5\nLater evidence about attention.",
      "Explain Chapter 4 memory.",
      1200,
    );
    expect(selected).toContain("Chapter four explains memory");
    expect(selected).not.toContain("Earlier chapter evidence");
    expect(selected).not.toContain("Later evidence");
  });

  it("does not mistake numbered prose or list items for an explicit section heading", () => {
    const selected = selectRelevantContent(
      [
        "Introduction mentions Section 1, and cites 1. in passing.",
        "- 1. A numbered list item describes human dignity.",
        "1. The ordinary list continues with equality.",
        "2. The next list item mentions supremacy.",
      ].join("\n"),
      "Explain Section 1.",
      1200,
    );
    expect(selected).toBe("");
  });

  it("keeps Chapter N of Book M inside that book even when another book repeats the chapter", () => {
    const selected = selectRelevantContent(
      [
        "Introduction: Book I and Book II each discuss justice.",
        "BOOK I — First Book",
        "CHAPTER 3 — Earlier",
        "Book I chapter three: background.",
        "CHAPTER 4 — Target",
        "Book I chapter four evidence: justice is tested through the philosopher's knowledge.",
        "CHAPTER 5 — Later",
        "Book I chapter five: additional material.",
        "BOOK II — Second Book",
        "CHAPTER 4 — Repeated chapter number",
        "Book II chapter four evidence: justice depends on military discipline and courage.",
      ].join("\n"),
      "According to the text, explain Chapter 4 of Book I and justice.",
      1200,
      "Plato's Republic",
    );
    expect(selected).toContain("Book I chapter four evidence");
    expect(selected).not.toContain("Book II chapter four evidence");
    expect(selected).not.toContain("Book I chapter three");
    expect(selected).not.toContain("Book I chapter five");
    expect(selected).not.toContain("Introduction:");
  });

  it("returns no evidence when the requested chapter is absent from the named book", () => {
    const selected = selectRelevantContent(
      "BOOK I\nCHAPTER 4\nOnly chapter four is present.\nBOOK II\nCHAPTER 4\nWrong book evidence.",
      "Explain Chapter 5 of Book I.",
      1200,
    );
    expect(selected).toBe("");
  });

  it("rejects an unusable explicit source scope instead of falling back to the web", async () => {
    await expect(
      chatWithNotebook({
        notebook: { id: "notebook-1", title: "Scoped research" },
        sources: [
          {
            id: "failed-source",
            title: "Failed PDF",
            type: "pdf",
            content: "",
            processing_status: "failed",
          },
        ],
        notes: [],
        message: "Summarize only this source.",
        allowWebFallback: false,
      }),
    ).rejects.toMatchObject({
      code: "NO_USABLE_SOURCES",
    });
  });

  it("uses history for clear follow-ups but not unrelated fresh questions", () => {
    expect(shouldUseConversationHistory("What about the second source?")).toBe(
      true,
    );
    expect(
      shouldUseConversationHistory("Expand that answer with an example."),
    ).toBe(true);
    expect(
      shouldUseConversationHistory(
        "According to Attention Is All You Need, what is d_model?",
      ),
    ).toBe(false);
    expect(
      shouldUseConversationHistory(
        "Name three founding constitutional values.",
      ),
    ).toBe(false);
  });

  it.each(["My answer is retrieval practice.", "Check my answer.", "Why is that wrong?", "Give me a hint.", "Next question."])("retains learning context for explicit follow-up %s", (message) => {
    expect(shouldUseConversationHistory(message)).toBe(true);
  });

  it("retains quiz attempts with a prior question while isolating fresh research", () => {
    const history = [{ role: "user", content: "Quiz me." }, { role: "assistant", content: "Which method uses retrieval? A. Recall B. Rereading" }];
    expect(shouldUseConversationHistory("A", history)).toBe(true);
    expect(shouldUseConversationHistory("I think recall.", history)).toBe(true);
    expect(shouldUseConversationHistory("I think recall.", [])).toBe(false);
    expect(shouldUseConversationHistory("B", [{ role: "assistant", content: "Recall uses retrieval." }])).toBe(false);
    expect(shouldUseConversationHistory("I think this is a new topic. What is d_model?", history)).toBe(false);
    expect(shouldUseConversationHistory("According to the Constitution, name the founding values.", history)).toBe(false);
  });

  it("inherits practice context for a bare subject answer but not an unrelated new question", () => {
    const history = [
      { role: "user", content: "Help me practise the main idea. Ask one question at a time and wait for my answer." },
      { role: "assistant", content: "Which method asks you to retrieve information from memory? [1]" },
    ];

    expect(shouldUseConversationHistory("Active recall.", history)).toBe(true);
    expect(shouldUseConversationHistory("What is the spacing effect?", history)).toBe(false);
    expect(shouldUseConversationHistory("Explain the spacing effect.", history)).toBe(false);
  });
});

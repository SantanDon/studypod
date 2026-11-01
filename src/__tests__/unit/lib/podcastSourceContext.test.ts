import { describe, expect, it } from "vitest";
import { buildPodcastSourceContext } from "@/lib/podcastSourceContext";
import { compilePodcastEvidence, indexPodcastEvidence } from "@/lib/audio/podcastEvidencePlan";

const section = (heading: string, marker: string) =>
  `\n${heading}\n${marker} ${"discussion ".repeat(900)}`;

const republic = [
  "INTRODUCTION AND ANALYSIS\nEDITORIAL_INTRO " + "commentary ".repeat(5000),
  section("BOOK I", "JUSTICE_BOOK_ONE"),
  section("BOOK II", "GYGES_BOOK_TWO"),
  section("BOOK III", "EDUCATION_BOOK_THREE"),
  section("BOOK IV", "SOUL_BOOK_FOUR"),
  section("BOOK V", "PHILOSOPHER_RULERS_BOOK_FIVE"),
  section("BOOK VI", "FORM_OF_GOOD_BOOK_SIX"),
  section("BOOK VII", "CAVE_BOOK_SEVEN allegory cave shadows education"),
  section("BOOK VIII", "REGIMES_BOOK_EIGHT"),
  section("BOOK IX", "TYRANT_BOOK_NINE"),
  section("BOOK X", "ER_BOOK_TEN"),
].join("");

describe("buildPodcastSourceContext", () => {
  it("samples across a long structured book instead of spending the budget on its introduction", () => {
    const context = buildPodcastSourceContext(
      [{ id: "republic", title: "The Republic", content: republic }],
      { maxChars: 12_000 },
    );

    expect(context).toContain("BOOK I");
    expect(context).toContain("BOOK VII");
    expect(context).toContain("BOOK X");
    expect(context).toContain("ER_BOOK_TEN");
  });

  it("prioritizes the requested book and concept", () => {
    const context = buildPodcastSourceContext(
      [{ id: "republic", title: "The Republic", content: republic }],
      { focus: "Book VII allegory of the cave", maxChars: 6_000 },
    );

    expect(context).toContain("BOOK VII");
    expect(context).toContain("CAVE_BOOK_SEVEN");
    expect(context).toContain("cave shadows education");
  });

  it("deduplicates a derived audio source against its original source", () => {
    const context = buildPodcastSourceContext(
      [
        { id: "pdf-1", title: "The Republic", content: "BOOK I\nORIGINAL" },
        {
          id: "audio-1",
          title: "The Republic audiobook",
          content: "BOOK I\nDUPLICATE_AUDIO_TRANSCRIPT",
          metadata: { derivedFromSourceId: "pdf-1" },
        },
      ],
      { maxChars: 5_000 },
    );

    expect(context).toContain("ORIGINAL");
    expect(context).not.toContain("DUPLICATE_AUDIO_TRANSCRIPT");
  });

  it("preserves ordinary research headings through budgeting, indexing, and deep compilation", () => {
    const methods = "We measured the samples using the stated protocol.";
    const results = "The observed results include the reported uncertainty.";
    const content = `Methods\n\n${methods}\n\nResults\n\n${results}\n\nThe treatment was measured.`;
    const context = buildPodcastSourceContext([{ id: "paper", title: "Study", content }], { maxChars: 5_000 });
    expect(context).toContain("[SECTION: Methods]");
    expect(context).toContain("[SECTION: Results]");

    const indexed = indexPodcastEvidence(context);
    expect(indexed.passages.slice(0, 2).map(({ sectionHeading }) => sectionHeading)).toEqual(["Methods", "Results"]);
    expect(indexed.passages.slice(0, 2).map(({ text }) => text)).toEqual([methods, results]);
    expect(indexed.passages[2].text).toBe("The treatment was measured.");

    const compiled = compilePodcastEvidence(
      JSON.stringify({ passageIds: ["p2", "p1"] }), indexed.passages, "Alex", "Sam", false, "deep-dive", 1_000,
    );
    expect(compiled.evidencePassageIds).toEqual(["p1", "p2"]);
    expect(compiled.segments.map(({ text }) => text)).toContain(methods);
    expect(compiled.segments.map(({ text }) => text)).toContain(results);
    expect(compiled.segments.some(({ text }) => text === "Let’s turn to Methods.")).toBe(true);
    expect(compiled.segments.some(({ text }) => text === "Let’s turn to Results.")).toBe(true);
  });

  it("retains markdown and numbered headings but does not classify ordinary prose as headings", () => {
    const context = buildPodcastSourceContext([{
      id: "report", title: "Report", content: "# Scope\n\nScope text.\n\n2.1 Findings\n\nFinding text.\n\nThe findings were mixed across samples.",
    }], { maxChars: 5_000 });
    const indexed = indexPodcastEvidence(context);
    expect(indexed.passages.slice(0, 2).map(({ sectionHeading }) => sectionHeading)).toEqual(["Scope", "Findings"]);
    expect(indexed.passages[2].text).toBe("The findings were mixed across samples.");
  });
});

import { describe, expect, it } from "vitest";
import { buildPodcastSourceContext } from "@/lib/podcastSourceContext";

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
});

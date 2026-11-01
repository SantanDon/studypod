import { describe, expect, it } from "vitest";
import {
  narrationCleanupStats,
  narrationHeading,
  prepareNarrationText,
} from "../services/audiobookNarrationTextService.js";

describe("audiobookNarrationTextService", () => {
  it("turns structural headings into narration-friendly pauses", () => {
    expect(narrationHeading("CHAPTER 12: The 10x Shift")).toBe(
      "Chapter 12. The 10x Shift.",
    );
    expect(narrationHeading("Conclusion — What Comes Next")).toBe(
      "Conclusion. What Comes Next.",
    );
  });

  it("removes publishing furniture and expands speech-sensitive tokens", () => {
    const narration = prepareNarrationText(
      [
        "CHAPTER 1: A Better System",
        "12",
        "The organi-",
        "zation improved by 25% while AI & API adoption grew 10x.",
        "www.example.com",
        "ISBN: 978-1-23456-789-0",
        "- First practical step",
        "[12] This reference marker should not be read aloud.",
      ].join("\n"),
      { title: "Chapter 1: A Better System" },
    );

    expect(narration).toContain("Chapter 1. A Better System.");
    expect(narration).toContain("organi- zation improved by 25 percent");
    expect(narration).toContain("A I and A P I adoption grew 10 times");
    expect(narration).toContain("First practical step.");
    expect(narration).not.toContain("www.example.com");
    expect(narration).not.toContain("ISBN");
    expect(narration).not.toMatch(/\n12\n/);
    expect(narration.match(/Chapter 1\. A Better System\./g)).toHaveLength(1);
  });

  it("is idempotent for spoken acronyms and places currency after its scale", () => {
    const source = [
      "Chapter 1: The Rise of AI",
      "The company earned $8.7 billion and later invested €50 million.",
    ].join("\n\n");
    const once = prepareNarrationText(source, {
      title: "Chapter 1: The Rise of AI",
    });
    const twice = prepareNarrationText(once, {
      title: "Chapter 1: The Rise of AI",
    });

    expect(twice).toBe(once);
    expect(once.match(/Chapter 1\. The Rise of A I\./g)).toHaveLength(1);
    expect(once).toContain("8.7 billion dollars");
    expect(once).toContain("50 million euros");
    expect(once).not.toContain("8.7 dollars billion");
  });

  it("keeps source and narration cleanup statistics separate", () => {
    const source = "Page 4\nHello   world\nhttps://example.com";
    const narration = prepareNarrationText(source, { includeTitle: false });
    const stats = narrationCleanupStats(source, narration);

    expect(narration).toBe("Hello world");
    expect(stats.sourceCharacters).toBe(source.length);
    expect(stats.narrationCharacters).toBe(narration.length);
    expect(stats.removedCharacters).toBeGreaterThan(0);
    expect(stats.narrationWords).toBe(2);
  });

  it("preserves dates, numbers, negation, and paragraph boundaries", () => {
    const source = [
      "On 2024-03-09, the 1st cohort did not reach 25% of its target.",
      "The 2024-03-09 deadline was not extended; 1,250 users remained.",
    ].join("\n\n");
    const narration = prepareNarrationText(source, { includeTitle: false });

    expect(narration).toContain("On 2024-03-09, the 1st cohort did not reach 25 percent");
    expect(narration).toContain("The 2024-03-09 deadline was not extended; 1,250 users remained.");
    expect(narration).toContain("target.\n\nThe 2024-03-09");
  });

  it("does not guess whether a line-end hyphen is a wrap or a compound", () => {
    const narration = prepareNarrationText(
      "The organi-\nzation and well-\nbeing examples retain their marks.",
      { includeTitle: false },
    );

    expect(narration).toBe(
      "The organi- zation and well- being examples retain their marks.",
    );
  });

  it("includes caller-supplied framing as a separate optional paragraph", () => {
    const narration = prepareNarrationText("The report begins here.", {
      includeTitle: false,
      framingText: "Study guide introduction",
    });

    expect(narration).toBe("Study guide introduction.\n\nThe report begins here.");
    expect(prepareNarrationText("The report begins here.", { includeTitle: false })).toBe(
      "The report begins here.",
    );
  });

  it("keeps optional intro and outro outside the source wording", () => {
    const source = "The date is 2024-03-09. Do not change the 1,250 records.";
    expect(prepareNarrationText(source, { includeTitle: false })).toBe(source);
    expect(prepareNarrationText(source, {
      includeTitle: false,
      framingText: "This recording presents the selected text.",
      outroText: "End of the selected text.",
    })).toBe(
      "This recording presents the selected text.\n\n" +
      "The date is 2024-03-09. Do not change the 1,250 records.\n\n" +
      "End of the selected text.",
    );
  });
});

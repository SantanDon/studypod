/**
 * Release-quality guards for read-aloud scope routing.
 *
 * Provider honesty: `parseStudioAudioIntent` is PURE TEXT PARSING. No model speech
 * provider, browser speech API or network provider is invoked anywhere in this file,
 * so nothing here is evidence that real audio was synthesised, downloaded or heard.
 */
import { describe, expect, it } from "vitest";
import { parseStudioAudioIntent } from "@/lib/audio/studioAudioCommands";

describe("partial read-aloud scope is never escalated to full-book narration", () => {
  it.each([
    // numeric
    "Read chapter 5 aloud",
    "Read pages 12 aloud",
    "Read pages 2-4 aloud",
    // ordinal AFTER the unit word
    "Read chapter four aloud",
    "Read chapter fourteen aloud",
    "Narrate chapter eleven aloud",
    "Read section two aloud",
    "Read chapter IV aloud",
    // ordinal / positional BEFORE the unit word
    "Read the first chapter aloud",
    "Read the next chapter aloud",
    "Read the final chapter aloud",
    "Read the remaining section aloud",
    // named / structural sections we do not enumerate
    "Read the appendix aloud",
    "Read the preface aloud",
    "Read the conclusion aloud",
    "Read part two aloud",
    // ranges and remainders
    "Read everything from chapter 2 aloud",
    "Read the rest of this book aloud",
    // ambiguous breadth: safer to open than to narrate the whole book
    "Read all the chapters aloud",
  ])("%s opens Studio selection instead of starting full narration", (text) => {
    const intent = parseStudioAudioIntent(text);
    expect(intent).not.toBeNull();
    expect(intent).toMatchObject({
      kind: "audiobook",
      chapterSelection: true,
      operation: "open",
    });
    expect(intent?.operation).not.toBe("generate");
  });

  it.each([
    "Please read this whole PDF aloud",
    "Read this whole PDF out loud",
    "Read this whole PDF read-aloud",
    "Narrate the entire document",
    "Read the whole book aloud",
  ])("%s stays an explicit full narration", (text) => {
    const intent = parseStudioAudioIntent(text);
    expect(intent).not.toBeNull();
    expect(intent).toMatchObject({
      kind: "audiobook",
      operation: "generate",
      chapterSelection: false,
    });
  });

  it("does not downgrade a source-grounded podcast that merely mentions a chapter", () => {
    const intent = parseStudioAudioIntent(
      "Can you make a podcast about the argument in chapter five?",
    );
    expect(intent).toMatchObject({
      kind: "podcast",
      operation: "generate",
      chapterSelection: false,
    });
  });

  it("refuses ordinary questions, negation and ambiguity rather than guessing", () => {
    for (const text of [
      "What is a podcast?",
      "How do I create an audiobook?",
      "Make a podcast and an audiobook",
      "Do not make a podcast.",
      "Never read this aloud",
      "Make an outline of this essay",
      "x".repeat(1001),
    ]) {
      expect(parseStudioAudioIntent(text)).toBeNull();
    }
  });
});

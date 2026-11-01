import { describe, expect, it } from "vitest";
import { getAudiobookChapterScope, getVisibleChatQuestion, withAudiobookReadingContext } from "@/lib/audio/readingContext";
import {
  buildAudioListeningQuestionMessage,
  formatListeningTimestamp,
  type AudioListeningQuestionRequest,
} from "@/lib/audio/listeningQuestion";

const request: AudioListeningQuestionRequest = {
  notebookId: "notebook-1",
  sourceId: "source-1",
  sourceTitle: "The Republic",
  chapterId: "chapter-7",
  chapterIndex: 6,
  chapterTitle: "Book VII",
  pageStart: 210,
  pageEnd: 218,
  timeSeconds: 754,
  durationSeconds: 1800,
  question: "Why is the cave important?",
};

describe("audio listening question context", () => {
  it("formats short and long timestamps deterministically", () => {
    expect(formatListeningTimestamp(754)).toBe("12:34");
    expect(formatListeningTimestamp(3671)).toBe("1:01:11");
  });

  it("builds an explicit grounded question without claiming sentence precision", () => {
    const message = buildAudioListeningQuestionMessage(request);
    expect(message).toContain("Book: The Republic");
    expect(message).toContain('chapter "Book VII"');
    expect(message).toContain("12:34 into the chapter");
    expect(message).toContain("pages 210–218");
    expect(message).toContain("Why is the cave important?");
    expect(message).toContain("sentence-level audio timing is not available yet");
    expect(message).toContain("audio segment 7");
    expect(getVisibleChatQuestion(message)).toBe(request.question);
  });

  it("carries canonical book scope in the internal reader-position suffix", () => {
    const bookOneMessage = buildAudioListeningQuestionMessage({
      ...request,
      chapterTitle: "Book I",
      timeSeconds: 781,
    });

    expect(getAudiobookChapterScope(bookOneMessage)).toBe("Book I");
    expect(getVisibleChatQuestion(bookOneMessage)).toBe(request.question);
    expect(getVisibleChatQuestion(bookOneMessage)).not.toContain("Reader position:");
    expect(getVisibleChatQuestion(bookOneMessage)).not.toContain("Audio listening context:");
    expect(bookOneMessage).toContain("navigation metadata, not source evidence");
  });

  it("hides both generated context blocks from the visible pending question", () => {
    const bookOneMessage = buildAudioListeningQuestionMessage({
      ...request,
      chapterTitle: "Book I",
      question: "Ask me one practice question and wait for my attempt.",
    });

    expect(bookOneMessage).toContain("[Audio listening context:");
    expect(bookOneMessage).toContain("[Reader position:");
    expect(getVisibleChatQuestion(bookOneMessage)).toBe("Ask me one practice question and wait for my attempt.");
  });

  it("keeps user-provided guidance visible while hiding only complete generated context blocks", () => {
    const userText = "Please cite the relevant passage and explain why this matters.";
    const message = buildAudioListeningQuestionMessage({ ...request, question: userText });

    expect(getVisibleChatQuestion(message)).toBe(userText);
    expect(getVisibleChatQuestion("My question mentions Answer from this source and cite the relevant passage.")).toBe(
      "My question mentions Answer from this source and cite the relevant passage.",
    );
    expect(getVisibleChatQuestion("[Audio listening context: this is ordinary user text]")).toBe(
      "[Audio listening context: this is ordinary user text]",
    );
  });

  it("preserves the captured Book I scope when playback has moved to the introduction", () => {
    const bookOneMessage = buildAudioListeningQuestionMessage({
      ...request,
      chapterTitle: "Book I",
      timeSeconds: 781,
    });
    const wrapped = withAudiobookReadingContext(bookOneMessage, {
      sourceId: "source-1",
      chapterIndex: 0,
      chapterCount: 2,
      chapterTitle: "Introduction",
      progressPercent: 4,
      isPlaying: true,
    });

    expect(wrapped).toBe(bookOneMessage);
    expect(getAudiobookChapterScope(wrapped)).toBe("Book I");
    expect(wrapped.match(/\[Reader position:/g)).toHaveLength(1);
  });

  it("still adds playback context to ordinary unscoped messages", () => {
    const wrapped = withAudiobookReadingContext("Explain justice in this passage.", {
      sourceId: "source-1",
      chapterIndex: 0,
      chapterTitle: "Introduction",
      isPlaying: false,
    });

    expect(wrapped).toContain("Explain justice in this passage.");
    expect(wrapped).toContain("Reader position:");
    expect(wrapped).toContain("Introduction");
  });
});

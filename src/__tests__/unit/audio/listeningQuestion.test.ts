import { describe, expect, it } from "vitest";
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
    expect(message).toContain('"The Republic"');
    expect(message).toContain('chapter "Book VII"');
    expect(message).toContain("12:34 into the chapter");
    expect(message).toContain("pages 210–218");
    expect(message).toContain("Why is the cave important?");
    expect(message).toContain("sentence-level audio timing is not available yet");
  });
});

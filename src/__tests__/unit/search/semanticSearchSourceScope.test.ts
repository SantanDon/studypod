import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSources } = vi.hoisted(() => ({ getSources: vi.fn() }));

vi.mock("@/services/localStorageService", () => ({
  localStorageService: {
    getSources,
    getNotes: vi.fn(() => []),
    getChatMessages: vi.fn(() => []),
  },
}));

vi.mock("@/lib/search/embeddingCache", () => ({
  embeddingCache: { getEmbedding: vi.fn(async () => []) },
}));

import { search } from "@/lib/search/semanticSearch";

describe("semantic source scope", () => {
  beforeEach(() => {
    getSources.mockReset();
    getSources.mockReturnValue([
      {
        id: "intro",
        title: "Republic introduction",
        type: "pdf",
        content: "Critias tells the story of Atlantis in the introduction.",
        metadata: { chunks: ["Critias tells the story of Atlantis in the introduction."] },
      },
      {
        id: "book-one",
        title: "Republic Book I",
        type: "pdf",
        content: "Socrates discusses justice with Cephalus and Polemarchus.",
        metadata: { chunks: [
          "The dialogue opens with Socrates returning from the Piraeus.",
          "Cephalus and Polemarchus debate what justice is and whether it means telling the truth and returning what one owes.",
        ] },
      },
    ]);
  });

  it("retrieves only chunks from the explicitly selected source", async () => {
    const results = await search("what is justice in Book I", {
      notebookId: "notebook",
      types: ["source"],
      sourceIds: ["book-one"],
      useSemanticSearch: false,
      minScore: 0.01,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.id.startsWith("book-one"))).toBe(true);
    expect(results.some((result) => result.content.includes("Cephalus and Polemarchus"))).toBe(true);
    expect(results.some((result) => result.content.includes("Atlantis"))).toBe(false);
    expect(results[0]?.content).toContain("Cephalus and Polemarchus");
  });

  it("ranks a matching Book I chunk without returning unrelated chunks", async () => {
    const results = await search("justice truth returning what one owes", {
      notebookId: "notebook",
      types: ["source"],
      sourceIds: ["book-one"],
      useSemanticSearch: false,
      minScore: 0.01,
    });

    expect(results[0]?.content).toContain("Cephalus and Polemarchus");
    expect(results[0]?.content).not.toContain("Piraeus");
    expect(results[0]?.content).not.toContain("Atlantis");
  });
});

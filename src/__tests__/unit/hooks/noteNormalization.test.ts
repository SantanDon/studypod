import { describe, expect, it } from "vitest";
import { normalizeNoteRecord, serializeNoteContent } from "@/hooks/useNotes";

describe("cloud note persistence", () => {
  it("restores a saved title and keeps headings in the body", () => {
    const body = "Seventeen trays.\n\n# Observations\nThree seedlings each.";
    const note = normalizeNoteRecord({ id: "n1", notebookId: "book1", authorId: "u1", content: serializeNoteContent("Cedar QA note", body), createdAt: "2026-10-12", updatedAt: "2026-10-12" });
    expect(note).toMatchObject({ title: "Cedar QA note", content: body, notebook_id: "book1", author_id: "u1", source_type: "user" });
    expect(serializeNoteContent(note.title, note.content)).toBe(serializeNoteContent("Cedar QA note", body));
  });
  it("supports CRLF content and edits without duplicating the old title", () => {
    const note = normalizeNoteRecord({ id: "n1", content: "# Old title\r\n\r\nOriginal body" });
    expect(serializeNoteContent("Updated title", note.content)).toBe("# Updated title\n\nOriginal body");
  });
  it("preserves structured guest notes and AI type", () => {
    expect(normalizeNoteRecord({ id: "n1", title: "Saved answer", content: "# Body heading\n\nAnswer", source_type: "ai_response" })).toMatchObject({ title: "Saved answer", content: "# Body heading\n\nAnswer", source_type: "ai_response" });
  });
  it("keeps untitled legacy content intact", () => {
    expect(normalizeNoteRecord({ id: "n1", content: "Legacy text" })).toMatchObject({ title: "Untitled Note", content: "Legacy text", source_type: "user" });
  });
});

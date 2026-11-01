import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzePdfChapterStructure,
  buildBookResponse,
  cleanPlainText,
  displayTitleFromFileName,
  extractEpubChapters,
  extractBookFromFile,
  getChapterTextFromManifest,
  inferPdfMetadata,
  inferTextBookMetadata,
  isSupportedBookFile,
  loadBookManifest,
  manifestPathFor,
  sanitizeFileName,
  saveBookManifest,
  splitPdfPagesIntoChapters,
  splitTextIntoChapters,
  stripHtmlToText,
  validatePdfExtractionCompleteness,
  uniqueSafeFileName,
} from "../services/audiobookBookService.js";

const tempPaths = [];

function tempFile(name, content) {
  const filePath = path.join(
    os.tmpdir(),
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`,
  );
  fs.writeFileSync(filePath, content, "utf8");
  tempPaths.push(filePath);
  return filePath;
}

function tempDir() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "studypod-audiobook-manifest-"),
  );
  tempPaths.push(dir);
  return dir;
}

afterEach(() => {
  for (const target of tempPaths.splice(0)) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {}
  }
});

describe("audiobookBookService", () => {
  it("admits text PDFs with complete extraction using the established 90% coverage bar", () => {
    const source = "A complete paragraph of extracted source text. ".repeat(30);
    const result = validatePdfExtractionCompleteness(source, [{ text: source }]);

    expect(result.coverage).toBe(1);
    expect(() => validatePdfExtractionCompleteness(source, [
      { text: source.slice(0, Math.floor(source.length * 0.89)) },
    ])).toThrow(expect.objectContaining({
      status: 400,
      message: expect.stringMatching(/extraction appears incomplete.*OCR it/i),
    }));
  });

  it("rejects scanned and unusably short PDFs with actionable OCR guidance", () => {
    expect(() => validatePdfExtractionCompleteness("\f\n\n", [])).toThrow(expect.objectContaining({
      status: 400,
      message: expect.stringMatching(/Scanned PDFs need OCR/i),
    }));
    expect(() => validatePdfExtractionCompleteness("A short selectable phrase.", [
      { text: "A short selectable phrase." },
    ])).toThrow(/no usable selectable text.*OCR/i);
  });

  it("keeps Gutenberg front matter and real book titles while excluding navigation and license text", async () => {
    const entries = [
      { id: "contents", href: "contents.xhtml", title: "Contents" },
      { id: "intro", href: "intro.xhtml", title: "Introduction and Analysis" },
      { id: "persons", href: "persons.xhtml", title: "Persons" },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `book-${index + 1}`,
        href: `book-${index + 1}.xhtml`,
        title: `Chapter ${index + 4}`,
      })),
      { id: "license", href: "license.xhtml", title: "Full Project Gutenberg License" },
    ];
    const bodies = {
      contents: "<h1>Contents</h1><p>Book I ... 1</p><p>Book II ... 20</p>",
      intro: "<h1>Introduction and Analysis</h1><p>Historical editorial matter.</p>",
      persons: "<h1>Persons</h1><p>Socrates and his companions.</p>",
      ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
        `book-${index + 1}`,
        `<h1>BOOK ${["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][index]}</h1><p>Original text ${index + 1}.</p>`,
      ])),
      license: "<h1>Full Project Gutenberg License</h1><p>Terms and conditions follow.</p>",
    };
    const epub = {
      toc: entries.map(({ id, href, title }) => ({ id, href, title })),
      flow: entries.map(({ id, href }) => ({ id, href })),
      getChapter: async (id) => bodies[id],
    };

    const chapters = await extractEpubChapters(epub);
    expect(chapters.map(({ title }) => title)).toEqual([
      "Introduction and Analysis",
      "Persons",
      "BOOK I", "BOOK II", "BOOK III", "BOOK IV", "BOOK V",
      "BOOK VI", "BOOK VII", "BOOK VIII", "BOOK IX", "BOOK X",
    ]);
    expect(chapters.map(({ order }) => order)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(chapters[0].text).toContain("Historical editorial matter.");
    expect(chapters[1].text).toContain("Socrates and his companions.");
    expect(chapters[2].text).toContain("Original text 1.");
    expect(chapters.some(({ text }) => /contents|terms and conditions/i.test(text))).toBe(false);
  });

  it("reassembles Gutenberg flow fragments and excludes the trademarked license heading", async () => {
    const flow = [
      { id: "header", title: "Chapter 1" },
      { id: "intro", title: "INTRODUCTION AND ANALYSIS." },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `intro-${index}`, title: `Chapter ${index + 3}` })),
      { id: "persons", title: "THE REPUBLIC." },
      ...["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"].map((book) => ({ id: `book-${book}`, title: `BOOK ${book}.` })),
      { id: "notes-license", title: "THE FULL PROJECT GUTENBERG™ LICENSE" },
    ];
    const bodies = {
      header: "The Project Gutenberg eBook of The Republic\n*** START OF THE PROJECT GUTENBERG EBOOK THE REPUBLIC ***\nContents\nINTRODUCTION AND ANALYSIS.\nBOOK I.\nBOOK II.\nBOOK III.\nBOOK IV.\nBOOK V.\nBOOK VI.\nBOOK VII.\nBOOK VIII.\nBOOK IX.\nBOOK X.",
      intro: "INTRODUCTION AND ANALYSIS.\nFirst source fragment.",
      ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`intro-${index}`, `Unheaded source continuation ${index + 1}.`])),
      persons: "THE REPUBLIC.\nPERSONS OF THE DIALOGUE.\nSocrates.",
      ...Object.fromEntries(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"].map((book) => [`book-${book}`, `BOOK ${book}.\nBook ${book} source text.`])),
      "notes-license": "Transcriber’s Notes\nA public-domain cover note.\n*** END OF THE PROJECT GUTENBERG EBOOK THE REPUBLIC ***\nTHE FULL PROJECT GUTENBERG™ LICENSE\nGeneral Terms of Use and Redistributing Project Gutenberg-tm electronic works.",
    };
    const epub = {
      toc: flow.map(({ id, title }) => ({ id, title })),
      flow,
      getChapter: async (id) => `<p>${bodies[id].replace(/\n/g, "</p><p>")}</p>`,
    };

    const chapters = await extractEpubChapters(epub);
    expect(chapters.map(({ title }) => title)).toEqual([
      "INTRODUCTION AND ANALYSIS.", "THE REPUBLIC.",
      ...["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"].map((book) => `BOOK ${book}.`),
      "Transcriber’s Notes",
    ]);
    expect(chapters[0].text).toContain("First source fragment.");
    expect(chapters[0].text).toContain("Unheaded source continuation 1.");
    expect(chapters[0].text).toContain("Unheaded source continuation 8.");
    expect(chapters[0].text.indexOf("Unheaded source continuation 1.")).toBeLessThan(chapters[0].text.indexOf("Unheaded source continuation 8."));
    expect(chapters.at(-1).text).toContain("A public-domain cover note.");
    expect(chapters.some(({ title, text }) => /LICENSE/i.test(title) || /General Terms of Use/i.test(text))).toBe(false);
  });

  it("infers title and author from a plain-text title page", () => {
    expect(
      inferTextBookMetadata(
        [
          "THE REPUBLIC",
          "By Plato",
          "",
          "BOOK I",
          "Socrates entered the Piraeus.",
        ].join("\n"),
        "fallback title",
      ),
    ).toEqual({
      title: "THE REPUBLIC",
      author: "Plato",
      description: "",
    });
  });

  it("respects explicit title and author labels in Markdown books", () => {
    expect(
      inferTextBookMetadata(
        [
          "# Title: The AI-Driven Leader",
          "Author: Geoff Woods",
          "",
          "## Chapter 1",
        ].join("\n"),
        "fallback title",
      ),
    ).toEqual({
      title: "The AI-Driven Leader",
      author: "Geoff Woods",
      description: "",
    });
  });
  it("sanitizes unsafe and non-string file names without throwing", () => {
    expect(sanitizeFileName("../Unsafe Book!!.TXT")).toBe("Unsafe_Book_.txt");
    expect(sanitizeFileName(12345)).toBe("12345");
    expect(sanitizeFileName(null)).toBe("book");
  });

  it("creates unique safe upload names while preserving extensions", () => {
    const fileName = uniqueSafeFileName("My Book!.epub");
    const secondFileName = uniqueSafeFileName("My Book!.epub");
    expect(fileName).toMatch(/^My_Book_+[a-f0-9]{16}\.epub$/);
    expect(secondFileName).not.toBe(fileName);
  });

  it("removes internal upload timestamps from fallback book titles", () => {
    expect(
      displayTitleFromFileName("plato_-_the_republic_1784716887665.pdf"),
    ).toBe("plato the republic");
    expect(displayTitleFromFileName("My_Book_0123456789abcdef.epub")).toBe(
      "My Book",
    );
    expect(displayTitleFromFileName("The_AI_Driven_Leader.docx")).toBe(
      "The AI Driven Leader",
    );
  });

  it("recognizes the supported audiobook ingestion file types", () => {
    expect(isSupportedBookFile("story.epub")).toBe(true);
    expect(isSupportedBookFile("story.pdf")).toBe(true);
    expect(isSupportedBookFile("story.docx")).toBe(true);
    expect(isSupportedBookFile("story.txt")).toBe(true);
    expect(isSupportedBookFile("story.exe")).toBe(false);
  });

  it("cleans plain text and strips simple HTML into narration-ready text", () => {
    expect(cleanPlainText("Hello\r\n\t world\n\n\n\nagain")).toBe(
      "Hello\nworld\n\n\nagain",
    );
    expect(
      stripHtmlToText(
        "<h1>Title</h1><p>Hello&nbsp;&amp;&nbsp;welcome</p><script>bad()</script>",
      ),
    ).toContain("Title");
    expect(stripHtmlToText("<p>Hello&nbsp;&amp;&nbsp;welcome</p>")).toContain(
      "Hello & welcome",
    );
  });

  it("splits long text files by headings and synthetic size", () => {
    const text = `Preface\n\n${"intro ".repeat(350)}\n\nCHAPTER 1: Start\n${"body ".repeat(2600)}\n\nCHAPTER 2: Continue\n${"next ".repeat(2600)}`;
    const chapters = splitTextIntoChapters(text, "Sample");
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    expect(
      chapters.every((chapter) => chapter.id && chapter.title && chapter.text),
    ).toBe(true);
  });

  it("extracts txt files into public chapters and a private manifest", async () => {
    const filePath = tempFile(
      "sample-book.txt",
      "CHAPTER 1: Upload\nThis is chapter one.\n\nCHAPTER 2: Listen\nThis is chapter two.",
    );
    const extraction = await extractBookFromFile(filePath, "sample-book.txt");
    const response = buildBookResponse({
      fileName: "sample-book.txt",
      permanentPath: filePath,
      extraction,
      source: "test",
    });

    expect(response.title).toBe("sample book");
    expect(response.format).toBe("txt");
    expect(response.content).toContain("chapter one");
    expect(response.manifest.chapters[0].text).toContain("chapter one");
    expect(response.chapters[0]).not.toHaveProperty("text");
  });

  it("saves and loads manifests by sanitized book name", async () => {
    const dir = tempDir();
    const manifest = {
      fileName: "Unsafe Book!.txt",
      title: "Unsafe Book",
      chapters: [{ id: "section-1", title: "One", text: "Chapter text" }],
    };

    const savedPath = saveBookManifest(dir, manifest);
    expect(savedPath).toBe(manifestPathFor(dir, manifest.fileName));

    const loaded = loadBookManifest(dir, manifest.fileName);
    expect(loaded.title).toBe("Unsafe Book");
    expect(getChapterTextFromManifest(loaded, "section-1")).toBe(
      "Chapter text",
    );
    expect(getChapterTextFromManifest(loaded, "missing")).toBe("");
  });

  it("prefers narration-specific text from a manifest chapter", () => {
    const manifest = {
      chapters: [
        {
          id: "front-matter",
          text: "ISBN and catalog text",
          narrationText: "Book title. Written by Author.",
        },
      ],
    };
    expect(getChapterTextFromManifest(manifest, "front-matter")).toBe(
      "Book title. Written by Author.",
    );
  });

  it("infers PDF title, subtitle, and author from the publishing page", () => {
    const pages = [
      { num: 1, text: "" },
      {
        num: 4,
        text: "The AI-Driven Leader\nHarnessing AI to Make Faster, Smarter Decisions\nGeoff Woods\nPublished by AI Thought Leadership",
      },
    ];
    expect(inferPdfMetadata(pages, {}, "fallback")).toEqual({
      title: "The AI-Driven Leader",
      author: "Geoff Woods",
      description: "Harnessing AI to Make Faster, Smarter Decisions",
    });
  });

  it("infers a simple title-page byline such as The Republic by Plato", () => {
    const pages = [
      {
        num: 1,
        text: "The Republic\nBy Plato\nhttp://www.idph.net\n18 de maio de 2002",
      },
      { num: 2, text: "2 IDPH" },
    ];

    expect(inferPdfMetadata(pages, {}, "fallback")).toEqual({
      title: "The Republic",
      author: "Plato",
      description: "",
    });
  });

  it("splits page-aware PDFs on structural chapter pages without treating numbered lists as chapters", () => {
    const pages = [
      {
        num: 1,
        text: "Sample Book\nA practical guide\nAlex Writer\nPublished by Example Press",
      },
      { num: 2, text: "To curious readers." },
      { num: 3, text: "Chapter 1" },
      { num: 4, text: "" },
      { num: 5, text: "A Better Beginning" },
      {
        num: 6,
        text: "Opening prose.\n1. First action item\n2. Second action item",
      },
      { num: 7, text: "Chapter 2" },
      {
        num: 8,
        text: "A Wrapped Chapter Title: Using AI\nto Make Better Decisions\nThe body begins here and continues.",
      },
      { num: 9, text: "Conclusion" },
      { num: 10, text: "Where We Go Next\nThe closing argument appears here." },
      { num: 11, text: "Appendix\nPrompt one\nPrompt two" },
      { num: 12, text: "Acknowledgments\nFamily\nThank you." },
      {
        num: 13,
        text: "Alex Writer is the founder of Example Labs and writes about learning.",
      },
    ];

    const metadata = inferPdfMetadata(pages, {}, "Sample Book");
    const chapters = splitPdfPagesIntoChapters(pages, metadata.title, metadata);

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Opening Credits and Front Matter",
      "Chapter 1: A Better Beginning",
      "Chapter 2: A Wrapped Chapter Title: Using AI to Make Better Decisions",
      "Conclusion: Where We Go Next",
      "Appendix",
      "Acknowledgments",
      "About the Author",
    ]);
    expect(chapters[1].text).toContain("1. First action item");
    expect(chapters[1].pageStart).toBe(3);
    expect(chapters[1].pageEnd).toBe(6);
    expect(chapters.at(-1).pageStart).toBe(13);
  });

  it("splits classical PDFs into an introduction and numbered books while removing publisher furniture", () => {
    const pages = [
      { num: 1, text: "The Republic\nBy Plato\nhttp://www.idph.net" },
      { num: 2, text: "2 IDPH" },
      {
        num: 3,
        text: "Sumário\nINTRODUCTION AND ANALYSIS 5\nBOOK I 177\nBOOK II 211",
      },
      { num: 4, text: "4 IDPH\nhttp://www.idph.net" },
      {
        num: 5,
        text: "INTRODUCTION AND\nANALYSIS\nThe Republic of Plato is the longest of his works.",
      },
      {
        num: 6,
        text: "6 IDPH\nThe introduction continues without becoming a synthetic chapter.",
      },
      {
        num: 177,
        text: "BOOK I\nPERSONS OF THE DIALOGUE.\nSocrates, who is the narrator.",
      },
      { num: 178, text: "178 IDPH\nThe discussion of justice begins." },
      {
        num: 211,
        text: "BOOK II\nWith these words I was thinking that I had made an end of the discussion.",
      },
      { num: 212, text: "IDPH 212\nThe argument continues." },
    ];

    const metadata = inferPdfMetadata(pages, {}, "fallback");
    const chapters = splitPdfPagesIntoChapters(pages, metadata.title, metadata);

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Opening Credits and Front Matter",
      "Introduction and Analysis",
      "Book I",
      "Book II",
    ]);
    expect(chapters[1].pageStart).toBe(5);
    expect(chapters[1].pageEnd).toBe(6);
    expect(chapters[2].pageStart).toBe(177);
    expect(chapters[2].text).not.toContain("IDPH");
    expect(chapters[2].text).not.toContain("idph.net");
    expect(chapters[3].text).toContain("The argument continues.");
  });

  it("keeps numbered part outlines in front matter instead of narrating the table of contents", () => {
    const pages = [
      { num: 1, text: "Reliable Leadership\nBy Ada Reader" },
      {
        num: 2,
        text: "PART 1\nFoundations\n1. Start Clearly\n2. Check the Evidence\n3. Decide Carefully",
      },
      {
        num: 3,
        text: "PART 2\nExecution\n4. Act Deliberately\n5. Review the Outcome\n6. Improve the System",
      },
      { num: 4, text: "PART ONE\nFoundations" },
      {
        num: 5,
        text: "CHAPTER ONE\nStart Clearly\nThe first real chapter begins here.",
      },
      { num: 6, text: "The first real chapter continues here." },
      { num: 7, text: "PART TWO\nExecution" },
      {
        num: 8,
        text: "CHAPTER TWO\nAct Deliberately\nThe second real chapter begins here.",
      },
    ];

    const result = analyzePdfChapterStructure(pages, "Reliable Leadership", {
      title: "Reliable Leadership",
      author: "Ada Reader",
    });
    const titles = result.chapters.map((chapter) => chapter.title);

    expect(titles).toEqual([
      "Opening Credits and Front Matter",
      "Part One: Foundations",
      "Chapter One: Start Clearly",
      "Part Two: Execution",
      "Chapter Two: Act Deliberately",
    ]);
    expect(titles).not.toContain("Part 1: Foundations");
    expect(titles).not.toContain("Part 2: Execution");
    expect(result.chapters[0].text).toContain("1. Start Clearly");
    expect(result.chapters[1].narratable).toBe(false);
    expect(result.chapters[2].parentId).toBe(result.chapters[1].id);
  });

  it("detects word-numbered chapters beneath repeated headers and preserves part hierarchy", () => {
    const pages = [
      { num: 1, text: "Durable Systems\nBy Ada Reader" },
      {
        num: 2,
        text: "DURABLE SYSTEMS\nPART ONE\nFoundations\nExample Press",
      },
      {
        num: 3,
        text: "DURABLE SYSTEMS\nCHAPTER ONE\nStart Clearly\nThe first body starts here.\nExample Press",
      },
      {
        num: 4,
        text: "DURABLE SYSTEMS\nThe first body continues here.\nExample Press",
      },
      {
        num: 5,
        text: "DURABLE SYSTEMS\nCHAPTER TWO\nContinue Safely\nThe second body starts here.\nExample Press",
      },
      {
        num: 6,
        text: "DURABLE SYSTEMS\nThe second body continues here.\nExample Press",
      },
      {
        num: 7,
        text: "DURABLE SYSTEMS\nAPPENDIX A\nSupporting details begin here.\nExample Press",
      },
      {
        num: 8,
        text: "DURABLE SYSTEMS\nSupporting details continue here.\nExample Press",
      },
    ];

    const result = analyzePdfChapterStructure(pages, "Durable Systems", {
      title: "Durable Systems",
      author: "Ada Reader",
    });
    const part = result.chapters.find((chapter) => chapter.sectionKind === "part");
    const chapterOne = result.chapters.find((chapter) =>
      chapter.title.startsWith("Chapter One"),
    );

    expect(result.structure.strategy).toBe("pdf-structural-headings");
    expect(result.structure.removedFurnitureLines).toBeGreaterThan(0);
    expect(part.title).toBe("Part One: Foundations");
    expect(part.narratable).toBe(false);
    expect(chapterOne.parentId).toBe(part.id);
    expect(chapterOne.level).toBe(2);
    expect(chapterOne.text).toContain("The first body continues here.");
    expect(chapterOne.text).not.toContain("DURABLE SYSTEMS");
    expect(chapterOne.text).not.toContain("Example Press");
    expect(
      result.chapters.some((chapter) => chapter.title === "Appendix A"),
    ).toBe(true);
  });
});

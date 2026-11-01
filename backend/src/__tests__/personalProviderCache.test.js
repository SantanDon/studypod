import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatWithNotebook } from "../services/aiChatService.js";
import { dispatchToTitan } from "../services/titanProvider.js";
import { getPersonalProvider, runWithPersonalProvider } from "../services/personalProviderService.js";

vi.mock("../services/titanProvider.js", () => ({ dispatchToTitan: vi.fn() }));
vi.mock("../utils/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const groq = { provider: "groq", key: "groq-fixture-secret", model: "llama-3.3-70b-versatile" };
const gemini = { provider: "gemini", key: "gemini-fixture-secret", model: "gemini-2.5-flash" };
const evidence = "During photosynthesis, plants absorb carbon dioxide and use light energy to produce sugars.";
const fixture = (id) => ({
  notebook: { id, title: "Photosynthesis" },
  sources: [{ id: "source-1", title: "Photosynthesis", type: "text", content: evidence, processing_status: "ready" }],
  notes: [],
  message: "What gas do plants absorb during photosynthesis?",
  allowWebFallback: false,
});

beforeEach(() => {
  vi.mocked(dispatchToTitan).mockReset();
  vi.mocked(dispatchToTitan).mockImplementation(async () => ({
    answer: `Plants absorb carbon dioxide during photosynthesis.[1]\n\nCITATIONS:\n[1] "${evidence}"`,
    tokensUsed: 10,
    modelUsed: getPersonalProvider()?.provider || "managed",
  }));
});

describe("personal provider notebook response cache isolation", () => {
  it("executes each explicit provider despite an existing managed answer and preserves the managed cache", async () => {
    const input = fixture("personal-cache-managed-first");
    expect((await chatWithNotebook(input)).modelUsed).toBe("managed");
    expect((await runWithPersonalProvider(groq, () => chatWithNotebook(input))).modelUsed).toBe("groq");
    expect((await runWithPersonalProvider(gemini, () => chatWithNotebook(input))).modelUsed).toBe("gemini");
    const callsBeforeManagedRead = vi.mocked(dispatchToTitan).mock.calls.length;
    expect((await chatWithNotebook(input)).modelUsed).toBe("managed");
    expect(dispatchToTitan).toHaveBeenCalledTimes(callsBeforeManagedRead);
    expect(callsBeforeManagedRead).toBe(3);
    expect(getPersonalProvider()).toBeUndefined();
  });

  it("does not populate shared cache from personal requests", async () => {
    const input = fixture("personal-cache-personal-first");
    expect((await runWithPersonalProvider(groq, () => chatWithNotebook(input))).modelUsed).toBe("groq");
    expect((await chatWithNotebook(input)).modelUsed).toBe("managed");
    expect(dispatchToTitan).toHaveBeenCalledTimes(2);
    expect(getPersonalProvider()).toBeUndefined();
  });
});

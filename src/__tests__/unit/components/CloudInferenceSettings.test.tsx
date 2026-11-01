import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudInferenceSettings } from "@/components/settings/CloudInferenceSettings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CloudInferenceSettings", () => {
  it("shows server-managed provider status without asking for credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: {
        OPENAI: { configured: true, available: true, model: "gpt-test" },
        GEMINI: { configured: false, available: false, model: "gemini-test" },
      } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CloudInferenceSettings />);

    expect(await screen.findByText("Configured provider services for this deployment")).toBeTruthy();
    expect(screen.getByText("OpenAI").closest("li")?.textContent).toContain("gpt-test");
    expect(screen.getByText("Configured", { exact: true })).toBeTruthy();
    expect(screen.getByText(/not a live connection check/)).toBeTruthy();
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
    expect(screen.getByText(/do not connect an account here/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/health/provider", { credentials: "include" });
  });

  it("explains deployment status fallback and links developer docs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<CloudInferenceSettings />);

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("status is unavailable"));
    expect(screen.getByRole("link", { name: /Gemini API docs/ }).getAttribute("href")).toBe("https://ai.google.dev/gemini-api/docs/get-started");
    expect(screen.getByRole("link", { name: /Groq API docs/ }).getAttribute("href")).toBe("https://console.groq.com/docs/quickstart");
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
  });
});

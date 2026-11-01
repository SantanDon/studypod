import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const modelState = vi.hoisted(() => ({
  ollamaEnabled: false,
  setOllamaEnabled: vi.fn(),
  discoveryStatus: "disabled" as "disabled" | "checking" | "unavailable" | "no-models" | "ready",
  discoveryMessage: "Local Ollama is disabled. Enable it to discover installed models.",
  installedModels: [] as string[],
  defaultModels: { chat: "llama3.2", embedding: "nomic-embed-text", code: "codellama" },
  setDefaultModel: vi.fn(),
  refetchHealth: vi.fn(),
  refetchModels: vi.fn(),
  refreshEndpoint: vi.fn(() => endpointState.value),
}));
const endpointState = vi.hoisted(() => ({
  value: "http://localhost:11434",
  set: vi.fn((value: string | null) => {
    if (value && !/^https?:\/\//.test(value)) throw new Error("Ollama endpoint must be a valid absolute HTTP(S) URL");
    endpointState.value = value || "http://localhost:11434";
  }),
}));

vi.mock("@/hooks/useOllamaModels", () => ({ useOllamaModels: () => modelState }));
vi.mock("@/config/ollamaConfig", () => ({
  getOllamaBaseUrl: () => endpointState.value,
  setRuntimeOllamaBaseUrl: (value: string | null) => endpointState.set(value),
}));
import { LocalInferenceSettings } from "@/components/settings/LocalInferenceSettings";
import { getLocalModelSettings, setLocalModelApiKey } from "@/config/localModelConfig";

beforeEach(() => {
  localStorage.removeItem("studypod.localModel.settings.v1");
  setLocalModelApiKey("");
  modelState.ollamaEnabled = false;
  modelState.discoveryStatus = "disabled";
  modelState.discoveryMessage = "Local Ollama is disabled. Enable it to discover installed models.";
  modelState.installedModels = [];
  modelState.defaultModels = { chat: "llama3.2", embedding: "nomic-embed-text", code: "codellama" };
  modelState.setOllamaEnabled.mockReset();
  modelState.setDefaultModel.mockReset();
  modelState.refetchHealth.mockReset();
  modelState.refetchModels.mockReset();
  modelState.refetchHealth.mockResolvedValue({ data: true } as never);
  modelState.refreshEndpoint.mockReset();
  endpointState.value = "http://localhost:11434";
  endpointState.set.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("LocalInferenceSettings", () => {
  it("makes local inference opt-in explicit and does not request provider credentials", () => {
    render(<LocalInferenceSettings />);
    expect(screen.getByRole("switch", { name: "Enable Ollama" })).toBeTruthy();
    expect(screen.getByLabelText("Connect with")).toBeTruthy();
    expect(screen.getByRole("option", { name: "LM Studio" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Other compatible server" })).toBeTruthy();
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
  });

  it("explains session key re-entry when a saved compatible provider has not been checked this session", () => {
    localStorage.setItem("studypod.localModel.settings.v1", JSON.stringify({
      provider: "lm-studio", baseUrl: "http://localhost:1234/v1", model: "local-chat", enabled: true,
    }));
    render(<LocalInferenceSettings />);

    expect((screen.getByRole("switch", { name: "Enable LM Studio" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Not checked yet. Re-enter the API key after reloading if your server requires one.");
    expect(screen.getByRole("status").textContent).not.toContain("LM Studio is off");
    expect(screen.getByLabelText("Local server API key (optional)")).toBeTruthy();
  });

  it("persists the legacy Ollama opt-out for a saved compatible provider that is off", () => {
    localStorage.setItem("studypod.localModel.settings.v1", JSON.stringify({
      provider: "custom", baseUrl: "http://localhost:8000/v1", model: "local-chat", enabled: false,
    }));
    render(<LocalInferenceSettings />);

    expect(modelState.setOllamaEnabled).toHaveBeenCalledWith(false);
  });

  it("offers recovery guidance when Ollama is unreachable", async () => {
    modelState.ollamaEnabled = true;
    modelState.discoveryStatus = "unavailable";
    modelState.discoveryMessage = "Could not reach Ollama from this browser at http://localhost:11434. Check that Ollama is running and reachable; browser permissions or CORS can also block access.";
    render(<LocalInferenceSettings />);
    fireEvent.click(screen.getByText("Advanced and troubleshooting"));
    expect(screen.getByText(/OLLAMA_ORIGINS/)).toBeTruthy();
    expect(screen.getByLabelText("Current browser origin").textContent).toBe(window.location.origin);
    expect(screen.getByText(/localhost means the computer running that browser/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    expect(modelState.refetchHealth).toHaveBeenCalledOnce();
    await waitFor(() => expect(modelState.refetchModels).toHaveBeenCalledOnce());
  });

  it("shows checking while re-enabling, then the recovered endpoint model without a false connected state", () => {
    modelState.ollamaEnabled = true;
    modelState.discoveryStatus = "ready";
    modelState.discoveryMessage = "2 Ollama models available.";
    modelState.installedModels = ["nimble:latest", "qwen3.5:9b"];
    modelState.defaultModels = { chat: "qwen3.5:9b", embedding: "nomic-embed-text", code: "codellama" };
    const view = render(<LocalInferenceSettings />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "chat model" }).textContent).toContain("qwen3.5:9b");

    fireEvent.click(screen.getByRole("switch", { name: "Enable Ollama" }));
    expect(modelState.setOllamaEnabled).toHaveBeenCalledWith(false);

    modelState.ollamaEnabled = false;
    modelState.discoveryStatus = "disabled";
    modelState.discoveryMessage = "Local Ollama is disabled. Enable it to discover installed models.";
    modelState.installedModels = [];
    view.rerender(<LocalInferenceSettings />);
    expect(screen.queryByText("Connected")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Enable Ollama" }));
    expect(modelState.setOllamaEnabled).toHaveBeenLastCalledWith(true);
    modelState.ollamaEnabled = true;
    modelState.discoveryStatus = "checking";
    modelState.discoveryMessage = "Checking the local Ollama service and installed models…";
    view.rerender(<LocalInferenceSettings />);
    expect(screen.getByRole("status").textContent).toContain("Checking the local Ollama service");
    expect(screen.queryByText("Connected")).toBeNull();

    modelState.discoveryStatus = "ready";
    modelState.discoveryMessage = "2 Ollama models available.";
    modelState.installedModels = ["nimble:latest", "qwen3.5:9b"];
    view.rerender(<LocalInferenceSettings />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "chat model" }).textContent).toContain("qwen3.5:9b");
  });

  it("persists an editable endpoint and checks the selected endpoint", async () => {
    modelState.ollamaEnabled = true;
    render(<LocalInferenceSettings />);
    fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "http://192.168.1.25:11434" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and check" }));

    expect(endpointState.set).toHaveBeenCalledWith("http://192.168.1.25:11434");
    expect(modelState.refreshEndpoint).toHaveBeenCalledOnce();
    expect(modelState.refreshEndpoint).toHaveReturnedWith("http://192.168.1.25:11434");
    expect(endpointState.set.mock.invocationCallOrder[0]).toBeLessThan(modelState.refreshEndpoint.mock.invocationCallOrder[0]);
    expect(modelState.refetchHealth).toHaveBeenCalledOnce();
    await waitFor(() => expect(modelState.refetchModels).toHaveBeenCalledOnce());
    expect(await screen.findByText("Address saved.")).toBeTruthy();
  });

  it("checks a saved Ollama endpoint while off and enables it only after a successful health check", async () => {
    render(<LocalInferenceSettings />);
    fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "http://192.168.1.25:11434" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and check" }));

    expect(await screen.findByText("Address saved.")).toBeTruthy();
    expect(modelState.refetchHealth).toHaveBeenCalledOnce();
    expect(modelState.setOllamaEnabled).toHaveBeenCalledWith(true);
    expect(modelState.refetchModels).toHaveBeenCalledOnce();
  });

  it("leaves Ollama off when a saved endpoint health check fails", async () => {
    modelState.refetchHealth.mockResolvedValue({ data: false } as never);
    render(<LocalInferenceSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Save and check" }));

    expect(await screen.findByText("Address saved.")).toBeTruthy();
    expect(modelState.refetchHealth).toHaveBeenCalledOnce();
    expect(modelState.setOllamaEnabled).not.toHaveBeenCalled();
  });

  it("shows an actionable validation error and can restore the configured default", () => {
    render(<LocalInferenceSettings />);
    fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "file:///tmp/ollama" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and check" }));
    expect(screen.getByRole("alert").textContent).toContain("valid absolute HTTP(S) URL");

    fireEvent.click(screen.getByRole("button", { name: "Use default address" }));
    expect(endpointState.set).toHaveBeenLastCalledWith(null);
    expect(modelState.refreshEndpoint).toHaveBeenCalledOnce();
    expect(modelState.refreshEndpoint).toHaveReturnedWith("http://localhost:11434");
    expect(endpointState.set.mock.invocationCallOrder[0]).toBeLessThan(modelState.refreshEndpoint.mock.invocationCallOrder[0]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers LM Studio and compatible server settings with a short credential lifecycle", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "local-chat" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LocalInferenceSettings />);
    fireEvent.change(screen.getByLabelText("Connect with"), { target: { value: "lm-studio" } });
    expect(modelState.setOllamaEnabled).toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Server address")).toBeTruthy();
    expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe("http://localhost:1234/v1");
    fireEvent.change(screen.getByLabelText("Local server API key (optional)"), { target: { value: "local-secret" } });
    fireEvent.click(screen.getByRole("switch", { name: "Enable LM Studio" }));
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(getLocalModelSettings()).toMatchObject({ provider: "lm-studio", enabled: true });
    expect(localStorage.getItem("studypod.localModel.settings.v1")).not.toContain("local-secret");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer local-secret" }),
    }));
    expect(screen.getByLabelText(/API key/)).toBeTruthy();
    expect(screen.getByText(/Key optional; kept until reload or provider change/i)).toBeTruthy();
  });

  it("keeps the legacy Ollama opt-in off when a compatible provider is disabled", () => {
    localStorage.setItem("studypod.localModel.settings.v1", JSON.stringify({
      provider: "custom", baseUrl: "http://localhost:8000/v1", model: "local-chat", enabled: true,
    }));
    render(<LocalInferenceSettings />);

    fireEvent.click(screen.getByRole("switch", { name: "Enable Other compatible server" }));

    expect(modelState.setOllamaEnabled).toHaveBeenCalledWith(false);
    expect(getLocalModelSettings()).toMatchObject({ provider: "custom", enabled: false });
  });

  it("checks a saved compatible endpoint before enabling it from the default off state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "first-model" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LocalInferenceSettings />);
    fireEvent.change(screen.getByLabelText("Connect with"), { target: { value: "lm-studio" } });
    fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "http://localhost:1235/v1" } });

    expect(getLocalModelSettings()).toMatchObject({ provider: "lm-studio", enabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Save and check" }));

    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1235/v1/models", expect.any(Object));
    expect(getLocalModelSettings()).toMatchObject({ provider: "lm-studio", baseUrl: "http://localhost:1235/v1", model: "first-model", enabled: true });
  });

  it("keeps a compatible provider off when the first connection check fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "Unavailable" }));
    render(<LocalInferenceSettings />);
    fireEvent.change(screen.getByLabelText("Connect with"), { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and check" }));

    expect(await screen.findByText(/Model discovery failed \(503\)/)).toBeTruthy();
    expect(getLocalModelSettings()).toMatchObject({ provider: "custom", enabled: false });
  });

  it("explains how to install a model and exposes installed models for each task", () => {
    modelState.ollamaEnabled = true;
    modelState.discoveryStatus = "no-models";
    modelState.discoveryMessage = "Ollama is running, but no models are installed yet.";
    const view = render(<LocalInferenceSettings />);
    expect(screen.getByText(/ollama pull llama3.2/)).toBeTruthy();

    modelState.discoveryStatus = "ready";
    modelState.discoveryMessage = "1 Ollama model available.";
    modelState.installedModels = ["llama3.2"];
    view.rerender(<LocalInferenceSettings />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "chat model" })).toBeTruthy();
  });
});
